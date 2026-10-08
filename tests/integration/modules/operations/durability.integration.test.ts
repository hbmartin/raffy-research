import { Result } from '@swan-io/boxed';
import { createPgliteTestDatabase } from '@tests/server/pglite';
import { eq, sql } from 'drizzle-orm';
import { readFile } from 'node:fs/promises';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import {
  authDrizzleSchema,
  createMachineCredentials,
  createMachinePermissionChecker,
  machineCredential,
} from '@/modules/auth/testing';
import {
  createAgentResearch,
  judgmentRecord,
} from '@/modules/intelligence/testing';
import { toUserId } from '@/modules/kernel';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { executeOperation, type Operation } from '@/modules/operations';
import {
  agentOperation,
  createOperationRepository,
  enqueueOperation,
  operationTransaction,
} from '@/modules/operations/testing';

const ok = <T>(result: Result<T, AppError>): T => {
  if (result.isError()) throw result.getError();
  return result.get();
};
const request = {
  workspaceId: 'ws',
  userId: 'manager',
  credentialId: 'machine',
  kind: 'generate' as const,
  key: 'first',
  input: { model: 'fixture', period: '2026-10-04' },
};

describe('Durable operations, credentials, and PostgreSQL fencing', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;
  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  afterAll(async () => {
    await database.close();
  });
  beforeEach(async () => {
    await database.truncate();
  });
  const repository = () => createOperationRepository(database.db);
  const claim = async (): Promise<Operation> => {
    const value = ok(await repository().claim('machine'));
    if (value.type !== 'operation_claimed') throw new Error('No claim');
    return value.operation;
  };

  it('backfills legacy human rubric rows without changing their score projection', async () => {
    const migration = await readFile(
      'drizzle/migrations/0020_low_veda.sql',
      'utf8'
    );
    const backfill = migration
      .split('--> statement-breakpoint')
      .find((statement) => statement.includes('INSERT INTO "judgmentRecord"'))!;
    await database.db.$runInTransaction!(async (tx) => {
      await tx.execute(
        sql.raw(
          `CREATE TEMP TABLE "reportRubricScore" (id text, "workspaceId" text, "reportId" text, "userId" text, relevance integer, accuracy integer, novelty integer, note text, "updatedAt" timestamptz) ON COMMIT DROP`
        )
      );
      await tx.execute(
        sql.raw(
          `CREATE TEMP TABLE "judgmentRecord" (LIKE public."judgmentRecord" INCLUDING DEFAULTS INCLUDING INDEXES) ON COMMIT DROP`
        )
      );
      await tx.execute(
        sql`INSERT INTO "reportRubricScore" VALUES ('original-id','ws','frozen-report-id','historical-actor',4,5,3,'Historical note','2026-05-01T00:00:00Z')`
      );
      await tx.execute(sql.raw(backfill));
      await tx.execute(sql.raw(backfill));
      const judgments = await tx.execute<{
        id: string;
        targetId: string;
        provenance: Record<string, string>;
      }>(sql`SELECT id, "targetId", provenance FROM "judgmentRecord"`);
      expect(judgments).toMatchObject({
        rows: [
          {
            id: 'legacy-rubric:original-id',
            targetId: 'frozen-report-id',
            provenance: {
              origin: 'human',
              channel: 'legacy',
              actorId: 'historical-actor',
            },
          },
        ],
      });
      const score = await tx.execute<{
        id: string;
        relevance: number;
        note: string;
      }>(sql`SELECT id, relevance, note FROM "reportRubricScore"`);
      expect(score).toMatchObject({
        rows: [{ id: 'original-id', relevance: 4, note: 'Historical note' }],
      });
    });
  });

  it('atomically deduplicates concurrent starts and preserves changed-payload conflicts', async () => {
    const outputs = await Promise.all(
      Array.from({ length: 8 }, () => enqueueOperation(database.db, request))
    );
    const values = outputs.map(ok);
    expect(new Set(values.map((item) => item.operationId)).size).toBe(1);
    expect(
      values.filter((item) => item.type === 'operation_queued')
    ).toHaveLength(1);
    expect(
      ok(
        await enqueueOperation(database.db, {
          ...request,
          input: { model: 'changed' },
        })
      ).type
    ).toBe('idempotency_conflict');
    expect(await database.db.select().from(agentOperation)).toHaveLength(1);
  });

  it('rolls back native settings and enqueue when their audit write fails', async () => {
    const started = await enqueueOperation(database.db, request, async (tx) => {
      await tx.insert(judgmentRecord).values({
        id: 'decision',
        workspaceId: 'ws',
        targetId: 'report',
        kind: 'editorial',
        provenance: { origin: 'assistant' },
        payload: {},
      });
      return Result.Error(
        new AppError({ code: 'AUDIT_FAILED', category: 'system', status: 500 })
      );
    });
    expect(started.isError()).toBe(true);
    expect(await database.db.select().from(judgmentRecord)).toHaveLength(0);
    expect(await database.db.select().from(agentOperation)).toHaveLength(0);
  });

  it('allows one workspace claim, fences stale workers, and rejects cancelled publication', async () => {
    await enqueueOperation(database.db, request);
    const competing = await Promise.all([
      repository().claim('machine'),
      repository().claim('machine'),
    ]);
    expect(
      competing.map(ok).filter((item) => item.type === 'operation_claimed')
    ).toHaveLength(1);
    const first = competing
      .map(ok)
      .find((item) => item.type === 'operation_claimed')!;
    if (first.type !== 'operation_claimed') throw new Error('No claim');
    await database.db
      .update(agentOperation)
      .set({ leaseUntil: sql`clock_timestamp() - interval '1 second'` })
      .where(eq(agentOperation.id, first.operation.id));
    const replacement = await claim();
    expect(
      ok(await repository().update(first.operation, { status: 'succeeded' }))
        .type
    ).toBe('lease_lost');
    await repository().cancel('manager', replacement.id);
    const publication = await operationTransaction(
      database.db,
      replacement,
      'publication',
      async (tx) =>
        createAgentResearch(tx).recordJudgment({
          workspaceId: 'ws',
          targetId: 'r',
          kind: 'evaluation',
          provenance: { origin: 'automated' },
          payload: {},
        })
    );
    expect(publication.isError()).toBe(true);
    expect(await database.db.select().from(judgmentRecord)).toHaveLength(0);
  });

  it('restarts without repeating model responses or committed publication', async () => {
    await enqueueOperation(database.db, request);
    const operation = await claim();
    let paidCalls = 0,
      publications = 0;
    const executor = async (
      _operation: Operation,
      context: Parameters<Parameters<typeof executeOperation>[0]['executor']>[1]
    ) => {
      const model = await context.step('model', true, async () => {
        paidCalls++;
        return Result.Ok({ type: 'text_generated', text: 'fixture' });
      });
      if (model.isError()) return Result.Error(model.getError());
      return context.step('publication', false, () =>
        operationTransaction(
          database.db,
          operation,
          'publication',
          async (tx) => {
            publications++;
            await tx.insert(judgmentRecord).values({
              id: 'publication',
              workspaceId: 'ws',
              targetId: 'report-version',
              kind: 'evaluation',
              provenance: { origin: 'automated' },
              payload: {},
            });
            return Result.Ok({
              type: 'report_published',
              reportId: 'report-version',
            });
          }
        )
      );
    };
    await executeOperation({
      operation,
      repository: repository(),
      executor,
      signal: new AbortController().signal,
    });
    await database.db
      .update(agentOperation)
      .set({ status: 'queued' })
      .where(eq(agentOperation.id, operation.id));
    await executeOperation({
      operation: await claim(),
      repository: repository(),
      executor,
      signal: new AbortController().signal,
    });
    expect(paidCalls).toBe(1);
    expect(publications).toBe(1);
  });

  it('pauses an unknown external dispatch and links an explicit retry without losing completed artifacts', async () => {
    const queued = ok(await enqueueOperation(database.db, request));
    const operation = await claim();
    await repository().update(operation, {
      checkpoint: {
        steps: {
          capture: {
            status: 'completed',
            result: { type: 'captured', sourceId: 'source-version' },
          },
          model: { status: 'dispatched', external: true },
        },
      },
    });
    await database.db
      .update(agentOperation)
      .set({ status: 'queued' })
      .where(eq(agentOperation.id, operation.id));
    let calls = 0;
    const result = await executeOperation({
      operation: await claim(),
      repository: repository(),
      executor: async () => {
        calls++;
        return Result.Ok({ type: 'generated' });
      },
      signal: new AbortController().signal,
    });
    expect(ok(result).type).toBe('reconciliation_required');
    expect(calls).toBe(0);
    const retry = ok(
      await enqueueOperation(database.db, {
        ...request,
        key: 'retry',
        parentId: String(queued.operationId),
      })
    );
    const found = ok(
      await repository().get('manager', String(retry.operationId))
    );
    expect(found.type).toBe('operation_found');
    if (found.type === 'operation_found') {
      expect(found.operation.parentId).toBe(operation.id);
      expect(found.operation.checkpoint).toEqual({
        steps: {
          capture: {
            status: 'completed',
            result: { type: 'captured', sourceId: 'source-version' },
          },
        },
      });
    }
  });

  it('retains known responses on cancellation and checks authorization before each stage', async () => {
    await enqueueOperation(database.db, request);
    const operation = await claim();
    const controller = new AbortController();
    let publications = 0;
    const result = await executeOperation({
      operation,
      repository: repository(),
      signal: controller.signal,
      authorize: async () => Result.Ok({ type: 'authorized' }),
      executor: async (_operation, context) => {
        await context.step('model', true, async () => {
          await repository().cancel('manager', operation.id);
          controller.abort();
          return Result.Ok({ type: 'text_generated', text: 'known response' });
        });
        return context.step('publication', false, async () => {
          publications++;
          return Result.Ok({
            type: 'report_published',
            reportId: 'unexpected',
          });
        });
      },
    });
    expect(ok(result).type).toBe('operation_interrupted');
    expect(publications).toBe(0);
    const found = ok(await repository().get('manager', operation.id));
    if (found.type !== 'operation_found') throw new Error('Missing operation');
    expect(found.operation.checkpoint).toMatchObject({
      steps: {
        model: { status: 'completed', result: { text: 'known response' } },
      },
    });
    await database.truncate();
    await enqueueOperation(database.db, request);
    const next = await claim();
    let authorized = true;
    const denied = await executeOperation({
      operation: next,
      repository: repository(),
      signal: new AbortController().signal,
      authorize: async () =>
        Result.Ok({ type: authorized ? 'authorized' : 'forbidden' }),
      executor: async (_operation, context) => {
        await context.step('response', true, async () => {
          authorized = false;
          return Result.Ok({ type: 'text_generated', text: 'cached' });
        });
        return context.step('publication', false, async () => {
          publications++;
          return Result.Ok({ type: 'report_published' });
        });
      },
    });
    expect(ok(denied).type).toBe('forbidden');
    expect(publications).toBe(0);
  });

  it('paginates safely across concurrent inserts and isolates operation actors', async () => {
    for (let i = 0; i < 5; i++)
      await enqueueOperation(database.db, { ...request, key: String(i) });
    const first = ok(await repository().list('manager', 'ws', { limit: 2 }));
    await enqueueOperation(database.db, { ...request, key: 'later' });
    const second = ok(
      await repository().list('manager', 'ws', {
        limit: 2,
        cursor: String(first.nextCursor),
      })
    );
    const ids = [
      ...(first.operations as { id: string }[]),
      ...(second.operations as { id: string }[]),
    ].map((row) => row.id);
    expect(new Set(ids).size).toBe(4);
    expect(ok(await repository().get('another-user', ids[0]!)).type).toBe(
      'not_found'
    );
    expect(JSON.stringify(first)).not.toContain('checkpoint');
  });

  it('checks pairing denial/expiry, hashed credentials, revocation, bans, and restricted grants', async () => {
    await database.db.insert(authDrizzleSchema.user).values([
      {
        id: 'manager',
        email: 'manager@example.test',
        name: 'Manager',
        role: 'admin',
        emailVerified: true,
      },
      {
        id: 'reader',
        email: 'reader@example.test',
        name: 'Reader',
        role: 'user',
        emailVerified: true,
      },
    ]);
    const auth = createMachineCredentials(database.db);
    const pair = ok(
      await auth.begin({ name: 'Machine', capabilities: ['pipeline'] })
    );
    expect(
      ok(
        await auth.approve({
          id: pair.id,
          code: pair.code,
          userId: 'reader',
          approve: true,
        })
      ).type
    ).toBe('forbidden');
    expect(ok(await auth.authenticate(pair.id, pair.secret)).type).toBe(
      'machine_unauthorized'
    );
    expect(
      ok(
        await auth.approve({
          id: pair.id,
          code: pair.code,
          userId: 'manager',
          approve: true,
        })
      ).type
    ).toBe('credential_approved');
    expect(ok(await auth.authenticate(pair.id, pair.secret)).type).toBe(
      'machine_authenticated'
    );
    const [stored] = await database.db.select().from(machineCredential);
    expect(stored!.secretHash).not.toBe(pair.secret);
    expect(JSON.stringify(ok(await auth.list('manager')))).not.toContain(
      pair.secret
    );
    expect(
      ok(
        await createMachinePermissionChecker(database.db, pair).hasPermission(
          toUserId('manager'),
          { report: ['score'] }
        )
      ).type
    ).toBe('permission_denied');
    await database.db
      .update(authDrizzleSchema.user)
      .set({ role: 'user' })
      .where(eq(authDrizzleSchema.user.id, 'manager'));
    expect(
      ok(
        await createMachinePermissionChecker(database.db, pair).hasPermission(
          toUserId('manager'),
          { apps: ['manager'] }
        )
      ).type
    ).toBe('permission_denied');
    await database.db
      .update(authDrizzleSchema.user)
      .set({ role: 'admin', banned: true })
      .where(eq(authDrizzleSchema.user.id, 'manager'));
    expect(ok(await auth.authenticate(pair.id, pair.secret)).type).toBe(
      'machine_unauthorized'
    );
    await database.db
      .update(authDrizzleSchema.user)
      .set({ banned: false })
      .where(eq(authDrizzleSchema.user.id, 'manager'));
    await database.db
      .update(machineCredential)
      .set({ expiresAt: new Date(0) })
      .where(eq(machineCredential.id, pair.id));
    expect(ok(await auth.authenticate(pair.id, pair.secret)).type).toBe(
      'machine_unauthorized'
    );
    await database.db
      .update(machineCredential)
      .set({ expiresAt: new Date(Date.now() + 30_000) })
      .where(eq(machineCredential.id, pair.id));
    await auth.revoke('manager', pair.id);
    expect(ok(await auth.authenticate(pair.id, pair.secret)).type).toBe(
      'machine_unauthorized'
    );
    const expired = ok(
      await auth.begin({ name: 'Expired', capabilities: ['research'] })
    );
    await database.db
      .update(machineCredential)
      .set({ pairingExpiresAt: new Date(0) })
      .where(eq(machineCredential.id, expired.id));
    expect(
      ok(
        await auth.approve({
          id: expired.id,
          code: expired.code,
          userId: 'manager',
          approve: true,
        })
      ).type
    ).toBe('pairing_expired');
    const denied = ok(
      await auth.begin({ name: 'Denied', capabilities: ['research'] })
    );
    await auth.approve({
      id: denied.id,
      code: denied.code,
      userId: 'reader',
      approve: false,
    });
    expect(ok(await auth.authenticate(denied.id, denied.secret)).type).toBe(
      'machine_unauthorized'
    );
  });
});
