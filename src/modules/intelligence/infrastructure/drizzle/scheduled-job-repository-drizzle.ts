import { Result } from '@swan-io/boxed';
import { and, desc, eq, or, sql } from 'drizzle-orm';

import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import {
  intelligenceInvariantError,
  mapIntelligenceDbError,
} from './map-db-error';
import { scheduledJobRun, scheduledJobWorkspaceRun } from './schema';
import type { ScheduledJobRepository } from '../../application/ports/scheduled-job-repository';
import type { WorkspaceJobHistory } from '../../domain/scheduled-job';

export class ScheduledJobRepositoryDrizzle implements ScheduledJobRepository {
  constructor(private readonly db: DbLike) {}

  async start(input: Parameters<ScheduledJobRepository['start']>[0]) {
    try {
      await this.db
        .insert(scheduledJobRun)
        .values({
          id: input.id,
          kind: input.kind,
          status: 'started',
          startedAt: input.startedAt,
        })
        .onConflictDoNothing();
      return Result.Ok({ type: 'run_started' } as const);
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SCHEDULED_JOB_START_ERROR')
      );
    }
  }

  async finish(input: Parameters<ScheduledJobRepository['finish']>[0]) {
    try {
      const [updated] = await this.db
        .update(scheduledJobRun)
        .set({
          status: input.status,
          finishedAt: input.finishedAt,
          total: input.total,
          succeeded: input.succeeded,
          partial: input.partial,
          failed: input.failed,
          skipped: input.skipped,
          items: input.items,
          failureCode: input.failureCode,
        })
        .where(eq(scheduledJobRun.id, input.id))
        .returning({ id: scheduledJobRun.id });
      if (!updated) {
        return Result.Error(
          intelligenceInvariantError(
            'SCHEDULED_JOB_FINISH_MISSING',
            'Scheduled job vanished before finalization'
          )
        );
      }
      return Result.Ok({ type: 'run_finished' } as const);
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SCHEDULED_JOB_FINISH_ERROR')
      );
    }
  }

  async upsertWorkspace(
    input: Parameters<ScheduledJobRepository['upsertWorkspace']>[0]
  ) {
    try {
      const values = {
        jobRunId: input.jobRunId,
        workspaceId: input.workspaceId,
        status: input.status,
        startedAt: input.startedAt,
        finishedAt: input.finishedAt,
        succeeded: input.succeeded,
        partial: input.partial,
        failed: input.failed,
        skipped: input.skipped,
        items: input.items,
        failureCode: input.failureCode,
        reportId: input.reportId,
      };
      await this.db
        .insert(scheduledJobWorkspaceRun)
        .values(values)
        .onConflictDoUpdate({
          target: [
            scheduledJobWorkspaceRun.jobRunId,
            scheduledJobWorkspaceRun.workspaceId,
          ],
          set: values,
        });
      return Result.Ok({ type: 'workspace_recorded' } as const);
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SCHEDULED_JOB_WORKSPACE_ERROR')
      );
    }
  }

  async listForWorkspace(
    input: Parameters<ScheduledJobRepository['listForWorkspace']>[0]
  ) {
    try {
      const rows = await this.db
        .select({
          run: scheduledJobRun,
          workspace: scheduledJobWorkspaceRun,
        })
        .from(scheduledJobRun)
        .leftJoin(
          scheduledJobWorkspaceRun,
          and(
            eq(scheduledJobWorkspaceRun.jobRunId, scheduledJobRun.id),
            eq(scheduledJobWorkspaceRun.workspaceId, input.workspaceId)
          )
        )
        .where(
          or(
            eq(scheduledJobWorkspaceRun.workspaceId, input.workspaceId),
            and(
              eq(scheduledJobRun.status, 'failed'),
              eq(scheduledJobRun.total, 0),
              sql`${scheduledJobRun.failureCode} is not null`
            )
          )
        )
        .orderBy(desc(scheduledJobRun.startedAt))
        .limit(input.limit);
      return Result.Ok(
        rows.map(({ run, workspace }): WorkspaceJobHistory => ({
          run,
          workspace: workspace
            ? {
                ...workspace,
                workspaceId: input.workspaceId,
              }
            : null,
        }))
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SCHEDULED_JOB_LIST_ERROR')
      );
    }
  }
}

export const createScheduledJobRepository = ({
  db,
}: {
  db: DbLike;
}): ScheduledJobRepository => new ScheduledJobRepositoryDrizzle(db);
