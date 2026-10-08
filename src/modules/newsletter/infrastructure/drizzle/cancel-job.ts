import { Result } from '@swan-io/boxed';
import { and, eq, inArray } from 'drizzle-orm';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { Database } from '@/modules/kernel/infrastructure/db/types';

import { newsletterJob, newsletterWorkspace } from './schema';

export async function cancelNewsletterJob(
  db: Database,
  workspaceId: string,
  jobId: string
): Promise<
  ApplicationResult<{ type: 'newsletter_cancelled' | 'job_not_cancellable' }>
> {
  try {
    if (!db.$runInTransaction)
      return Result.Error(
        new AppError({
          code: 'TRANSACTION_REQUIRED',
          category: 'system',
          status: 500,
        })
      );
    return await db.$runInTransaction(async (tx) => {
      await tx
        .select()
        .from(newsletterWorkspace)
        .where(eq(newsletterWorkspace.workspaceId, workspaceId))
        .for('update');
      const [job] = await tx
        .update(newsletterJob)
        .set({
          status: 'failed',
          failure: 'Cancelled by authenticated operator',
          leaseToken: null,
          leaseUntil: null,
        })
        .where(
          and(
            eq(newsletterJob.workspaceId, workspaceId),
            eq(newsletterJob.id, jobId),
            inArray(newsletterJob.status, ['queued', 'running'])
          )
        )
        .returning({ id: newsletterJob.id });
      return Result.Ok({
        type: job
          ? ('newsletter_cancelled' as const)
          : ('job_not_cancellable' as const),
      });
    });
  } catch (cause) {
    return Result.Error(
      new AppError({
        code: 'NEWSLETTER_CANCEL_FAILED',
        category: 'system',
        status: 500,
        cause,
      })
    );
  }
}
