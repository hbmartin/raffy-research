import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { SourceRecordId, WorkspaceId } from '@/modules/kernel/domain/ids';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

import type {
  SearchResultRecord,
  SearchResultWriteInput,
  SourceRecord,
  SourceRecordWriteInput,
  SourceSummary,
} from '../../domain/source';

export type SourceRecordGetOutcome =
  | { type: 'source_record_found'; sourceRecord: SourceRecord }
  | { type: 'source_record_not_found' };

export interface SourceRepository {
  getById(
    id: SourceRecordId
  ): Promise<ApplicationResult<SourceRecordGetOutcome>>;
  getManyByIds(
    workspaceId: WorkspaceId,
    ids: SourceRecordId[]
  ): Promise<ApplicationResult<SourceRecord[]>>;
  createSourceRecord(
    input: SourceRecordWriteInput
  ): Promise<ApplicationResult<SourceRecord>>;
  listForPeriod(input: {
    workspaceId: WorkspaceId;
    periodStart: Date;
    periodEnd: Date;
    limit?: number;
  }): Promise<ApplicationResult<SourceRecord[]>>;

  createSearchResult(
    input: SearchResultWriteInput
  ): Promise<ApplicationResult<SearchResultRecord>>;

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
