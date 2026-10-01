import { createPgliteTestDatabase } from '@tests/server/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  createScheduledJobRepository,
  intelligenceDrizzleSchema,
} from '@/modules/intelligence/testing';
import { toWorkspaceId } from '@/modules/kernel/domain/ids';

const workspaceId = toWorkspaceId('ws-1');
const earlier = new Date('2026-06-01T14:00:00.000Z');
const later = new Date('2026-06-02T14:00:00.000Z');

describe('scheduled job history repository', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;

  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(intelligenceDrizzleSchema.workspace).values({
      id: workspaceId,
      name: 'Workspace',
      companyName: 'Acme',
      companyDescription: 'Test workspace',
      subcategory: 'B2B SaaS',
      timezone: 'UTC',
    });
  });
  afterAll(async () => {
    await database?.close();
  });

  it('upserts a workspace outcome once and lists runs newest first, including a pre-workspace failure', async () => {
    const repository = createScheduledJobRepository({ db: database.db });
    const started = await repository.start({
      id: 'run-1',
      kind: 'daily_ingest',
      startedAt: earlier,
    });
    if (started.isError()) throw started.getError();
    const outcome = {
      jobRunId: 'run-1',
      workspaceId,
      status: 'partial' as const,
      startedAt: earlier,
      finishedAt: later,
      succeeded: 1,
      partial: 1,
      failed: 0,
      skipped: 0,
      items: 5,
      failureCode: 'PROVIDER_REQUEST_FAILED',
      reportId: null,
    };
    const first = await repository.upsertWorkspace(outcome);
    if (first.isError()) throw first.getError();
    const replay = await repository.upsertWorkspace(outcome);
    if (replay.isError()) throw replay.getError();
    const finished = await repository.finish({
      id: 'run-1',
      status: 'partial',
      finishedAt: later,
      total: 1,
      succeeded: 0,
      partial: 1,
      failed: 0,
      skipped: 0,
      items: 5,
      failureCode: null,
    });
    if (finished.isError()) throw finished.getError();
    const global = await repository.start({
      id: 'run-2',
      kind: 'weekly_reports',
      startedAt: later,
    });
    if (global.isError()) throw global.getError();
    const globalFinished = await repository.finish({
      id: 'run-2',
      status: 'failed',
      finishedAt: later,
      total: 0,
      succeeded: 0,
      partial: 0,
      failed: 1,
      skipped: 0,
      items: 0,
      failureCode: 'WORKSPACE_LIST_ERROR',
    });
    if (globalFinished.isError()) throw globalFinished.getError();

    const listed = await repository.listForWorkspace({
      workspaceId,
      limit: 20,
    });
    if (listed.isError()) throw listed.getError();
    expect(listed.get()).toHaveLength(2);
    expect(listed.get().map(({ run }) => run.id)).toEqual(['run-2', 'run-1']);
    expect(listed.get()[0]?.workspace).toBeNull();
    expect(listed.get()[1]?.workspace).toMatchObject({
      status: 'partial',
      items: 5,
    });
  });
});
