import { Result } from '@swan-io/boxed';
import { and, asc, eq, gte, inArray, lte } from 'drizzle-orm';

import type { SourceRecordId, WorkspaceId } from '@/modules/kernel/domain/ids';
import {
  toSearchResultId,
  toSourceRecordId,
  toSourceSummaryId,
  toWorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';
import { observeRepository } from '@/modules/kernel/infrastructure/db/observability';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import {
  intelligenceInvariantError,
  mapIntelligenceDbError,
} from './map-db-error';
import {
  searchResult as searchResultTable,
  sourceRecord as sourceRecordTable,
  sourceSummary as sourceSummaryTable,
} from './schema';
import type { SourceRepository } from '../../application/ports/source-repository';
import type {
  SearchResultRecord,
  SearchResultWriteInput,
  SourceRecord,
  SourceRecordWriteInput,
  SourceSummary,
} from '../../domain/source';

type SourceRow = typeof sourceRecordTable.$inferSelect;
type SearchRow = typeof searchResultTable.$inferSelect;
type SummaryRow = typeof sourceSummaryTable.$inferSelect;

const toSourceRecord = (row: SourceRow): SourceRecord => ({
  id: toSourceRecordId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  providerName: row.providerName,
  providerSourceId: row.providerSourceId,
  sourceType: row.sourceType,
  sourceSubtype: row.sourceSubtype,
  sourceName: row.sourceName,
  sourceUrl: row.sourceUrl,
  externalUrl: row.externalUrl,
  title: row.title,
  authorOrAccount: row.authorOrAccount,
  domain: row.domain,
  publishedAt: row.publishedAt,
  capturedAt: row.capturedAt,
  contentText: row.contentText,
  diffAddedText: row.diffAddedText,
  diffRemovedText: row.diffRemovedText,
  rawPayload: row.rawPayload,
  metadata: row.metadata ?? null,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toSearchResult = (row: SearchRow): SearchResultRecord => ({
  id: toSearchResultId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  providerName: row.providerName,
  query: row.query,
  resultRank: row.resultRank,
  title: row.title,
  snippet: row.snippet,
  url: row.url,
  returnedAt: row.returnedAt,
  sourceRecordId: row.sourceRecordId
    ? toSourceRecordId(row.sourceRecordId)
    : null,
  rawPayload: row.rawPayload,
  metadata: row.metadata ?? null,
  createdAt: row.createdAt,
});

const toSourceSummary = (row: SummaryRow): SourceSummary => ({
  id: toSourceSummaryId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  sourceRecordId: toSourceRecordId(row.sourceRecordId),
  summaryText: row.summaryText,
  evidenceCandidateText: row.evidenceCandidateText,
  modelName: row.modelName,
  modelProvider: row.modelProvider,
  promptVersion: row.promptVersion,
  inputMetadata: row.inputMetadata ?? null,
  outputPayload: row.outputPayload,
  createdAt: row.createdAt,
});

export class SourceRepositoryDrizzle implements SourceRepository {
  constructor(private readonly db: DbLike) {}

  async getById(id: SourceRecordId) {
    try {
      const [row] = await this.db
        .select()
        .from(sourceRecordTable)
        .where(eq(sourceRecordTable.id, id))
        .limit(1);
      return Result.Ok(
        row
          ? ({
              type: 'source_record_found',
              sourceRecord: toSourceRecord(row),
            } as const)
          : ({ type: 'source_record_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'SOURCE_GET_ERROR'));
    }
  }

  async getManyByIds(workspaceId: WorkspaceId, ids: SourceRecordId[]) {
    try {
      if (ids.length === 0) return Result.Ok([]);
      const rows = await this.db
        .select()
        .from(sourceRecordTable)
        .where(
          and(
            eq(sourceRecordTable.workspaceId, workspaceId),
            inArray(sourceRecordTable.id, ids)
          )
        );
      return Result.Ok(rows.map(toSourceRecord));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SOURCE_GET_MANY_ERROR')
      );
    }
  }

  async createSourceRecord(input: SourceRecordWriteInput) {
    try {
      const [created] = await this.db
        .insert(sourceRecordTable)
        .values({
          workspaceId: input.workspaceId,
          providerName: input.providerName,
          providerSourceId: input.providerSourceId ?? null,
          sourceType: input.sourceType,
          sourceSubtype: input.sourceSubtype ?? null,
          sourceName: input.sourceName ?? null,
          sourceUrl: input.sourceUrl ?? null,
          externalUrl: input.externalUrl ?? null,
          title: input.title ?? null,
          authorOrAccount: input.authorOrAccount ?? null,
          domain: input.domain ?? null,
          publishedAt: input.publishedAt ?? null,
          capturedAt: input.capturedAt ?? undefined,
          contentText: input.contentText ?? null,
          diffAddedText: input.diffAddedText ?? null,
          diffRemovedText: input.diffRemovedText ?? null,
          rawPayload: input.rawPayload ?? null,
          metadata: input.metadata ?? null,
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'SOURCE_CREATE_EMPTY',
            'source record insert returned no row'
          )
        );
      }
      return Result.Ok(toSourceRecord(created));
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'SOURCE_CREATE_ERROR'));
    }
  }

  async listForPeriod(input: {
    workspaceId: WorkspaceId;
    periodStart: Date;
    periodEnd: Date;
    limit?: number;
  }) {
    try {
      const rows = await this.db
        .select()
        .from(sourceRecordTable)
        .where(
          and(
            eq(sourceRecordTable.workspaceId, input.workspaceId),
            gte(sourceRecordTable.capturedAt, input.periodStart),
            lte(sourceRecordTable.capturedAt, input.periodEnd)
          )
        )
        .orderBy(asc(sourceRecordTable.capturedAt))
        .limit(input.limit ?? 1000);
      return Result.Ok(rows.map(toSourceRecord));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SOURCE_LIST_PERIOD_ERROR')
      );
    }
  }

  async createSearchResult(input: SearchResultWriteInput) {
    try {
      const [created] = await this.db
        .insert(searchResultTable)
        .values({
          workspaceId: input.workspaceId,
          providerName: input.providerName,
          query: input.query,
          resultRank: input.resultRank ?? null,
          title: input.title ?? null,
          snippet: input.snippet ?? null,
          url: input.url ?? null,
          returnedAt: input.returnedAt ?? undefined,
          sourceRecordId: input.sourceRecordId ?? null,
          rawPayload: input.rawPayload ?? null,
          metadata: input.metadata ?? null,
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'SEARCH_RESULT_CREATE_EMPTY',
            'search result insert returned no row'
          )
        );
      }
      return Result.Ok(toSearchResult(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SEARCH_RESULT_CREATE_ERROR')
      );
    }
  }

  async createSourceSummary(input: {
    workspaceId: WorkspaceId;
    sourceRecordId: SourceRecordId;
    summaryText?: string | null;
    evidenceCandidateText?: string | null;
    modelName?: string | null;
    modelProvider?: string | null;
    promptVersion?: string | null;
    inputMetadata?: JsonObject | null;
    outputPayload?: JsonValue | null;
  }) {
    try {
      const [created] = await this.db
        .insert(sourceSummaryTable)
        .values({
          workspaceId: input.workspaceId,
          sourceRecordId: input.sourceRecordId,
          summaryText: input.summaryText ?? null,
          evidenceCandidateText: input.evidenceCandidateText ?? null,
          modelName: input.modelName ?? null,
          modelProvider: input.modelProvider ?? null,
          promptVersion: input.promptVersion ?? null,
          inputMetadata: input.inputMetadata ?? null,
          outputPayload: input.outputPayload ?? null,
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'SOURCE_SUMMARY_CREATE_EMPTY',
            'source summary insert returned no row'
          )
        );
      }
      return Result.Ok(toSourceSummary(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SOURCE_SUMMARY_CREATE_ERROR')
      );
    }
  }
}

export function createSourceRepository(dependencies: {
  db: DbLike;
}): SourceRepository {
  return observeRepository(
    new SourceRepositoryDrizzle(dependencies.db),
    'intelligence.source'
  );
}
