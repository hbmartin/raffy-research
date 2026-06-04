import type {
  ProviderConfig,
  Workspace,
} from '@/modules/kernel/infrastructure/db/schema';

import type { ProviderName } from '../../domain/intelligence';

export type NormalizedSourceInput = {
  providerSourceId?: string | null;
  sourceType: string;
  sourceSubtype?: string | null;
  sourceName?: string | null;
  sourceUrl?: string | null;
  externalUrl?: string | null;
  title?: string | null;
  authorOrAccount?: string | null;
  domain?: string | null;
  publishedAt?: Date | null;
  contentText?: string | null;
  diffAddedText?: string | null;
  diffRemovedText?: string | null;
  rawPayload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type NormalizedSearchResultInput = {
  providerName: ProviderName;
  query: string;
  resultRank?: number | null;
  title?: string | null;
  snippet?: string | null;
  url: string;
  returnedAt?: Date | null;
  rawPayload: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};

export type ProviderIngestionResult = {
  status: 'completed' | 'skipped';
  reason?: string;
  sourceRecords: NormalizedSourceInput[];
  searchResults: NormalizedSearchResultInput[];
  metadata?: Record<string, unknown>;
};

export type ProviderAdapterContext = {
  credential?: string;
  fetch: typeof fetch;
  now: Date;
  providerConfig: ProviderConfig;
  workspace: Workspace;
};

export type ProviderCallbackContext = {
  now: Date;
  payload: unknown;
  providerName: ProviderName;
};

export type ProviderAdapter = {
  providerName: ProviderName;
  ingest(input: ProviderAdapterContext): Promise<ProviderIngestionResult>;
  normalizeCallback(input: ProviderCallbackContext): ProviderIngestionResult;
};
