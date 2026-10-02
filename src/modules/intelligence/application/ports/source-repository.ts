import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { SourceRecordId, WorkspaceId } from '@/modules/kernel/domain/ids';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

import type {
  SearchResultRecord,
  SearchResultWriteInput,
  SourceRecord,
  SourceRecordWriteInput,
  SourceRelevanceLabel,
  SourceSummary,
} from '../../domain/source';

export type SourceRecordGetOutcome =
  | { type: 'source_record_found'; sourceRecord: SourceRecord }
  | { type: 'source_record_not_found' };

export type SourceLabelOutcome =
  | { type: 'source_labeled'; sourceRecord: SourceRecord }
  | { type: 'source_record_not_found' };

export interface SourceRepository {
  getById(
    id: SourceRecordId
  ): Promise<ApplicationResult<SourceRecordGetOutcome>>;
  getManyByIds(
    workspaceId: WorkspaceId,
    ids: SourceRecordId[]
  ): Promise<ApplicationResult<SourceRecord[]>>;
  listLatestSummariesForSources(input: {
    workspaceId: WorkspaceId;
    sourceRecordIds: SourceRecordId[];
    /** Restrict to one model, so a newer run by another model is not picked. */
    modelName?: string;
  }): Promise<ApplicationResult<SourceSummary[]>>;
  createSourceRecord(
    input: SourceRecordWriteInput
  ): Promise<ApplicationResult<SourceRecord>>;
  /**
   * Drop records that are exact copies of one already stored: same provider,
   * same page (canonical URL) and same text, captured since `capturedSince`.
   * A page whose text changed is kept as a new version. Records without a
   * usable URL are always kept, since nothing proves they were seen before.
   */
  excludeStoredCopies(input: {
    workspaceId: WorkspaceId;
    providerName: string;
    capturedSince: Date;
    records: SourceRecordWriteInput[];
  }): Promise<
    ApplicationResult<{ fresh: SourceRecordWriteInput[]; storedCopies: number }>
  >;
  listForPeriod(input: {
    workspaceId: WorkspaceId;
    periodStart: Date;
    periodEnd: Date;
    limit?: number;
  }): Promise<ApplicationResult<SourceRecord[]>>;
  setRelevanceLabel(input: {
    workspaceId: WorkspaceId;
    sourceRecordId: SourceRecordId;
    label: SourceRelevanceLabel | null;
    labeledAt: Date;
  }): Promise<ApplicationResult<SourceLabelOutcome>>;

  createSearchResult(
    input: SearchResultWriteInput
  ): Promise<ApplicationResult<SearchResultRecord>>;
  createCallbackArtifacts(input: {
    sourceRecords: SourceRecordWriteInput[];
    searchResults?: SearchResultWriteInput[];
  }): Promise<
    ApplicationResult<{
      sourceRecords: SourceRecord[];
      searchResults: SearchResultRecord[];
    }>
  >;

  createSourceSummary(input: {
    workspaceId: WorkspaceId;
    sourceRecordId: SourceRecordId;
    summaryText?: string | null;
    evidenceCandidateText?: string | null;
    modelName?: string | null;
    modelProvider?: string | null;
    promptVersion?: string | null;
    inputMetadata?: JsonObject | null;
    outputPayload?: JsonValue | null;
  }): Promise<ApplicationResult<SourceSummary>>;
}
