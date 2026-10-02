import { Result } from '@swan-io/boxed';
import { and, asc, eq, lt, or, sql } from 'drizzle-orm';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { Database } from '@/modules/kernel/infrastructure/db/types';

import { newsletterJob, newsletterWorkspace } from './schema';
import type { NewsletterRepository } from '../../application/ports';
import { emptyState } from '../../domain/newsletter';

const persistenceError = (cause: unknown) =>
  new AppError({
    code: 'NEWSLETTER_PERSISTENCE_FAILED',
    category: 'system',
    status: 500,
    message: 'Newsletter storage failed',
    cause,
  });
export function createNewsletterRepository(db: Database): NewsletterRepository {
  return {
    async read(workspaceId) {
      try {
        const rows = await db
          .select()
          .from(newsletterWorkspace)
          .where(eq(newsletterWorkspace.workspaceId, workspaceId));
        return Result.Ok(rows[0]?.state ?? emptyState());
      } catch (cause) {
        return Result.Error(persistenceError(cause));
      }
    },
    async mutate(workspaceId, work, lease) {
      try {
        if (!db.$runInTransaction)
          return Result.Error(
            persistenceError('Transactional database required')
          );
        return await db.$runInTransaction(async (tx) => {
          if (lease) {
            const held = await tx
              .select()
              .from(newsletterJob)
              .where(
                and(
                  eq(newsletterJob.id, lease.jobId),
                  eq(newsletterJob.leaseToken, lease.leaseToken),
                  eq(newsletterJob.status, 'running')
                )
              )
              .for('update');
            if (!held.length)
              return Result.Error(
                new AppError({
                  code: 'NEWSLETTER_LEASE_LOST',
                  category: 'system',
                  status: 409,
                  message: 'Job lease was lost',
                })
              );
          }
          await tx
            .insert(newsletterWorkspace)
            .values({ workspaceId, state: emptyState() })
            .onConflictDoNothing();
          const rows = await tx
            .select()
            .from(newsletterWorkspace)
            .where(eq(newsletterWorkspace.workspaceId, workspaceId))
            .for('update');
          const state = rows[0]?.state;
          if (!state)
            return Result.Error(
              persistenceError('Missing newsletter aggregate')
            );
          const outcome = work(state);
          if (outcome.isError()) return Result.Error(outcome.getError());
          state.revision += 1;
          await tx
            .update(newsletterWorkspace)
            .set({ state })
            .where(eq(newsletterWorkspace.workspaceId, workspaceId));
          const jobs = outcome.get().jobs ?? [];
          for (const job of jobs)
            await tx
              .insert(newsletterJob)
              .values({ ...job, mode: job.runtime.mode })
              .onConflictDoNothing({ target: newsletterJob.key });
          return Result.Ok(outcome.get().value);
        });
      } catch (cause) {
        return Result.Error(persistenceError(cause));
      }
    },
    async listJobs(workspaceId) {
      try {
        return Result.Ok(
          await db
            .select()
            .from(newsletterJob)
            .where(eq(newsletterJob.workspaceId, workspaceId))
            .orderBy(asc(newsletterJob.createdAt))
        );
      } catch (cause) {
        return Result.Error(persistenceError(cause));
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
        return Result.Error(persistenceError(cause));
      }
    },
    async claim(mode, now, token) {
      try {
        if (!db.$runInTransaction)
          return Result.Error(
            persistenceError('Transactional database required')
          );
        return await db.$runInTransaction(async (tx) => {
          const rows = await tx
            .select()
            .from(newsletterJob)
            .where(
              and(
                eq(newsletterJob.mode, mode),
                sql`not exists (select 1 from "newsletterJob" active where active."workspaceId" = ${newsletterJob.workspaceId} and active.id <> ${newsletterJob.id} and active.status = 'running' and active."leaseUntil" > ${now})`,
                or(
                  eq(newsletterJob.status, 'queued'),
                  and(
                    eq(newsletterJob.status, 'running'),
                    lt(newsletterJob.leaseUntil, now)
                  )
                )
              )
            )
            .orderBy(asc(newsletterJob.createdAt))
            .limit(1)
            .for('update', { skipLocked: true });
          const job = rows[0];
          if (!job) return Result.Ok({ type: 'queue_empty' as const });
          await tx
            .select()
            .from(newsletterWorkspace)
            .where(eq(newsletterWorkspace.workspaceId, job.workspaceId))
            .for('update');
          const competing = await tx
            .select({ id: newsletterJob.id })
            .from(newsletterJob)
            .where(
              and(
                eq(newsletterJob.workspaceId, job.workspaceId),
                eq(newsletterJob.status, 'running'),
                sql`${newsletterJob.id} <> ${job.id}`,
                sql`${newsletterJob.leaseUntil} > ${now}`
              )
            );
          if (competing.length)
            return Result.Ok({ type: 'queue_empty' as const });
          const leaseUntil = new Date(now.getTime() + 120_000);
          await tx
            .update(newsletterJob)
            .set({ status: 'running', leaseToken: token, leaseUntil })
            .where(eq(newsletterJob.id, job.id));
          return Result.Ok({
            type: 'job_claimed' as const,
            job: {
              ...job,
              status: 'running' as const,
              leaseToken: token,
              leaseUntil,
            },
          });
        });
      } catch (cause) {
        return Result.Error(persistenceError(cause));
      }
    },
    async checkpoint(job, values, token) {
      try {
        const rows = await db
          .update(newsletterJob)
          .set(values)
          .where(
            and(
              eq(newsletterJob.id, job.id),
              eq(newsletterJob.leaseToken, token),
              eq(newsletterJob.status, 'running')
            )
          )
          .returning({ id: newsletterJob.id });
        return Result.Ok({
          type: rows.length
            ? ('job_updated' as const)
            : ('lease_lost' as const),
        });
      } catch (cause) {
        return Result.Error(persistenceError(cause));
      }
    },
  };
}
