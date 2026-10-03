import { createPgliteTestDatabase } from '@tests/server/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import type { IngestionRunWriteInput } from '@/modules/intelligence';
import {
  createIngestionRepository,
  intelligenceDrizzleSchema,
} from '@/modules/intelligence/testing';
import { toWorkspaceId } from '@/modules/kernel/domain/ids';

const workspaceId = toWorkspaceId('ws-1');
const otherWorkspaceId = toWorkspaceId('ws-2');
const at = (iso: string) => new Date(iso);

describe('ingestion repository: last successful daily run', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;

  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(intelligenceDrizzleSchema.workspace).values(
      [workspaceId, otherWorkspaceId].map((id) => ({
        id,
        name: id,
        companyName: 'Acme',
        companyDescription: 'Test workspace',
        subcategory: 'B2B SaaS',
        timezone: 'UTC',
      }))
    );
  });
  afterAll(async () => {
    await database?.close();
  });

  const seed = async (runs: IngestionRunWriteInput[]) => {
    const repository = createIngestionRepository({ db: database.db });
    for (const run of runs) {
      const started = await repository.startRun(run);
      if (started.isError()) throw started.getError();
    }
    return repository;
  };

  it('reports no previous run when the provider never succeeded', async () => {
    const repository = await seed([
      {
        workspaceId,
        providerName: 'exa',
        runType: 'daily',
        status: 'failed',
        startedAt: at('2026-06-01T10:00:00.000Z'),
      },
    ]);
    const result = await repository.getLastSuccessfulDailyRun({
      workspaceId,
      providerName: 'exa',
    });
    if (result.isError()) throw result.getError();
    expect(result.get()).toEqual({ type: 'no_previous_run' });
  });

  it('returns the newest succeeded daily run, ignoring other statuses, providers, workspaces and run types', async () => {
    const repository = await seed([
      {
        workspaceId,
        providerName: 'exa',
        runType: 'daily',
        status: 'succeeded',
        startedAt: at('2026-06-01T10:00:00.000Z'),
      },
      {
        workspaceId,
        providerName: 'exa',
        runType: 'daily',
        status: 'succeeded',
        startedAt: at('2026-06-02T10:00:00.000Z'),
      },
      ...(['partial', 'failed', 'started', 'skipped'] as const).map(
        (status) => ({
          workspaceId,
          providerName: 'exa',
          runType: 'daily' as const,
          status,
          startedAt: at('2026-06-03T10:00:00.000Z'),
        })
      ),
      {
        workspaceId,
        providerName: 'exa',
        runType: 'manual',
        status: 'succeeded',
        startedAt: at('2026-06-03T10:00:00.000Z'),
      },
      {
        workspaceId,
        providerName: 'semrush',
        runType: 'daily',
        status: 'succeeded',
        startedAt: at('2026-06-03T10:00:00.000Z'),
      },
      {
        workspaceId: otherWorkspaceId,
        providerName: 'exa',
        runType: 'daily',
        status: 'succeeded',
        startedAt: at('2026-06-03T10:00:00.000Z'),
      },
    ]);

    const result = await repository.getLastSuccessfulDailyRun({
      workspaceId,
      providerName: 'exa',
    });
    if (result.isError()) throw result.getError();
    expect(result.get()).toEqual({
      type: 'last_run_found',
      startedAt: at('2026-06-02T10:00:00.000Z'),
    });
  });
});
