import { Result } from '@swan-io/boxed';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  inArray,
  or,
  sql,
} from 'drizzle-orm';
import { z } from 'zod';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { queryRowsSchema } from '@/modules/kernel/infrastructure/db/query-rows';
import type {
  Database,
  DbLike,
} from '@/modules/kernel/infrastructure/db/types';

import {
  newsletterEvidence,
  newsletterHistory,
  newsletterJob,
  newsletterWorkspace,
} from './schema';
import type { NewsletterRepository } from '../../application/ports';
import {
  type DraftVersion,
  emptyState,
  type NewsletterJob,
  type NewsletterState,
} from '../../domain/newsletter';

const persistenceError = (cause: unknown) =>
  new AppError({
    code: 'NEWSLETTER_PERSISTENCE_FAILED',
    category: 'system',
    status: 500,
    message: 'Newsletter storage failed',
    cause,
  });
const leaseLost = () =>
  new AppError({
    code: 'NEWSLETTER_LEASE_LOST',
    category: 'system',
    status: 409,
    message: 'Job lease was lost',
  });
const heldLease = (workspaceId: string, jobId: string, token: string) =>
  and(
    eq(newsletterJob.workspaceId, workspaceId),
    eq(newsletterJob.id, jobId),
    eq(newsletterJob.leaseToken, token),
    eq(newsletterJob.status, 'running'),
    sql`${newsletterJob.leaseUntil} > clock_timestamp()`
  );
const lightweightDraft = sql<DraftVersion>`(${newsletterHistory.payload} - 'auditHistory') || jsonb_build_object(
  'sources', coalesce((select jsonb_agg(s - 'content') from jsonb_array_elements(${newsletterHistory.payload}->'sources') s), '[]'::jsonb),
  'profile', (${newsletterHistory.payload}->'profile') || jsonb_build_object('samples', '[]'::jsonb)
)`;

export function createNewsletterRepository(db: Database): NewsletterRepository {
  const hydrate = async (
    client: DbLike,
    state: NewsletterState,
    workspaceId: string,
    options?: { content?: boolean; drafts?: boolean }
  ) => {
    if (options?.content !== false && state.sources.length) {
      const records = await client
        .select()
        .from(newsletterEvidence)
        .where(
          and(
            eq(newsletterEvidence.workspaceId, workspaceId),
            inArray(
              newsletterEvidence.id,
              state.sources.map((s) => `${workspaceId}:${s.id}`)
            )
          )
        );
      const byId = new Map(records.map((r) => [r.payload.id, r.payload]));
      state.sources = state.sources.map((source) => ({
        ...byId.get(source.id),
        ...source,
        content: byId.get(source.id)?.content ?? source.content,
      }));
    }
    if (options?.drafts !== false) {
      const drafts = await client
        .select({
          payload:
            options?.content === false
              ? lightweightDraft
              : newsletterHistory.payload,
        })
        .from(newsletterHistory)
        .where(
          and(
            eq(newsletterHistory.workspaceId, workspaceId),
            eq(newsletterHistory.kind, 'draft')
          )
        )
        .orderBy(desc(newsletterHistory.createdAt), desc(newsletterHistory.id))
        .limit(20);
      const legacy = state.drafts;
      state.drafts = [
        ...drafts.map((d) => d.payload as DraftVersion).reverse(),
        ...legacy.filter(
          (d) => !drafts.some((r) => (r.payload as DraftVersion).id === d.id)
        ),
      ];
    }
    return state;
  };
  return {
    async read(workspaceId, options) {
      try {
        const [row] = await db
          .select()
          .from(newsletterWorkspace)
          .where(eq(newsletterWorkspace.workspaceId, workspaceId));
        return Result.Ok(
          await hydrate(db, row?.state ?? emptyState(), workspaceId, options)
        );
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async mutate(workspaceId, work, lease, options) {
      try {
        if (!db.$runInTransaction)
          return Result.Error(
            persistenceError('Transactional database required')
          );
        return await db.$runInTransaction(async (tx) => {
          // Lock order is consistent with claim: workspace, then job.
          await tx
            .insert(newsletterWorkspace)
            .values({ workspaceId, state: emptyState() })
            .onConflictDoNothing();
          const [row] = await tx
            .select()
            .from(newsletterWorkspace)
            .where(eq(newsletterWorkspace.workspaceId, workspaceId))
            .for('update');
          if (lease) {
            const [held] = await tx
              .select({ id: newsletterJob.id })
              .from(newsletterJob)
              .where(heldLease(workspaceId, lease.jobId, lease.leaseToken))
              .for('update');
            if (!held) return Result.Error(leaseLost());
          }
          if (!row)
            return Result.Error(
              persistenceError('Missing newsletter aggregate')
            );
          const state = await hydrate(tx, row.state, workspaceId, options);
          const activeJobs = await tx
            .select({ selectionId: newsletterJob.selectionId })
            .from(newsletterJob)
            .where(
              and(
                eq(newsletterJob.workspaceId, workspaceId),
                inArray(newsletterJob.status, ['queued', 'running'])
              )
            );
          const outcome = work(state, {
            activeSelectionIds: activeJobs.flatMap((j) =>
              j.selectionId ? [j.selectionId] : []
            ),
          });
          if (outcome.isError()) return Result.Error(outcome.getError());
          const mutation = outcome.get();
          let inserted = 0;
          for (const job of mutation.jobs ?? []) {
            const [created] = await tx
              .insert(newsletterJob)
              .values({ ...job, mode: job.runtime.mode })
              .onConflictDoNothing({ target: newsletterJob.key })
              .returning({ id: newsletterJob.id });
            if (created) {
              inserted++;
              await tx.insert(newsletterHistory).values({
                id: `attempt:${job.id}`,
                workspaceId,
                kind: 'attempt',
                jobId: job.id,
                reportId: job.targetReportId,
                selectionId: job.selectionId,
                summary: `${job.kind} attempt`,
                payload: {
                  runtime: job.runtime,
                  parentAttemptId: job.parentAttemptId,
                  initiatingActorId: job.initiatingActorId,
                  contextBudget: job.contextBudget,
                  budget: job.budget,
                },
                createdAt: job.createdAt,
              });
            }
          }
          if (
            mutation.jobs?.length &&
            !inserted &&
            mutation.alreadyPresent !== undefined
          )
            return Result.Ok(mutation.alreadyPresent);
          for (const draft of state.drafts)
            await tx
              .insert(newsletterHistory)
              .values({
                id: draft.id,
                workspaceId,
                kind: 'draft',
                jobId: draft.jobId,
                selectionId: draft.selectionId,
                reportId: state.selections.find(
                  (s) => s.id === draft.selectionId
                )?.reportId,
                summary: draft.subject,
                payload: draft,
                createdAt: new Date(draft.createdAt),
              })
              .onConflictDoNothing();
          for (const offer of state.offerHistory ?? [])
            await tx
              .insert(newsletterHistory)
              .values({
                id: `offer:${offer.jobId}`,
                workspaceId,
                kind: 'offer',
                jobId: offer.jobId,
                reportId: offer.reportId,
                summary: `${offer.themes.length} offered themes`,
                payload: offer,
                createdAt: new Date(offer.createdAt),
              })
              .onConflictDoNothing();
          for (const retired of state.retired ?? [])
            await tx
              .insert(newsletterHistory)
              .values({
                id: `retired:${workspaceId}:${state.revision}:${retired.entity}:${retired.id}`,
                workspaceId,
                kind: 'retired',
                jobId: lease?.jobId ?? 'working-history',
                summary: `Retired ${retired.entity}`,
                payload: retired,
              })
              .onConflictDoNothing();
          for (const source of state.sources)
            if (source.content)
              await tx
                .insert(newsletterEvidence)
                .values({
                  id: `${workspaceId}:${source.id}`,
                  workspaceId,
                  payload: source,
                })
                .onConflictDoUpdate({
                  target: newsletterEvidence.id,
                  set: { payload: source },
                  setWhere: sql`${newsletterEvidence.payload} is distinct from ${JSON.stringify(source)}::jsonb`,
                });
          if (lease) {
            const [stillHeld] = await tx
              .select({ id: newsletterJob.id })
              .from(newsletterJob)
              .where(heldLease(workspaceId, lease.jobId, lease.leaseToken));
            if (!stillHeld) throw leaseLost();
          }
          state.revision++;
          const projection = {
            ...state,
            drafts: [],
            offerHistory: [],
            retired: [],
            sources: state.sources.map((s) => ({ ...s, content: '' })),
          };
          await tx
            .update(newsletterWorkspace)
            .set({ state: projection })
            .where(eq(newsletterWorkspace.workspaceId, workspaceId));
          return Result.Ok(
            mutation.jobs?.length &&
              !inserted &&
              mutation.alreadyPresent !== undefined
              ? mutation.alreadyPresent
              : mutation.value
          );
        });
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async listJobSummaries(workspaceId) {
      try {
        const {
          checkpoint: _checkpoint,
          leaseToken: _leaseToken,
          ...columns
        } = getTableColumns(newsletterJob);
        const active = await db
          .select(columns)
          .from(newsletterJob)
          .where(
            and(
              eq(newsletterJob.workspaceId, workspaceId),
              inArray(newsletterJob.status, ['queued', 'running'])
            )
          )
          .orderBy(asc(newsletterJob.createdAt), asc(newsletterJob.id))
          .limit(20);
        const recent = await db
          .select(columns)
          .from(newsletterJob)
          .where(
            and(
              eq(newsletterJob.workspaceId, workspaceId),
              inArray(newsletterJob.status, ['failed', 'succeeded'])
            )
          )
          .orderBy(desc(newsletterJob.createdAt), desc(newsletterJob.id))
          .limit(20);
        return Result.Ok([...active, ...recent]);
      } catch (cause) {
        return Result.Error(persistenceError(cause));
      }
    },
    async listJobs(workspaceId, options) {
      try {
        const active = await db
          .select({
            ...getTableColumns(newsletterJob),
            checkpoint: options?.summaries
              ? sql<NewsletterJob['checkpoint']>`'{}'::jsonb`
              : newsletterJob.checkpoint,
          })
          .from(newsletterJob)
          .where(
            and(
              eq(newsletterJob.workspaceId, workspaceId),
              inArray(newsletterJob.status, ['queued', 'running'])
            )
          )
          .orderBy(asc(newsletterJob.createdAt))
          .limit(20);
        const recent = await db
          .select({
            ...getTableColumns(newsletterJob),
            checkpoint: options?.summaries
              ? sql<NewsletterJob['checkpoint']>`'{}'::jsonb`
              : newsletterJob.checkpoint,
          })
          .from(newsletterJob)
          .where(
            and(
              eq(newsletterJob.workspaceId, workspaceId),
              inArray(newsletterJob.status, ['succeeded', 'failed'])
            )
          )
          .orderBy(desc(newsletterJob.createdAt))
          .limit(20);
        return Result.Ok([...recent.reverse(), ...active]);
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async getJob(workspaceId, jobId) {
      try {
        const [job] = await db
          .select()
          .from(newsletterJob)
          .where(
            and(
              eq(newsletterJob.workspaceId, workspaceId),
              eq(newsletterJob.id, jobId)
            )
          );
        return Result.Ok(
          job
            ? ({ type: 'job_found', job } as const)
            : ({ type: 'not_found' } as const)
        );
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async history(workspaceId, before) {
      try {
        const rows = await db
          .select({
            id: newsletterHistory.id,
            kind: newsletterHistory.kind,
            createdAt: newsletterHistory.createdAt,
            reportId: newsletterHistory.reportId,
            selectionId: newsletterHistory.selectionId,
            jobId: newsletterHistory.jobId,
            summary: newsletterHistory.summary,
          })
          .from(newsletterHistory)
          .where(
            and(
              eq(newsletterHistory.workspaceId, workspaceId),
              before
                ? sql`(${newsletterHistory.createdAt}, ${newsletterHistory.id}) < (select "createdAt", id from "newsletterHistory" where id = ${before} and "workspaceId" = ${workspaceId})`
                : undefined
            )
          )
          .orderBy(
            desc(newsletterHistory.createdAt),
            desc(newsletterHistory.id)
          )
          .limit(21);
        return Result.Ok({
          type: 'history_found' as const,
          entries: rows
            .slice(0, 20)
            .map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
          nextCursor: rows.length > 20 ? rows[19]!.id : null,
        });
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async detail(workspaceId, id) {
      try {
        const [row] = await db
          .select({ payload: newsletterHistory.payload })
          .from(newsletterHistory)
          .where(
            and(
              eq(newsletterHistory.workspaceId, workspaceId),
              eq(newsletterHistory.id, id)
            )
          );
        return Result.Ok(
          row
            ? ({ type: 'detail_found', payload: row.payload } as const)
            : ({ type: 'not_found' } as const)
        );
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async recordFailure(job, unit, failure, payload, token) {
      try {
        if (!db.$runInTransaction)
          return Result.Error(
            persistenceError('Transactional database required')
          );
        return await db.$runInTransaction(async (tx) => {
          const [held] = await tx
            .select({ id: newsletterJob.id })
            .from(newsletterJob)
            .where(heldLease(job.workspaceId, job.id, token))
            .for('update');
          if (!held) return Result.Ok({ type: 'lease_lost' as const });
          const attempt =
            job.checkpoint.unitFailures?.[unit]?.length ??
            job.checkpoint.repairs ??
            0;
          await tx
            .insert(newsletterHistory)
            .values({
              id: `failure:${job.id}:${unit}:${attempt}`,
              workspaceId: job.workspaceId,
              kind: 'failure',
              jobId: job.id,
              reportId: job.targetReportId,
              selectionId: job.selectionId,
              summary: failure,
              payload,
            })
            .onConflictDoNothing();
          return Result.Ok({ type: 'recorded' as const });
        });
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async pendingPublications(workspaceId) {
      try {
        // This indexed publication lookup does not load report payloads or evidence.
        // Coverage columns hold UTC timestamps without a zone.
        const publications = await db.execute<{
          workspaceId: string;
          reportId: string;
        }>(sql`
          select r."workspaceId", r.id as "reportId"
          from "weeklyReport" r
          join "newsletterWorkspace" n on n."workspaceId" = r."workspaceId"
          where r.status = 'published'
            and n.state->'profile'->>'enabled' = 'true'
            and r."periodEnd" >= (clock_timestamp() at time zone 'UTC') - interval '180 days'
            and r."periodStart" <= (clock_timestamp() at time zone 'UTC')
            ${workspaceId ? sql`and r."workspaceId" = ${workspaceId}` : sql``}
            and not exists (
              select 1 from "newsletterJob" j
              where j.key = 'publication:' || r."workspaceId" || ':' || r.id
            )
          order by r."periodStart", r."publishedAt"
        `);
        return Result.Ok(
          queryRowsSchema(
            z.object({
              workspaceId: z.string(),
              reportId: z.string(),
            })
          ).parse(publications)
        );
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async enabledWorkspaces() {
      try {
        const rows = await db
          .select({ workspaceId: newsletterWorkspace.workspaceId })
          .from(newsletterWorkspace)
          .where(
            sql`${newsletterWorkspace.state}->'profile'->>'enabled' = 'true'`
          );
        return Result.Ok(rows.map((r) => r.workspaceId));
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async claim(mode, _now, token, localOperatorId) {
      try {
        if (!db.$runInTransaction)
          return Result.Error(
            persistenceError('Transactional database required')
          );
        if (mode === 'local' && !localOperatorId)
          return Result.Ok({ type: 'queue_empty' as const });
        return await db.$runInTransaction(async (tx) => {
          // Take a workspace lock before any job lock, across both runtimes.
          const [workspaceRow] = await tx
            .select({ workspaceId: newsletterWorkspace.workspaceId })
            .from(newsletterWorkspace)
            .where(sql`exists (select 1 from "newsletterJob" j where j."workspaceId" = ${newsletterWorkspace.workspaceId} and j.mode = ${mode}
              and (${mode} <> 'local' or j."localOperatorId" = ${localOperatorId ?? ''})
              and (j.status = 'queued' or (j.status = 'running' and j."leaseUntil" <= clock_timestamp())))
              and not exists (select 1 from "newsletterJob" active where active."workspaceId" = ${newsletterWorkspace.workspaceId} and active.status = 'running' and active."leaseUntil" > clock_timestamp())`)
            .orderBy(asc(newsletterWorkspace.workspaceId))
            .limit(1)
            .for('update', { skipLocked: true });
          if (!workspaceRow) return Result.Ok({ type: 'queue_empty' as const });
          const [active] = await tx
            .select({ id: newsletterJob.id })
            .from(newsletterJob)
            .where(
              and(
                eq(newsletterJob.workspaceId, workspaceRow.workspaceId),
                eq(newsletterJob.status, 'running'),
                sql`${newsletterJob.leaseUntil} > clock_timestamp()`
              )
            );
          if (active) return Result.Ok({ type: 'queue_empty' as const });
          const [job] = await tx
            .select()
            .from(newsletterJob)
            .where(
              and(
                eq(newsletterJob.workspaceId, workspaceRow.workspaceId),
                eq(newsletterJob.mode, mode),
                mode === 'local'
                  ? eq(newsletterJob.localOperatorId, localOperatorId!)
                  : undefined,
                or(
                  eq(newsletterJob.status, 'queued'),
                  and(
                    eq(newsletterJob.status, 'running'),
                    sql`${newsletterJob.leaseUntil} <= clock_timestamp()`
                  )
                )
              )
            )
            .orderBy(asc(newsletterJob.createdAt), asc(newsletterJob.id))
            .limit(1)
            .for('update');
          if (!job) return Result.Ok({ type: 'queue_empty' as const });
          const [claimed] = await tx
            .update(newsletterJob)
            .set({
              status: 'running',
              leaseToken: token,
              leaseUntil: sql`clock_timestamp() + interval '2 minutes'`,
            })
            .where(eq(newsletterJob.id, job.id))
            .returning();
          return Result.Ok({ type: 'job_claimed' as const, job: claimed! });
        });
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
    async checkpoint(job, values, token) {
      try {
        const rows = await db
          .update(newsletterJob)
          .set({
            ...values,
            leaseUntil:
              values.status && values.status !== 'running'
                ? null
                : sql`clock_timestamp() + interval '2 minutes'`,
          })
          .where(heldLease(job.workspaceId, job.id, token))
          .returning({ id: newsletterJob.id });
        return Result.Ok({
          type: rows.length
            ? ('job_updated' as const)
            : ('lease_lost' as const),
        });
      } catch (cause) {
        return Result.Error(
          cause instanceof AppError ? cause : persistenceError(cause)
        );
      }
    },
  };
}
