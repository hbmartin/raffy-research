import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { UserId, WorkspaceId } from '@/modules/kernel/domain/ids';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import type { WorkspaceUpdateOutcome } from '../ports/workspace-repository';
import type { Workspace, WorkspaceWriteInput } from '../../domain/workspace';

export type CreateWorkspaceInput = {
  currentUserId: UserId;
  workspace: WorkspaceWriteInput;
};

export async function createWorkspace(
  deps: IntelligenceUseCaseDeps,
  input: CreateWorkspaceInput
): Promise<
  ApplicationResult<
    { type: 'workspace_created'; workspace: Workspace } | ForbiddenOutcome
  >
> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    workspace: ['create'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  deps.logger.info({ event: 'intelligence.workspace.create' });
  const result = await deps.workspaceRepository.create(input.workspace);
  if (result.isError()) return Result.Error(result.getError());
  return Result.Ok({ type: 'workspace_created', workspace: result.get() });
}

export type UpdateWorkspaceInput = {
  currentUserId: UserId;
  workspaceId: WorkspaceId;
  workspace: WorkspaceWriteInput;
};

export async function updateWorkspace(
  deps: IntelligenceUseCaseDeps,
  input: UpdateWorkspaceInput
): Promise<ApplicationResult<WorkspaceUpdateOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    workspace: ['update'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  deps.logger.info({
    event: 'intelligence.workspace.update',
    details: { workspaceId: input.workspaceId },
  });
  return deps.workspaceRepository.update(input.workspaceId, input.workspace);
}
