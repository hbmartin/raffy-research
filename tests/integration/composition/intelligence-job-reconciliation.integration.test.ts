import { Result } from '@swan-io/boxed';
import { createPgliteTestDatabase } from '@tests/server/pglite';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, expect, it, vi } from 'vitest';

import {
  createScheduledJobRepository,
  intelligenceDrizzleSchema,
} from '@/modules/intelligence/testing';
import { AppError } from '@/modules/kernel/domain/errors/app-error';

const mocks = vi.hoisted(() => ({
  repositories: vi.fn(),
  generate: vi.fn(),
  ingest: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));
vi.mock('@/composition/intelligence', () => ({
  getIntelligenceRepositories: mocks.repositories,
}));
vi.mock('@/composition/kernel', () => ({
  getKernel: () => ({ clock: { now: () => new Date() }, logger: mocks.logger }),
}));
vi.mock('@/modules/intelligence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/intelligence')>()),
  generateWeeklyReport: mocks.generate,
  runWorkspaceIngest: mocks.ingest,
}));
vi.mock('@/modules/intelligence/backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/intelligence/backend')>()),
  createProviderRegistry: () => ({}),
  createOpenAiReportGenerator: () => ({}),
  createSlackAlert: () => ({}),
}));

let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;
beforeAll(async () => {
  database = await createPgliteTestDatabase();
});
afterAll(async () => {
  await database?.close();
});
beforeEach(async () => {
  vi.clearAllMocks();
  await database.truncate();
});

it.each(['daily', 'weekly'] as const)(
  'finalizes a committed %s insert whose acknowledgment was lost',
  async (kind) => {
    const repository = createScheduledJobRepository({ db: database.db });
    const start = vi.fn(
      async (input: Parameters<typeof repository.start>[0]) => {
        const committed = await repository.start(input);
        if (committed.isError()) return committed;
        return Result.Error(
          new AppError({
            code: 'SCHEDULED_JOB_START_ERROR',
            category: 'system',
            status: 500,
          })
        );
      }
    );
    mocks.repositories.mockReturnValue({
      workspaceRepository: { list: async () => Result.Ok([]) },
      scheduledJobRepository: {
        start,
        finish: repository.finish.bind(repository),
      },
    });
    const jobs = await import('@/composition/intelligence-jobs');
    const summary = await (kind === 'daily'
      ? jobs.runDailyIngest()
      : jobs.runWeeklyReports());
    expect(summary).toMatchObject({
      status: 'succeeded',
      historyStatus: 'failed',
      failed: 0,
    });
    const [row] = await database.db
      .select()
      .from(intelligenceDrizzleSchema.scheduledJobRun)
      .where(eq(intelligenceDrizzleSchema.scheduledJobRun.id, summary.runId));
    expect(row).toMatchObject({ status: 'succeeded', failed: 0 });
    expect(row?.finishedAt).toBeInstanceOf(Date);
    expect(start).toHaveBeenCalledOnce();
  }
);

it.each(['daily', 'weekly'] as const)(
  'does not create a replacement for a missing %s parent',
  async (kind) => {
    const repository = createScheduledJobRepository({ db: database.db });
    const finish = vi.fn(repository.finish.bind(repository));
    mocks.repositories.mockReturnValue({
      workspaceRepository: { list: async () => Result.Ok([]) },
      scheduledJobRepository: {
        start: async () =>
          Result.Error(
            new AppError({
              code: 'SCHEDULED_JOB_START_ERROR',
              category: 'system',
              status: 500,
            })
          ),
        finish,
      },
    });
    const jobs = await import('@/composition/intelligence-jobs');
    const summary = await (kind === 'daily'
      ? jobs.runDailyIngest()
      : jobs.runWeeklyReports());
    expect(summary).toMatchObject({
      status: 'succeeded',
      historyStatus: 'failed',
    });
    expect(finish).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ id: summary.runId })
    );
    expect(
      await database.db.select().from(intelligenceDrizzleSchema.scheduledJobRun)
    ).toHaveLength(0);
    expect(mocks.logger.error).toHaveBeenCalledOnce();
    expect(mocks.logger.warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'intelligence.scheduled_job.reconciliation_missing',
        details: expect.objectContaining({
          errorCode: 'SCHEDULED_JOB_FINISH_MISSING',
        }),
      })
    );
  }
);

it.each(['daily', 'weekly'] as const)(
  'records an aggregate %s skip without referencing a deleted workspace',
  async (kind) => {
    const repository = createScheduledJobRepository({ db: database.db });
    const upsertWorkspace = vi.fn(repository.upsertWorkspace.bind(repository));
    mocks.repositories.mockReturnValue({
      workspaceRepository: {
        list: async () => Result.Ok([{ id: 'deleted-workspace' }]),
      },
      scheduledJobRepository: {
        start: repository.start.bind(repository),
        finish: repository.finish.bind(repository),
        upsertWorkspace,
      },
    });
    mocks.generate.mockResolvedValue(
      Result.Ok({ type: 'workspace_not_found' })
    );
    mocks.ingest.mockResolvedValue(Result.Ok({ type: 'workspace_not_found' }));
    const jobs = await import('@/composition/intelligence-jobs');
    const summary = await (kind === 'daily'
      ? jobs.runDailyIngest()
      : jobs.runWeeklyReports());
    expect(summary).toMatchObject({
      status: 'succeeded',
      historyStatus: 'recorded',
    });
    expect(upsertWorkspace).not.toHaveBeenCalled();
    const [row] = await database.db
      .select()
      .from(intelligenceDrizzleSchema.scheduledJobRun)
      .where(eq(intelligenceDrizzleSchema.scheduledJobRun.id, summary.runId));
    expect(row).toMatchObject({
      total: 1,
      skipped: 1,
      failed: 0,
      status: 'succeeded',
    });
    expect(
      await database.db
        .select()
        .from(intelligenceDrizzleSchema.scheduledJobWorkspaceRun)
    ).toHaveLength(0);
  }
);
