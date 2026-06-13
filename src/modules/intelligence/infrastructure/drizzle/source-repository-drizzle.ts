import { Result } from '@swan-io/boxed';
import { and, asc, desc, eq, gte, inArray, lte } from 'drizzle-orm';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { SourceRecordId, WorkspaceId } from '@/modules/kernel/domain/ids';
import {
  toSearchResultId,
  toSourceRecordId,
  toSourceSummaryId,
  toWorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';
import { observeRepository } from '@/modules/kernel/infrastructure/db/observability';
import {
  type DbLike,
  isTransactionCapableDatabase,
} from '@/modules/kernel/infrastructure/db/types';

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
  SourceRelevanceLabel,
  SourceSummary,
} from '../../domain/source';
import { normalizeHttpUrl } from '../../domain/url';

type SourceRow = typeof sourceRecordTable.$inferSelect;
type SearchRow = typeof searchResultTable.$inferSelect;
type SummaryRow = typeof sourceSummaryTable.$inferSelect;

const toSourceRecordInsert = (
  input: SourceRecordWriteInput
): typeof sourceRecordTable.$inferInsert => ({
  workspaceId: input.workspaceId,
  providerName: input.providerName,
  providerSourceId: input.providerSourceId ?? null,
  sourceType: input.sourceType,
  sourceSubtype: input.sourceSubtype ?? null,
  sourceName: input.sourceName ?? null,
  sourceUrl: normalizeHttpUrl(input.sourceUrl),
  externalUrl: normalizeHttpUrl(input.externalUrl),
  title: input.title ?? null,
  authorOrAccount: input.authorOrAccount ?? null,
  domain: input.domain ?? null,
  publishedAt: input.publishedAt ?? null,
  capturedAt: input.capturedAt ?? undefined,
  contentText: input.contentText ?? null,
  diffAddedText: input.diffAddedText ?? null,
  diffRemovedText: input.diffRemovedText ?? null,
  rawPayload: input.rawPayload ?? {},
  metadata: input.metadata ?? {},
});

const toSearchResultInsert = (
  input: SearchResultWriteInput
): typeof searchResultTable.$inferInsert => ({
  workspaceId: input.workspaceId,
  providerName: input.providerName,
  query: input.query,
  resultRank: input.resultRank ?? null,
  title: input.title ?? null,
  snippet: input.snippet ?? null,
  url: normalizeHttpUrl(input.url),
  returnedAt: input.returnedAt ?? undefined,
  sourceRecordId: input.sourceRecordId ?? null,
  rawPayload: input.rawPayload ?? {},
  metadata: input.metadata ?? {},
});

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
  relevanceLabel: row.relevanceLabel,
  labeledAt: row.labeledAt,
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

  private async runWriteBatch<T>(work: (db: DbLike) => Promise<T>): Promise<T> {
    if (isTransactionCapableDatabase(this.db)) {
      return this.db.$runInTransaction(work);
    }
    return work(this.db);
  }

  private async insertSourceRecord(
    db: DbLike,
    input: SourceRecordWriteInput
  ): Promise<SourceRecord> {
    const [created] = await db
      .insert(sourceRecordTable)
      .values(toSourceRecordInsert(input))
      .returning();
    if (!created) {
      throw intelligenceInvariantError(
        'SOURCE_CREATE_EMPTY',
        'source record insert returned no row'
      );
    }
    return toSourceRecord(created);
  }

  private async insertSearchResult(
    db: DbLike,
    input: SearchResultWriteInput
  ): Promise<SearchResultRecord> {
    const [created] = await db
      .insert(searchResultTable)
      .values(toSearchResultInsert(input))
      .returning();
    if (!created) {
      throw intelligenceInvariantError(
        'SEARCH_RESULT_CREATE_EMPTY',
        'search result insert returned no row'
      );
    }
    return toSearchResult(created);
  }

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

  async listLatestSummariesForSources(input: {
    workspaceId: WorkspaceId;
    sourceRecordIds: SourceRecordId[];
  }) {
    try {
      if (input.sourceRecordIds.length === 0) return Result.Ok([]);
      const rows = await this.db
        .select()
        .from(sourceSummaryTable)
        .where(
          and(
            eq(sourceSummaryTable.workspaceId, input.workspaceId),
            inArray(sourceSummaryTable.sourceRecordId, input.sourceRecordIds)
          )
        )
        .orderBy(
          asc(sourceSummaryTable.sourceRecordId),
          desc(sourceSummaryTable.createdAt)
        );

      const latestBySourceId = new Map<string, SummaryRow>();
      for (const row of rows) {
        if (!latestBySourceId.has(row.sourceRecordId)) {
          latestBySourceId.set(row.sourceRecordId, row);
        }
      }

      return Result.Ok([...latestBySourceId.values()].map(toSourceSummary));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SOURCE_SUMMARY_LIST_LATEST_ERROR')
      );
    }
  }

  async createSourceRecord(input: SourceRecordWriteInput) {
    try {
      return Result.Ok(await this.insertSourceRecord(this.db, input));
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
      const limit = input.limit ?? 1000;
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
        .limit(limit + 1);
      if (rows.length > limit) {
        return Result.Error(
          new AppError({
            code: 'SOURCE_LIST_PERIOD_LIMIT_EXCEEDED',
            category: 'system',
            status: 500,
            message:
              'Source list exceeded the period limit; narrow the source set or add pagination before generation.',
            details: {
              workspaceId: input.workspaceId,
              periodStart: input.periodStart.toISOString(),
              periodEnd: input.periodEnd.toISOString(),
              limit,
            },
          })
        );
      }
      return Result.Ok(rows.map(toSourceRecord));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SOURCE_LIST_PERIOD_ERROR')
      );
    }
  }

  async setRelevanceLabel(input: {
    workspaceId: WorkspaceId;
    sourceRecordId: SourceRecordId;
    label: SourceRelevanceLabel | null;
    labeledAt: Date;
  }) {
    try {
      const [updated] = await this.db
        .update(sourceRecordTable)
        .set({
          relevanceLabel: input.label,
          labeledAt: input.label === null ? null : input.labeledAt,
        })
        .where(
          and(
            eq(sourceRecordTable.id, input.sourceRecordId),
            eq(sourceRecordTable.workspaceId, input.workspaceId)
          )
        )
        .returning();
      return Result.Ok(
        updated
          ? ({
              type: 'source_labeled',
              sourceRecord: toSourceRecord(updated),
            } as const)
          : ({ type: 'source_record_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'SOURCE_LABEL_ERROR'));
    }
  }

  async createSearchResult(input: SearchResultWriteInput) {
    try {
      return Result.Ok(await this.insertSearchResult(this.db, input));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'SEARCH_RESULT_CREATE_ERROR')
      );
    }
  }

  async createCallbackArtifacts(input: {
    sourceRecords: SourceRecordWriteInput[];
    searchResults?: SearchResultWriteInput[];
  }) {
    try {
      const artifacts = await this.runWriteBatch(async (db) => {
        const sourceRecordRows =
          input.sourceRecords.length > 0
            ? await db
                .insert(sourceRecordTable)
                .values(input.sourceRecords.map(toSourceRecordInsert))
                .returning()
            : [];
        const searchResultInputs = input.searchResults ?? [];
        const searchResultRows =
          searchResultInputs.length > 0
            ? await db
                .insert(searchResultTable)
                .values(searchResultInputs.map(toSearchResultInsert))
                .returning()
            : [];

        if (sourceRecordRows.length !== input.sourceRecords.length) {
          throw intelligenceInvariantError(
            'SOURCE_CREATE_BATCH_MISMATCH',
            'source record batch insert returned the wrong row count'
          );
        }
        if (searchResultRows.length !== searchResultInputs.length) {
          throw intelligenceInvariantError(
            'SEARCH_RESULT_CREATE_BATCH_MISMATCH',
            'search result batch insert returned the wrong row count'
          );
        }

        return {
          sourceRecords: sourceRecordRows.map(toSourceRecord),
          searchResults: searchResultRows.map(toSearchResult),
        };
      });

      return Result.Ok(artifacts);
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'CALLBACK_ARTIFACTS_CREATE_ERROR')
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
          inputMetadata: input.inputMetadata ?? {},
          outputPayload: input.outputPayload ?? {},
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
