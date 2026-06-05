import type { ApplicationResult } from '@/modules/kernel/application/result';
import type {
  CompetitorId,
  InternalNoteConfigId,
  KeywordId,
  ProviderConfigId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

import type {
  InternalNoteConfig,
  InternalNoteSystem,
  ProviderConfig,
  ProviderConfigWriteInput,
  ProviderName,
} from '../../domain/provider';
import type {
  Competitor,
  CompetitorState,
  Keyword,
  SocialAccount,
  Workspace,
  WorkspaceWriteInput,
} from '../../domain/workspace';

export type WorkspaceGetOutcome =
  | { type: 'workspace_found'; workspace: Workspace }
  | { type: 'workspace_not_found' };

export type WorkspaceUpdateOutcome =
  | { type: 'workspace_updated'; workspace: Workspace }
  | { type: 'workspace_not_found' };

export type CompetitorSetStateOutcome =
  | { type: 'competitor_updated'; competitor: Competitor }
  | { type: 'competitor_not_found' };

export type ProviderConfigGetOutcome =
  | { type: 'provider_config_found'; config: ProviderConfig }
  | { type: 'provider_config_not_found' };

export interface WorkspaceRepository {
  list(): Promise<ApplicationResult<Workspace[]>>;
  getById(id: WorkspaceId): Promise<ApplicationResult<WorkspaceGetOutcome>>;
  create(input: WorkspaceWriteInput): Promise<ApplicationResult<Workspace>>;
  update(
    id: WorkspaceId,
    input: WorkspaceWriteInput
  ): Promise<ApplicationResult<WorkspaceUpdateOutcome>>;

  listKeywords(
    workspaceId: WorkspaceId,
    options?: { activeOnly?: boolean }
  ): Promise<ApplicationResult<Keyword[]>>;
  createKeyword(input: {
    workspaceId: WorkspaceId;
    keywordString: string;
    active?: boolean;
  }): Promise<ApplicationResult<Keyword>>;
  setKeywordActive(
    workspaceId: WorkspaceId,
    keywordId: KeywordId,
    active: boolean
  ): Promise<
    ApplicationResult<{ type: 'keyword_updated' | 'keyword_not_found' }>
  >;

  listSocialAccounts(
    workspaceId: WorkspaceId
  ): Promise<ApplicationResult<SocialAccount[]>>;
  createSocialAccount(input: {
    workspaceId: WorkspaceId;
    platform?: string | null;
    username?: string | null;
    profileUrl?: string | null;
  }): Promise<ApplicationResult<SocialAccount>>;

  listCompetitors(
    workspaceId: WorkspaceId,
    options?: { states?: CompetitorState[] }
  ): Promise<ApplicationResult<Competitor[]>>;
  createCompetitor(input: {
    workspaceId: WorkspaceId;
    name: string;
    domain?: string | null;
    state?: CompetitorState;
  }): Promise<ApplicationResult<Competitor>>;
  setCompetitorState(
    workspaceId: WorkspaceId,
    competitorId: CompetitorId,
    state: CompetitorState
  ): Promise<ApplicationResult<CompetitorSetStateOutcome>>;

  listProviderConfigs(
    workspaceId: WorkspaceId
  ): Promise<ApplicationResult<ProviderConfig[]>>;
  getProviderConfig(
    workspaceId: WorkspaceId,
    providerName: ProviderName
  ): Promise<ApplicationResult<ProviderConfigGetOutcome>>;
  upsertProviderConfig(
    input: ProviderConfigWriteInput
  ): Promise<ApplicationResult<ProviderConfig>>;

  listInternalNoteConfigs(
    workspaceId: WorkspaceId,
    options?: { enabledOnly?: boolean }
  ): Promise<ApplicationResult<InternalNoteConfig[]>>;
  createInternalNoteConfig(input: {
    workspaceId: WorkspaceId;
    sourceSystem: InternalNoteSystem;
    sourceRef: string;
    enabled?: boolean;
  }): Promise<ApplicationResult<InternalNoteConfig>>;
  deleteInternalNoteConfig(
    workspaceId: WorkspaceId,
    id: InternalNoteConfigId
  ): Promise<
    ApplicationResult<{
      type: 'internal_note_deleted' | 'internal_note_not_found';
    }>
  >;
  deleteProviderConfig(
    workspaceId: WorkspaceId,
    id: ProviderConfigId
  ): Promise<
    ApplicationResult<{
      type: 'provider_config_deleted' | 'provider_config_not_found';
    }>
  >;
}
