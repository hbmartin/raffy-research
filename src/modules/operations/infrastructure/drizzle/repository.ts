import { Result } from '@swan-io/boxed';
import { and, desc, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type {
  Database,
  DbLike,
} from '@/modules/kernel/infrastructure/db/types';

import { agentOperation, agentOperationEvent } from './schema';
import type { OperationRepository } from '../../application/ports';
import {
  type BusinessOutcome,
  type Operation,
  operationSummary,
  type PageInput,
} from '../../domain/operation';

const persistence = (cause: unknown) =>
  cause instanceof AppError
    ? cause
    : new AppError({
        code: 'OPERATIONS_STORAGE_FAILED',
        category: 'system',
        status: 500,
        message: 'Operation storage failed',
        cause,
      });
const guarded = async <T>(
  work: () => Promise<T>
): Promise<ApplicationResult<T>> => {
  try {
    return Result.Ok(await work());
  } catch (cause) {
    return Result.Error(persistence(cause));
  }
};
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, canonical(item)])
    );
  return value;
};
const held = (operation: Operation) =>
  and(
    eq(agentOperation.id, operation.id),
    eq(agentOperation.leaseToken, operation.leaseToken!),
    eq(agentOperation.status, 'running'),
    sql`${agentOperation.leaseUntil} > clock_timestamp()`
  );
const cursorFor = (row: { createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString(
    'base64url'
  );
export const beforeCursor = (page: PageInput) => {
  if (!page.cursor) return undefined;
  const [date, id] = z
    .tuple([z.iso.datetime(), z.string().min(1)])
    .parse(JSON.parse(Buffer.from(page.cursor, 'base64url').toString()));
  return { date: new Date(date), id };
};

/** Bind existing root-database repositories to the encompassing transaction. */
export function transactionDatabase(db: Database, tx: DbLike): Database {
  return new Proxy(tx as Database, {
    get(target, key) {
      if (key === '$runInTransaction')
        return (work: (client: DbLike) => Promise<unknown>) => work(tx);
      if (key === '$close') return async () => {};
      if (key === '$driver') return db.$driver;
      if (key === '$transactionCapable') return true;
      const value: unknown = Reflect.get(target, key);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}

export async function enqueueOperation(
  db: Database,
  input: Pick<
    Operation,
    'workspaceId' | 'userId' | 'credentialId' | 'kind' | 'key' | 'input'
  > & { parentId?: string },
  native?: (
    transaction: Database
  ) => Promise<ApplicationResult<BusinessOutcome>>
): Promise<ApplicationResult<BusinessOutcome>> {
  return guarded(async () => {
    if (!db.$runInTransaction)
      throw new AppError({
        code: 'TRANSACTION_REQUIRED',
        category: 'system',
        status: 500,
      });
    return db.$runInTransaction(async (tx) => {
      const key = `${input.kind}:${input.key}`;
      const fingerprint = createHash('sha256')
        .update(
          JSON.stringify(
            canonical({ input: input.input, parentId: input.parentId ?? null })
          )
        )
        .digest('hex');
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`${input.userId}:${input.workspaceId}:${key}`}, 0))`
      );
      const [existing] = await tx
        .select()
        .from(agentOperation)
        .where(
          and(
            eq(agentOperation.userId, input.userId),
            eq(agentOperation.workspaceId, input.workspaceId),
            eq(agentOperation.key, key)
          )
        )
        .limit(1);
      if (existing)
        return existing.fingerprint === fingerprint
          ? {
              type: 'operation_exists',
              operationId: existing.id,
              status: existing.status,
            }
          : {
              type: 'idempotency_conflict',
              operationId: existing.id,
              recovery:
                'Reuse the original arguments or supply a new idempotency key.',
            };
      const nativeResult = native
        ? await native(transactionDatabase(db, tx))
        : undefined;
      if (nativeResult?.isError()) throw nativeResult.getError();
      const value = nativeResult?.isOk() ? nativeResult.get() : undefined;
      if (value && value.type !== 'queued' && value.type !== 'saved')
        return value;
      const jobIds = z.array(z.string()).safeParse(value?.jobIds);
      const externalJobId =
        typeof value?.jobId === 'string'
          ? value.jobId
          : jobIds.success
            ? (jobIds.data[0] ?? null)
            : null;
      const id = randomUUID();
      const [parent] = input.parentId
        ? await tx
            .select()
            .from(agentOperation)
            .where(
              and(
                eq(agentOperation.id, input.parentId),
                eq(agentOperation.userId, input.userId),
                eq(agentOperation.workspaceId, input.workspaceId)
              )
            )
        : [];
      const steps = z
        .record(z.string(), z.object({ status: z.string() }).passthrough())
        .parse(parent?.checkpoint.steps ?? {});
      const checkpoint = {
        steps: Object.fromEntries(
          Object.entries(steps).filter(
            ([, step]) => step.status === 'completed'
          )
        ),
      };
      await tx.insert(agentOperation).values({
        ...input,
        input: {
          ...input.input,
          ...(input.input.period === 'current'
            ? { period: new Date().toISOString() }
            : {}),
        },
        id,
        key,
        fingerprint,
        checkpoint,
        parentId: input.parentId ?? null,
        externalJobId,
        status: native && !externalJobId ? 'succeeded' : 'queued',
        result: native ? value : null,
      });
      return {
        type: 'operation_queued',
        operationId: id,
        ...(externalJobId ? { jobId: externalJobId } : {}),
        ...(value?.selectionId ? { selectionId: value.selectionId } : {}),
      };
    });
  });
}

export async function syncExternalOperation(
  db: Database,
  userId: string,
  id: string,
  status: Operation['status'],
  result: BusinessOutcome
) {
  return guarded(async () => {
    await db
      .update(agentOperation)
      .set({ status, result })
      .where(
        and(
          eq(agentOperation.id, id),
          eq(agentOperation.userId, userId),
          sql`${agentOperation.externalJobId} is not null`
        )
      );
    return { type: 'external_operation_synchronized' };
  });
}

export async function pendingExternalOperations(
  db: Database,
  credentialId: string
) {
  return guarded(async () => ({
    type: 'external_operations_listed',
    operations: await db
      .select()
      .from(agentOperation)
      .where(
        and(
          eq(agentOperation.credentialId, credentialId),
          eq(agentOperation.kind, 'newsletter'),
          inExternalStates()
        )
      )
      .orderBy(agentOperation.createdAt)
      .limit(20),
  }));
}
const inExternalStates = () =>
  or(eq(agentOperation.status, 'queued'), eq(agentOperation.status, 'running'));

export function createOperationRepository(db: Database): OperationRepository {
  return {
    get: (userId, id) =>
      guarded(async () => {
        const [operation] = await db
          .select()
          .from(agentOperation)
          .where(
            and(eq(agentOperation.id, id), eq(agentOperation.userId, userId))
          )
          .limit(1);
        return operation
          ? { type: 'operation_found' as const, operation }
          : { type: 'not_found' as const };
      }),
    list: (userId, workspaceId, page) =>
      guarded(async () => {
        const cursor = beforeCursor(page);
        const rows = await db
          .select()
          .from(agentOperation)
          .where(
            and(
              eq(agentOperation.userId, userId),
              eq(agentOperation.workspaceId, workspaceId),
              cursor
                ? or(
                    lt(agentOperation.createdAt, cursor.date),
                    and(
                      eq(agentOperation.createdAt, cursor.date),
                      lt(agentOperation.id, cursor.id)
                    )
                  )
                : undefined
            )
          )
          .orderBy(desc(agentOperation.createdAt), desc(agentOperation.id))
          .limit(page.limit + 1);
        const items = rows.slice(0, page.limit);
        return {
          type: 'operations_listed',
          operations: items.map(operationSummary),
          nextCursor:
            rows.length > page.limit ? cursorFor(items.at(-1)!) : null,
        };
      }),
    claim: (credentialId) =>
      guarded(async () => {
        if (!db.$runInTransaction)
          throw new AppError({
            code: 'TRANSACTION_REQUIRED',
            category: 'system',
            status: 500,
          });
        return db.$runInTransaction(async (tx) => {
          const candidates = await tx
            .select()
            .from(agentOperation)
            .where(
              and(
                eq(agentOperation.credentialId, credentialId),
                isNull(agentOperation.externalJobId),
                or(
                  eq(agentOperation.status, 'queued'),
                  and(
                    eq(agentOperation.status, 'running'),
                    sql`${agentOperation.leaseUntil} <= clock_timestamp()`
                  )
                )
              )
            )
            .orderBy(agentOperation.createdAt)
            .limit(20)
            .for('update', { skipLocked: true });
          for (const candidate of candidates) {
            // Taking the workspace lock serializes competing claims on different rows.
            await tx.execute(
              sql`select pg_advisory_xact_lock(hashtextextended(${`operation-workspace:${candidate.workspaceId}`}, 0))`
            );
            const [active] = await tx
              .select({ id: agentOperation.id })
              .from(agentOperation)
              .where(
                and(
                  eq(agentOperation.workspaceId, candidate.workspaceId),
                  eq(agentOperation.status, 'running'),
                  sql`${agentOperation.leaseUntil} > clock_timestamp()`
                )
              )
              .limit(1);
            if (active) continue;
            if (candidate.cancelRequested) {
              await tx
                .update(agentOperation)
                .set({
                  status: 'cancelled',
                  leaseToken: null,
                  leaseUntil: null,
                })
                .where(eq(agentOperation.id, candidate.id));
              continue;
            }
            const [operation] = await tx
              .update(agentOperation)
              .set({
                status: 'running',
                leaseToken: randomUUID(),
                leaseUntil: sql`clock_timestamp() + interval '2 minutes'`,
              })
              .where(eq(agentOperation.id, candidate.id))
              .returning();
            if (operation)
              return { type: 'operation_claimed' as const, operation };
          }
          return { type: 'queue_empty' as const };
        });
      }),
    update: (operation, values) =>
      guarded(async () => {
        const terminal = values.status && values.status !== 'running';
        const rows = await db
          .update(agentOperation)
          .set({
            ...values,
            ...(terminal ? { leaseUntil: null, leaseToken: null } : {}),
          })
          .where(held(operation))
          .returning({ id: agentOperation.id });
        return {
          type: rows.length ? ('updated' as const) : ('lease_lost' as const),
        };
      }),
    heartbeat: (operation) =>
      guarded(async () => {
        const [row] = await db
          .update(agentOperation)
          .set({ leaseUntil: sql`clock_timestamp() + interval '2 minutes'` })
          .where(held(operation))
          .returning({ cancelRequested: agentOperation.cancelRequested });
        return row
          ? { type: 'renewed' as const, ...row }
          : { type: 'lease_lost' as const };
      }),
    cancel: (userId, id) =>
      guarded(async () => {
        const [row] = await db
          .update(agentOperation)
          .set({
            cancelRequested: true,
            status: sql`case when ${agentOperation.status} = 'queued' then 'cancelled' else ${agentOperation.status} end`,
          })
          .where(
            and(
              eq(agentOperation.id, id),
              eq(agentOperation.userId, userId),
              or(
                eq(agentOperation.status, 'queued'),
                eq(agentOperation.status, 'running')
              )
            )
          )
          .returning({ id: agentOperation.id });
        return {
          type: row ? 'cancellation_requested' : 'operation_not_cancellable',
          operationId: id,
        };
      }),
    event: (operation, data) =>
      guarded(async () => {
        await db.insert(agentOperationEvent).select(
          db
            .select({
              id: sql<string>`${randomUUID()}`.as('id'),
              operationId: agentOperation.id,
              data: sql<BusinessOutcome>`${JSON.stringify(data)}::jsonb`.as(
                'data'
              ),
              createdAt: sql<Date>`clock_timestamp()`.as('createdAt'),
            })
            .from(agentOperation)
            .where(held(operation))
        );
        return { type: 'event_recorded' };
      }),
    events: (userId, id, page) =>
      guarded(async () => {
        const cursor = beforeCursor(page);
        const rows = await db
          .select({
            id: agentOperationEvent.id,
            createdAt: agentOperationEvent.createdAt,
            data: agentOperationEvent.data,
          })
          .from(agentOperationEvent)
          .innerJoin(
            agentOperation,
            eq(agentOperation.id, agentOperationEvent.operationId)
          )
          .where(
            and(
              eq(agentOperation.userId, userId),
              eq(agentOperation.id, id),
              cursor
                ? or(
                    lt(agentOperationEvent.createdAt, cursor.date),
                    and(
                      eq(agentOperationEvent.createdAt, cursor.date),
                      lt(agentOperationEvent.id, cursor.id)
                    )
                  )
                : undefined
            )
          )
          .orderBy(
            desc(agentOperationEvent.createdAt),
            desc(agentOperationEvent.id)
          )
          .limit(page.limit + 1);
        return {
          type: 'events_listed',
          events: rows.slice(0, page.limit),
          nextCursor:
            rows.length > page.limit ? cursorFor(rows[page.limit - 1]!) : null,
        };
      }),
  };
}

/** Publication and its durable checkpoint commit together under the operation fence. */
export async function operationTransaction<T extends BusinessOutcome>(
  db: Database,
  operation: Operation,
  stage: string,
  work: (transaction: Database) => Promise<ApplicationResult<T>>
): Promise<ApplicationResult<T>> {
  try {
    if (!db.$runInTransaction)
      throw new AppError({
        code: 'TRANSACTION_REQUIRED',
        category: 'system',
        status: 500,
      });
    return await db.$runInTransaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(agentOperation)
        .where(held(operation))
        .for('update');
      if (!row || row.cancelRequested)
        throw new AppError({
          code: 'OPERATION_FENCE_LOST',
          category: 'conflict',
          status: 409,
        });
      const result = await work(transactionDatabase(db, tx));
      if (result.isError()) throw result.getError();
      const steps = z
        .record(z.string(), z.unknown())
        .parse(row.checkpoint.steps ?? {});
      await tx
        .update(agentOperation)
        .set({
          checkpoint: {
            ...row.checkpoint,
            steps: {
              ...steps,
              [stage]: { status: 'completed', result: result.get() },
            },
          },
        })
        .where(held(operation));
      return result;
    });
  } catch (cause) {
    return Result.Error(persistence(cause));
  }
}
