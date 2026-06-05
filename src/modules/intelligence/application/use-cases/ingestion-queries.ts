import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { UserId, WorkspaceId } from '@/modules/kernel/domain/ids';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import type { ProviderCallbackEvent } from '../../domain/ingestion';

export type ListProviderCallbacksOutcome =
  | { type: 'callbacks_listed'; callbacks: ProviderCallbackEvent[] }
  | ForbiddenOutcome;

export type ListProviderCallbacksInput = {
  currentUserId: UserId;
  workspaceId: WorkspaceId;
  limit?: number;
};

export async function listProviderCallbacks(
  deps: IntelligenceUseCaseDeps,
  input: ListProviderCallbacksInput
): Promise<ApplicationResult<ListProviderCallbacksOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    workspace: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const result = await deps.ingestionRepository.listCallbackEvents({
    workspaceId: input.workspaceId,
    limit: input.limit,
  });

  if (result.isError()) return Result.Error(result.getError());

  return Result.Ok({
    type: 'callbacks_listed',
    callbacks: result.get(),
  });
}
