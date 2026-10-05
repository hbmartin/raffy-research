import { Result } from '@swan-io/boxed';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gte,
  inArray,
  lte,
  or,
  sql,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

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

import { captureFingerprints, isUncertainCopy } from './capture-fingerprints';
import {
  effectiveEvidenceLabel,
  effectiveEvidenceProvenance,
} from './effective-evidence';
import { judgmentRecord } from './judgment-schema';
import {
  intelligenceInvariantError,
  mapIntelligenceDbError,
} from './map-db-error';
import {
  captureObservation,
  captureVersion,
  evidenceEquivalenceReview,
  evidenceGroup,
  evidenceJudgment,
  searchResult as searchResultTable,
  sourceRecord as sourceRecordTable,
  sourceSummary as sourceSummaryTable,
  workspace,
} from './schema';
import type { SourceRepository } from '../../application/ports/source-repository';
import type { JudgmentProvenance } from '../../domain/judgment';
import type {
  CaptureObservationInput,
  SearchResultRecord,
  SearchResultWriteInput,
  SourceRecord,
  SourceRecordWriteInput,
  SourceRelevanceLabel,
  SourceSummary,
} from '../../domain/source';
import { canonicalizeSourceUrl, normalizeHttpUrl } from '../../domain/url';

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
  labelProvenance: row.labelProvenance,
  labeledAt: row.labeledAt,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  canonicalUrl: row.canonicalUrl,
  contentFingerprint: row.contentFingerprint,
  normalizedFingerprint: row.normalizedFingerprint,
  evidenceIdentity: row.evidenceIdentity,
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

  private async captureRecord(
    db: DbLike,
    input: SourceRecordWriteInput,
    observation: CaptureObservationInput
  ): Promise<{
    type: 'capture_created' | 'capture_reused';
    sourceRecord: SourceRecord;
  }> {
    // A tiny team benefits from serializing derived group decisions per workspace.
    await db
      .select({ id: workspace.id })
      .from(workspace)
      .where(eq(workspace.id, input.workspaceId))
      .for('update');
    const hashes = captureFingerprints(input);
    let source: SourceRecord | undefined;
    if (hashes.versionKey) {
      const [reservation] = await db
        .insert(captureVersion)
        .values({
          workspaceId: input.workspaceId,
          providerName: input.providerName,
          versionKey: hashes.versionKey,
        })
        .onConflictDoNothing()
        .returning();
      if (!reservation) {
        const [existing] = await db
          .select({ source: sourceRecordTable })
          .from(captureVersion)
          .innerJoin(
            sourceRecordTable,
            eq(captureVersion.sourceRecordId, sourceRecordTable.id)
          )
          .where(
            and(
              eq(captureVersion.workspaceId, input.workspaceId),
              eq(captureVersion.providerName, input.providerName),
              eq(captureVersion.versionKey, hashes.versionKey)
            )
          );
        if (!existing)
          throw intelligenceInvariantError(
            'CAPTURE_RESERVATION_EMPTY',
            'Capture version reservation has no capture'
          );
        source = toSourceRecord(existing.source);
      }
    }
    const reused = Boolean(source);
    if (!source) {
      const [equivalent] = hashes.equivalenceKey
        ? await db
            .select({ identity: sourceRecordTable.evidenceIdentity })
            .from(sourceRecordTable)
            .where(
              and(
                eq(sourceRecordTable.workspaceId, input.workspaceId),
                eq(sourceRecordTable.equivalenceKey, hashes.equivalenceKey)
              )
            )
            .orderBy(
              asc(sourceRecordTable.capturedAt),
              asc(sourceRecordTable.id)
            )
            .limit(1)
        : [];
      const [created] = await db
        .insert(sourceRecordTable)
        .values({
          ...toSourceRecordInsert(input),
          canonicalUrl: hashes.canonicalUrl,
          contentFingerprint: hashes.contentFingerprint,
          contentLength: input.contentText?.length ?? 0,
          normalizedFingerprint: hashes.normalizedFingerprint,
          similarityBucket: hashes.similarityBucket,
          equivalenceKey: hashes.equivalenceKey,
          evidenceIdentity: equivalent?.identity ?? hashes.equivalenceKey,
        })
        .returning();
      if (!created)
        throw intelligenceInvariantError(
          'SOURCE_CREATE_EMPTY',
          'Capture insert returned no row'
        );
      source = toSourceRecord(created);
      if (!created.evidenceIdentity) {
        await db
          .update(sourceRecordTable)
          .set({
            evidenceIdentity: `capture:${created.id}`,
            equivalenceKey: `capture:${created.id}`,
          })
          .where(eq(sourceRecordTable.id, created.id));
        source.evidenceIdentity = `capture:${created.id}`;
      }
      if (hashes.versionKey)
        await db
          .update(captureVersion)
          .set({ sourceRecordId: created.id })
          .where(
            and(
              eq(captureVersion.workspaceId, input.workspaceId),
              eq(captureVersion.providerName, input.providerName),
              eq(captureVersion.versionKey, hashes.versionKey)
            )
          );
      const identity = source.evidenceIdentity!;
      await db
        .insert(evidenceGroup)
        .values({
          id: `${input.workspaceId}:${identity}`,
          workspaceId: input.workspaceId,
          identity,
          representativeId: source.id,
          publicationDate: input.publishedAt ?? source.capturedAt,
        })
        .onConflictDoUpdate({
          target: [evidenceGroup.workspaceId, evidenceGroup.identity],
          set: {
            publicationDate: sql`least(${evidenceGroup.publicationDate}, ${new Date(input.publishedAt ?? source.capturedAt).toISOString()}::timestamptz)`,
            representativeId: sql`case when length(coalesce((select "contentText" from "sourceRecord" where id = ${evidenceGroup.representativeId}), '')) < ${input.contentText?.length ?? 0} then ${source.id} else ${evidenceGroup.representativeId} end`,
          },
        });
      // Suggestions are bounded and have no effect on labels or ranking.
      const candidates =
        input.sourceType === 'seo_report'
          ? []
          : await db
              .select({
                id: sourceRecordTable.id,
                content: sourceRecordTable.contentText,
                identity: sourceRecordTable.evidenceIdentity,
                sourceType: sourceRecordTable.sourceType,
              })
              .from(sourceRecordTable)
              .where(
                and(
                  eq(sourceRecordTable.workspaceId, input.workspaceId),
                  or(
                    eq(
                      sourceRecordTable.canonicalUrl,
                      hashes.canonicalUrl ?? ''
                    ),
                    hashes.normalizedFingerprint &&
                      input.sourceType !== 'seo_report'
                      ? eq(
                          sourceRecordTable.normalizedFingerprint,
                          hashes.normalizedFingerprint
                        )
                      : undefined,
                    hashes.similarityBucket
                      ? eq(
                          sourceRecordTable.similarityBucket,
                          hashes.similarityBucket
                        )
                      : undefined
                  )
                )
              )
              .orderBy(desc(sourceRecordTable.capturedAt))
              .limit(50);
      for (const candidate of candidates) {
        if (
          candidate.id === created.id ||
          candidate.sourceType === 'seo_report' ||
          candidate.identity === source.evidenceIdentity ||
          !isUncertainCopy(candidate.content ?? '', input.contentText ?? '')
        )
          continue;
        const [leftSourceId, rightSourceId] = [created.id, candidate.id].sort();
        await db
          .insert(evidenceEquivalenceReview)
          .values({
            workspaceId: input.workspaceId,
            leftSourceId: leftSourceId!,
            rightSourceId: rightSourceId!,
          })
          .onConflictDoNothing();
      }
    }
    await db
      .insert(captureObservation)
      .values({
        workspaceId: input.workspaceId,
        providerName: input.providerName,
        sourceRecordId: source.id,
        ...observation,
        observedAt: observation.observedAt ?? input.capturedAt,
        rawPayload: input.rawPayload ?? {},
        metadata: { ...input.metadata, ...observation.metadata },
      })
      .onConflictDoNothing();
    return {
      type: reused ? 'capture_reused' : 'capture_created',
      sourceRecord: source,
    };
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
        .select({
          ...getTableColumns(sourceRecordTable),
          relevanceLabel: effectiveEvidenceLabel,
          labelProvenance: effectiveEvidenceProvenance,
        })
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
        .select({
          ...getTableColumns(sourceRecordTable),
          relevanceLabel: effectiveEvidenceLabel,
          labelProvenance: effectiveEvidenceProvenance,
        })
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
    modelName?: string;
  }) {
    try {
      if (input.sourceRecordIds.length === 0) return Result.Ok([]);
      const rows = await this.db
        .select()
        .from(sourceSummaryTable)
        .where(
          and(
            eq(sourceSummaryTable.workspaceId, input.workspaceId),
            inArray(sourceSummaryTable.sourceRecordId, input.sourceRecordIds),
            ...(input.modelName
              ? [eq(sourceSummaryTable.modelName, input.modelName)]
              : [])
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

  async captureSourceRecord(input: {
    record: SourceRecordWriteInput;
    observation: CaptureObservationInput;
  }): ReturnType<SourceRepository['captureSourceRecord']> {
    try {
      return Result.Ok(
        await this.runWriteBatch((db) =>
          this.captureRecord(db, input.record, input.observation)
        )
      );
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'SOURCE_CREATE_ERROR'));
    }
  }

  async createSourceRecord(
    input: SourceRecordWriteInput
  ): ReturnType<SourceRepository['createSourceRecord']> {
    const captured = await this.captureSourceRecord({
      record: input,
      observation: { kind: 'direct' },
    });
    return captured.map((outcome) => outcome.sourceRecord);
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
        .select({
          ...getTableColumns(sourceRecordTable),
          relevanceLabel: effectiveEvidenceLabel,
          labelProvenance: effectiveEvidenceProvenance,
        })
        .from(sourceRecordTable)
        .where(
          and(
            eq(sourceRecordTable.workspaceId, input.workspaceId),
            or(
              and(
                gte(sourceRecordTable.capturedAt, input.periodStart),
                lte(sourceRecordTable.capturedAt, input.periodEnd)
              ),
              sql`exists (select 1 from "captureObservation" observation where observation."sourceRecordId" = ${sourceRecordTable.id} and observation."observedAt" >= ${input.periodStart.toISOString()}::timestamptz and observation."observedAt" <= ${input.periodEnd.toISOString()}::timestamptz)`
            )
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
    provenance?: JudgmentProvenance;
  }) {
    try {
      return Result.Ok(
        await this.runWriteBatch(async (db) => {
          await db
            .select({ id: workspace.id })
            .from(workspace)
            .where(eq(workspace.id, input.workspaceId))
            .for('update');
          const [latest] = await db
            .select({ at: sourceRecordTable.labeledAt })
            .from(sourceRecordTable)
            .where(eq(sourceRecordTable.workspaceId, input.workspaceId))
            .orderBy(sql`${sourceRecordTable.labeledAt} desc nulls last`)
            .limit(1);
          const judgedAt = new Date(
            Math.max(
              input.labeledAt.getTime(),
              latest?.at ? latest.at.getTime() + 1 : 0
            )
          );
          const [updated] = await db
            .update(sourceRecordTable)
            .set({
              relevanceLabel: input.label,
              labeledAt: judgedAt,
              labelProvenance: input.provenance ?? { origin: 'unknown' },
            })
            .where(
              and(
                eq(sourceRecordTable.id, input.sourceRecordId),
                eq(sourceRecordTable.workspaceId, input.workspaceId)
              )
            )
            .returning();
          if (!updated) return { type: 'source_record_not_found' } as const;
          await db.insert(evidenceJudgment).values({
            workspaceId: input.workspaceId,
            sourceRecordId: input.sourceRecordId,
            label: input.label,
            provenance: input.provenance ?? { origin: 'unknown' },
            judgedAt,
          });
          const [judgment] = await db
            .insert(judgmentRecord)
            .values({
              id: randomUUID(),
              workspaceId: input.workspaceId,
              targetId: input.sourceRecordId,
              kind: 'label',
              provenance: input.provenance ?? { origin: 'unknown' },
              payload: { label: input.label },
              createdAt: judgedAt,
            })
            .returning({ id: judgmentRecord.id });
          return {
            type: 'source_labeled',
            judgmentId: judgment!.id,
            sourceRecord: toSourceRecord(updated),
          } as const;
        })
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
    observation?: CaptureObservationInput;
  }) {
    try {
      const artifacts = await this.runWriteBatch(async (db) => {
        const sources: SourceRecord[] = [];
        const searches: SearchResultRecord[] = [];
        let createdCaptures = 0,
          reusedCaptures = 0;
        for (const record of input.sourceRecords) {
          const captured = await this.captureRecord(
            db,
            record,
            input.observation ?? { kind: 'callback' }
          );
          sources.push(captured.sourceRecord);
          if (captured.type === 'capture_created') createdCaptures++;
          else reusedCaptures++;
        }
        for (const search of input.searchResults ?? []) {
          const canonical = canonicalizeSourceUrl(search.url);
          const candidates = canonical
            ? [
                ...new Map(
                  sources
                    .filter(
                      (s) =>
                        s.providerName === search.providerName &&
                        s.canonicalUrl === canonical
                    )
                    .map((source) => [source.id, source])
                ).values(),
              ]
            : [];
          const text =
            search.rawPayload &&
            typeof search.rawPayload === 'object' &&
            !Array.isArray(search.rawPayload) &&
            typeof search.rawPayload.text === 'string'
              ? search.rawPayload.text
              : undefined;
          const capture =
            candidates.find(
              (s) => text !== undefined && s.contentText === text
            ) ??
            candidates.find(
              (s) =>
                search.metadata?.keywordId &&
                s.metadata?.keywordId === search.metadata.keywordId
            ) ??
            (candidates.length === 1 ? candidates[0] : undefined);
          searches.push(
            await this.insertSearchResult(db, {
              ...search,
              sourceRecordId: capture?.id ?? search.sourceRecordId,
              metadata: {
                ...search.metadata,
                ...(input.observation?.runId
                  ? { runId: input.observation.runId }
                  : {}),
                ...(input.observation?.callbackId
                  ? { callbackId: input.observation.callbackId }
                  : {}),
                ...(input.observation?.jobId
                  ? { jobId: input.observation.jobId }
                  : {}),
              },
            })
          );
        }
        return {
          sourceRecords: sources,
          searchResults: searches,
          createdCaptures,
          reusedCaptures,
          observations: sources.length + searches.length,
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
