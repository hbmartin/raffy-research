import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { UserId, WorkspaceId } from '@/modules/kernel/domain/ids';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import type { WorkspaceJobHistory } from '../../domain/scheduled-job';

export type ListScheduledJobsOutcome =
  | { type: 'scheduled_jobs_listed'; runs: WorkspaceJobHistory[] }
  | ForbiddenOutcome;

export async function listScheduledJobs(
  deps: IntelligenceUseCaseDeps,
  input: { currentUserId: UserId; workspaceId: WorkspaceId }
): Promise<ApplicationResult<ListScheduledJobsOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    apps: ['manager'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });
  const result = await deps.scheduledJobRepository.listForWorkspace({
    workspaceId: input.workspaceId,
    limit: 20,
  });
  if (result.isError()) return Result.Error(result.getError());
  return Result.Ok({ type: 'scheduled_jobs_listed', runs: result.get() });
}
