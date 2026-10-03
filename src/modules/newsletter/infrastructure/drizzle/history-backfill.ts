import { Result } from '@swan-io/boxed';
import { eq } from 'drizzle-orm';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { Database } from '@/modules/kernel/infrastructure/db/types';

import { createNewsletterRepository } from './repository';
import {
  newsletterHistory,
  newsletterJob,
  newsletterWorkspace,
} from './schema';
import { resolveContextBudget } from '../../domain/processing';

export async function backfillNewsletterHistory(
  db: Database,
  operators: Record<string, string>
): Promise<ApplicationResult<{ type: 'backfilled'; workspaces: number }>> {
  try {
    const repository = createNewsletterRepository(db);
    const workspaces = await db.select().from(newsletterWorkspace);
    for (const row of workspaces) {
      const operator = operators[row.workspaceId];
      const saved = await repository.mutate(row.workspaceId, (state) => {
        if (operator && state.profile?.runtime.mode === 'local')
          state.profile.runtime.localOperatorId = operator;
        return Result.Ok({ value: { type: 'saved' as const } });
      });
      if (saved.isError()) return Result.Error(saved.getError());
      const jobs = await db
        .select()
        .from(newsletterJob)
        .where(eq(newsletterJob.workspaceId, row.workspaceId));
      for (const job of jobs) {
        const localOperatorId =
          job.localOperatorId ??
          (job.mode === 'local' ? (operator ?? null) : null);
        const runtime = localOperatorId
          ? { ...job.runtime, localOperatorId }
          : job.runtime;
        const budget = job.contextBudget ?? resolveContextBudget(runtime);
        const prefix = `publication:${row.workspaceId}:`;
        const reports = job.key.startsWith(prefix)
          ? job.key.slice(prefix.length).split(':').filter(Boolean)
          : [];
        await db
          .update(newsletterJob)
          .set({
            runtime,
            localOperatorId,
            contextBudget: budget,
            targetReportId:
              job.targetReportId ?? (reports.length === 1 ? reports[0] : null),
            checkpoint:
              operator && job.checkpoint.profile?.runtime.mode === 'local'
                ? {
                    ...job.checkpoint,
                    profile: {
                      ...job.checkpoint.profile,
                      runtime: {
                        ...job.checkpoint.profile.runtime,
                        localOperatorId: operator,
                      },
                    },
                  }
                : job.checkpoint,
          })
          .where(eq(newsletterJob.id, job.id));
        await db
          .insert(newsletterHistory)
          .values({
            id: `attempt:${job.id}`,
            workspaceId: row.workspaceId,
            jobId: job.id,
            kind: 'attempt',
            selectionId: job.selectionId,
            reportId: job.targetReportId,
            summary: `${job.kind} legacy attempt`,
            payload: job,
            createdAt: job.createdAt,
          })
          .onConflictDoNothing();
        if (job.failure)
          await db
            .insert(newsletterHistory)
            .values({
              id: `failure:${job.id}:legacy`,
              workspaceId: row.workspaceId,
              jobId: job.id,
              kind: 'failure',
              selectionId: job.selectionId,
              reportId: job.targetReportId,
              summary: job.failure,
              payload: { failure: job.failure, checkpoint: job.checkpoint },
              createdAt: job.createdAt,
            })
            .onConflictDoNothing();
        // A ledger entry suppresses duplicate reconciliation while a legacy
        // multi-report attempt completes. Its original attempt remains intact.
        for (const reportId of reports)
          await db
            .insert(newsletterJob)
            .values({
              ...job,
              id: `publication-ledger:${row.workspaceId}:${reportId}`,
              key: `${prefix}${reportId}`,
              runtime,
              localOperatorId,
              contextBudget: budget,
              targetReportId: reportId,
              parentAttemptId: job.id,
              status: job.status === 'failed' ? 'failed' : 'succeeded',
              stage: 'legacy-publication-ledger',
              checkpoint: {},
              leaseToken: null,
              leaseUntil: null,
            })
            .onConflictDoNothing();
      }
      for (const reportId of row.state.processedReports)
        await db
          .insert(newsletterJob)
          .values({
            id: `publication-ledger:${row.workspaceId}:${reportId}`,
            key: `publication:${row.workspaceId}:${reportId}`,
            workspaceId: row.workspaceId,
            kind: 'prepare',
            mode: row.state.profile?.runtime.mode ?? 'hosted',
            runtime: row.state.profile?.runtime ?? {
              mode: 'hosted',
              provider: 'openai',
              model: 'gpt-5-mini',
            },
            targetReportId: reportId,
            status: 'succeeded',
            stage: 'legacy-publication-ledger',
            checkpoint: {},
            localOperatorId: operator ?? null,
          })
          .onConflictDoNothing();
    }
    return Result.Ok({
      type: 'backfilled' as const,
      workspaces: workspaces.length,
    });
  } catch (cause) {
    return Result.Error(
      new AppError({
        code: 'NEWSLETTER_BACKFILL_FAILED',
        category: 'system',
        status: 500,
        message: 'Newsletter history backfill failed',
        cause,
      })
    );
  }
}
