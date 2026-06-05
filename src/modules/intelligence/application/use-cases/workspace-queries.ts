import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { UserId, WorkspaceId } from '@/modules/kernel/domain/ids';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import type { InternalNoteConfig, ProviderConfig } from '../../domain/provider';
import type {
  Competitor,
  Keyword,
  SocialAccount,
  Workspace,
} from '../../domain/workspace';

export type ListWorkspacesOutcome =
  | { type: 'workspaces_listed'; workspaces: Workspace[] }
  | ForbiddenOutcome;

export type ListWorkspacesInput = { currentUserId: UserId };

export async function listWorkspaces(
  deps: IntelligenceUseCaseDeps,
  input: ListWorkspacesInput
): Promise<ApplicationResult<ListWorkspacesOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    workspace: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const result = await deps.workspaceRepository.list();
  if (result.isError()) return Result.Error(result.getError());
  return Result.Ok({ type: 'workspaces_listed', workspaces: result.get() });
}

export type WorkspaceConfig = {
  workspace: Workspace;
  keywords: Keyword[];
  competitors: Competitor[];
  socialAccounts: SocialAccount[];
  providerConfigs: ProviderConfig[];
  internalNoteConfigs: InternalNoteConfig[];
};

export type GetWorkspaceConfigOutcome =
  | { type: 'workspace_config'; config: WorkspaceConfig }
  | { type: 'workspace_not_found' };

export type GetWorkspaceConfigInput = {
  currentUserId: UserId;
  workspaceId: WorkspaceId;
};

export async function getWorkspaceConfig(
  deps: IntelligenceUseCaseDeps,
  input: GetWorkspaceConfigInput
): Promise<ApplicationResult<GetWorkspaceConfigOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    workspace: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const workspaceResult = await deps.workspaceRepository.getById(
    input.workspaceId
  );
  if (workspaceResult.isError())
    return Result.Error(workspaceResult.getError());
  const workspaceOutcome = workspaceResult.get();
  if (workspaceOutcome.type === 'workspace_not_found') {
    return Result.Ok({ type: 'workspace_not_found' });
  }

  const [keywords, competitors, social, providers, notes] = await Promise.all([
    deps.workspaceRepository.listKeywords(input.workspaceId),
    deps.workspaceRepository.listCompetitors(input.workspaceId),
    deps.workspaceRepository.listSocialAccounts(input.workspaceId),
    deps.workspaceRepository.listProviderConfigs(input.workspaceId),
    deps.workspaceRepository.listInternalNoteConfigs(input.workspaceId),
  ]);

  if (keywords.isError()) return Result.Error(keywords.getError());
  if (competitors.isError()) return Result.Error(competitors.getError());
  if (social.isError()) return Result.Error(social.getError());
  if (providers.isError()) return Result.Error(providers.getError());
  if (notes.isError()) return Result.Error(notes.getError());

  return Result.Ok({
    type: 'workspace_config',
    config: {
      workspace: workspaceOutcome.workspace,
      keywords: keywords.get(),
      competitors: competitors.get(),
      socialAccounts: social.get(),
      providerConfigs: providers.get(),
      internalNoteConfigs: notes.get(),
    },
  });
}
