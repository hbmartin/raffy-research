import type {
  SearchResultId,
  SourceRecordId,
  SourceSummaryId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

export const SOURCE_RELEVANCE_LABELS = ['keep', 'junk'] as const;

export type SourceRelevanceLabel = (typeof SOURCE_RELEVANCE_LABELS)[number];

export function isSourceRelevanceLabel(
  value: string
): value is SourceRelevanceLabel {
  return (SOURCE_RELEVANCE_LABELS as readonly string[]).includes(value);
}

export type SourceRecord = {
  id: SourceRecordId;
  workspaceId: WorkspaceId;
  providerName: string;
  providerSourceId: string | null;
  sourceType: string;
  sourceSubtype: string | null;
  sourceName: string | null;
  sourceUrl: string | null;
  externalUrl: string | null;
  title: string | null;
  authorOrAccount: string | null;
  domain: string | null;
  publishedAt: Date | null;
  capturedAt: Date;
  contentText: string | null;
  diffAddedText: string | null;
  diffRemovedText: string | null;
  rawPayload: JsonValue | null;
  metadata: JsonObject | null;
  relevanceLabel: SourceRelevanceLabel | null;
  labeledAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
};

export type SourceRecordWriteInput = {
  workspaceId: WorkspaceId;
  providerName: string;
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
  capturedAt?: Date;
  contentText?: string | null;
  diffAddedText?: string | null;
  diffRemovedText?: string | null;
  rawPayload?: JsonValue | null;
  metadata?: JsonObject | null;
};

export type SearchResultRecord = {
  id: SearchResultId;
  workspaceId: WorkspaceId;
  providerName: string;
  query: string;
  resultRank: number | null;
  title: string | null;
  snippet: string | null;
  url: string | null;
  returnedAt: Date;
  sourceRecordId: SourceRecordId | null;
  rawPayload: JsonValue | null;
  metadata: JsonObject | null;
  createdAt: Date;
};

export type SearchResultWriteInput = {
  workspaceId: WorkspaceId;
  providerName: string;
  query: string;
  resultRank?: number | null;
  title?: string | null;
  snippet?: string | null;
  url?: string | null;
  returnedAt?: Date;
  sourceRecordId?: SourceRecordId | null;
  rawPayload?: JsonValue | null;
  metadata?: JsonObject | null;
};

export type SourceSummary = {
  id: SourceSummaryId;
  workspaceId: WorkspaceId;
  sourceRecordId: SourceRecordId;
  summaryText: string | null;
  evidenceCandidateText: string | null;
  modelName: string | null;
  modelProvider: string | null;
  promptVersion: string | null;
  inputMetadata: JsonObject | null;
  outputPayload: JsonValue | null;
  createdAt: Date;
};
