import type { Logger } from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { WorkspaceId } from '@/modules/kernel/domain/ids';
import type { JsonValue } from '@/modules/kernel/domain/json';

import type {
  InternalNoteConfig,
  ProviderConfig,
  ProviderName,
} from '../../domain/provider';
import type {
  SearchResultWriteInput,
  SourceRecordWriteInput,
} from '../../domain/source';
import type {
  Competitor,
  Keyword,
  SocialAccount,
  Workspace,
} from '../../domain/workspace';

export type NormalizedIngest = {
  sourceRecords: SourceRecordWriteInput[];
  searchResults: SearchResultWriteInput[];
  requestsSucceeded?: number;
  requestsFailed?: number;
};

export type ProviderDailyContext = {
  workspace: Workspace;
  keywords: Keyword[];
  competitors: Competitor[];
  socialAccounts: SocialAccount[];
  internalNoteConfigs: InternalNoteConfig[];
  config: ProviderConfig;
  credential: string | undefined;
  now: Date;
  periodStart: Date;
  logger: Logger;
};

export type ProviderCallbackContext = {
  workspaceId: WorkspaceId;
  credential: string | undefined;
  payload: JsonValue;
  logger: Logger;
};

export type CallbackNormalization =
  | {
      type: 'normalized';
      sourceRecords: SourceRecordWriteInput[];
      searchResults?: SearchResultWriteInput[];
    }
  | { type: 'unsupported' }
  | { type: 'invalid'; reason: string };

/**
 * A provider integration. Every provider is optional per workspace; when its
 * credential/config is missing, ingestion is skipped without blocking others.
 */
export interface ProviderAdapter {
  readonly name: ProviderName;
  isConfigured(input: {
    config: ProviderConfig | null;
    credential: string | undefined;
  }): boolean;
  /**
   * Opt out of the "since the last successful pull" window. Every pull instead
   * reaches `lookbackMs` back, overlapping earlier pulls, and results that are
   * exact copies of stored records are dropped before they are written.
   *
   * For providers whose dates cannot be trusted to place an item inside a
   * narrow window, such as Exa recording day-only publish dates and indexing
   * pages hours or days after publication.
   */
  readonly overlappingWindow?: { lookbackMs: number };
  /** Scheduled pull (e.g. daily web search, polling an API). */
  runDailyIngest?(
    ctx: ProviderDailyContext
  ): Promise<ApplicationResult<NormalizedIngest>>;
  /** Normalize an inbound webhook/callback payload into source records. */
  normalizeCallback?(
    ctx: ProviderCallbackContext
  ):
    | ApplicationResult<CallbackNormalization>
    | Promise<ApplicationResult<CallbackNormalization>>;
}

export interface ProviderRegistry {
  get(name: string): ProviderAdapter | undefined;
  all(): ProviderAdapter[];
}

/** Resolves a provider credential (an env var name stored in credentials_ref). */
export interface CredentialResolver {
  resolve(ref: string | null): string | undefined;
}

export type { ProviderName };
