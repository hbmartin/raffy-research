import { Result } from '@swan-io/boxed';
import {
  and,
  asc,
  desc,
  eq,
  getTableColumns,
  gt,
  ilike,
  lt,
  or,
  sql,
} from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { escapeLikePattern } from '@/modules/kernel/infrastructure/db/like';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import {
  effectiveEvidenceLabel,
  effectiveEvidenceProvenance,
} from './effective-evidence';
import { judgmentRecord } from './judgment-schema';
import {
  captureVersion,
  searchResult,
  sourceRecord,
  weeklyReport,
  weeklyReportSource,
  workspace,
} from './schema';
import type { JudgmentProvenance } from '../../domain/judgment';

type Page = { limit: number; cursor?: string };
const encode = (item: { createdAt: Date; id: string }) =>
  Buffer.from(JSON.stringify([item.createdAt.toISOString(), item.id])).toString(
    'base64url'
  );
const decode = (page: Page) =>
  page.cursor
    ? z
        .tuple([z.iso.datetime(), z.string().min(1)])
        .parse(JSON.parse(Buffer.from(page.cursor, 'base64url').toString()))
    : undefined;
const boundary = async <T>(
  work: () => Promise<T>
): Promise<ApplicationResult<T>> => {
  try {
    return Result.Ok(await work());
  } catch (cause) {
    return Result.Error(
      cause instanceof AppError
        ? cause
        : new AppError({
            code: 'RESEARCH_STORAGE_FAILED',
            category: 'system',
            status: 500,
            message: 'Research storage failed',
            cause,
          })
    );
  }
};

export function createAgentResearch(db: DbLike) {
  return {
    workspaces: (page: Page) =>
      boundary(async () => {
        const cursor = decode(page);
        const rows = await db
          .select({
            id: workspace.id,
            name: workspace.name,
            timezone: workspace.timezone,
            createdAt: workspace.createdAt,
          })
          .from(workspace)
          .where(
            cursor
              ? or(
                  lt(workspace.createdAt, new Date(cursor[0])),
                  and(
                    eq(workspace.createdAt, new Date(cursor[0])),
                    lt(workspace.id, cursor[1])
                  )
                )
              : undefined
          )
          .orderBy(desc(workspace.createdAt), desc(workspace.id))
          .limit(page.limit + 1);
        return {
          type: 'workspaces_listed',
          workspaces: rows.slice(0, page.limit),
          nextCursor:
            rows.length > page.limit ? encode(rows[page.limit - 1]!) : null,
        };
      }),
    reports: (workspaceId: string, page: Page) =>
      boundary(async () => {
        const cursor = decode(page);
        const {
          reportData: _data,
          modelMetadata: _metadata,
          ...columns
        } = getTableColumns(weeklyReport);
        const rows = await db
          .select(columns)
          .from(weeklyReport)
          .where(
            and(
              eq(weeklyReport.workspaceId, workspaceId),
              cursor
                ? or(
                    lt(weeklyReport.createdAt, new Date(cursor[0])),
                    and(
                      eq(weeklyReport.createdAt, new Date(cursor[0])),
                      lt(weeklyReport.id, cursor[1])
                    )
                  )
                : undefined
            )
          )
          .orderBy(desc(weeklyReport.createdAt), desc(weeklyReport.id))
          .limit(page.limit + 1);
        return {
          type: 'reports_listed',
          reports: rows.slice(0, page.limit),
          nextCursor:
            rows.length > page.limit ? encode(rows[page.limit - 1]!) : null,
        };
      }),
    sources: (workspaceId: string, page: Page, query = '', reportId?: string) =>
      boundary(async () => {
        const cursor = decode(page);
        const rows = await db
          .select({
            id: sourceRecord.id,
            title: sourceRecord.title,
            externalUrl: sourceRecord.externalUrl,
            providerName: sourceRecord.providerName,
            publishedAt: sourceRecord.publishedAt,
            createdAt: sourceRecord.createdAt,
            relevanceLabel: effectiveEvidenceLabel,
            labelProvenance: effectiveEvidenceProvenance,
            contentFingerprint: sourceRecord.contentFingerprint,
            capturedAt: sourceRecord.capturedAt,
            evidenceIdentity: sourceRecord.evidenceIdentity,
          })
          .from(sourceRecord)
          .where(
            and(
              eq(sourceRecord.workspaceId, workspaceId),
              query
                ? or(
                    ilike(sourceRecord.title, `%${escapeLikePattern(query)}%`),
                    ilike(
                      sourceRecord.contentText,
                      `%${escapeLikePattern(query)}%`
                    ),
                    ilike(
                      sourceRecord.externalUrl,
                      `%${escapeLikePattern(query)}%`
                    )
                  )
                : undefined,
              reportId
                ? sql`exists (select 1 from ${weeklyReportSource} where ${weeklyReportSource.reportId} = ${reportId} and ${weeklyReportSource.sourceRecordId} = ${sourceRecord.id} and ${weeklyReportSource.workspaceId} = ${workspaceId})`
                : undefined,
              cursor
                ? or(
                    lt(sourceRecord.createdAt, new Date(cursor[0])),
                    and(
                      eq(sourceRecord.createdAt, new Date(cursor[0])),
                      lt(sourceRecord.id, cursor[1])
                    )
                  )
                : undefined
            )
          )
          .orderBy(desc(sourceRecord.createdAt), desc(sourceRecord.id))
          .limit(page.limit + 1);
        return {
          type: 'sources_listed',
          sources: rows.slice(0, page.limit),
          nextCursor:
            rows.length > page.limit ? encode(rows[page.limit - 1]!) : null,
        };
      }),
    searchResults: (workspaceId: string, page: Page, query = '') =>
      boundary(async () => {
        const cursor = decode(page);
        const { rawPayload: _rawPayload, ...columns } =
          getTableColumns(searchResult);
        const rows = await db
          .select(columns)
          .from(searchResult)
          .where(
            and(
              eq(searchResult.workspaceId, workspaceId),
              query
                ? or(
                    ...[
                      searchResult.title,
                      searchResult.snippet,
                      searchResult.url,
                      searchResult.query,
                    ].map((column) =>
                      ilike(column, `%${escapeLikePattern(query)}%`)
                    )
                  )
                : undefined,
              cursor
                ? or(
                    lt(searchResult.createdAt, new Date(cursor[0])),
                    and(
                      eq(searchResult.createdAt, new Date(cursor[0])),
                      lt(searchResult.id, cursor[1])
                    )
                  )
                : undefined
            )
          )
          .orderBy(desc(searchResult.createdAt), desc(searchResult.id))
          .limit(page.limit + 1);
        return {
          type: 'search_results_listed',
          results: rows.slice(0, page.limit),
          nextCursor:
            rows.length > page.limit ? encode(rows[page.limit - 1]!) : null,
        };
      }),
    captures: (workspaceId: string, sourceId: string, page: Page) =>
      boundary(async () => {
        const cursor = page.cursor
          ? z
              .string()
              .min(1)
              .parse(
                JSON.parse(Buffer.from(page.cursor, 'base64url').toString())
              )
          : undefined;
        const rows = await db
          .select()
          .from(captureVersion)
          .where(
            and(
              eq(captureVersion.workspaceId, workspaceId),
              eq(captureVersion.sourceRecordId, sourceId),
              cursor ? gt(captureVersion.id, cursor) : undefined
            )
          )
          .orderBy(asc(captureVersion.id))
          .limit(page.limit + 1);
        return {
          type: 'capture_versions_listed',
          sourceId,
          captures: rows.slice(0, page.limit),
          nextCursor:
            rows.length > page.limit
              ? Buffer.from(JSON.stringify(rows[page.limit - 1]!.id)).toString(
                  'base64url'
                )
              : null,
        };
      }),
    recordJudgment: (input: {
      workspaceId: string;
      targetId: string;
      kind: 'rubric' | 'evaluation' | 'label' | 'editorial';
      provenance: JudgmentProvenance;
      payload: Record<string, unknown>;
    }) =>
      boundary(async () => {
        const [record] = await db
          .insert(judgmentRecord)
          .values({ id: randomUUID(), ...input })
          .returning();
        return { type: 'judgment_recorded' as const, judgment: record! };
      }),
    judgment: (workspaceId: string, id: string) =>
      boundary(async () => {
        const [record] = await db
          .select()
          .from(judgmentRecord)
          .where(
            and(
              eq(judgmentRecord.workspaceId, workspaceId),
              eq(judgmentRecord.id, id)
            )
          )
          .limit(1);
        return record
          ? { type: 'judgment_found' as const, judgment: record }
          : { type: 'not_found' as const };
      }),
    judgments: (workspaceId: string, targetId: string, page: Page) =>
      boundary(async () => {
        const cursor = decode(page);
        const rows = await db
          .select({
            id: judgmentRecord.id,
            workspaceId: judgmentRecord.workspaceId,
            targetId: judgmentRecord.targetId,
            kind: judgmentRecord.kind,
            provenance: judgmentRecord.provenance,
            createdAt: judgmentRecord.createdAt,
          })
          .from(judgmentRecord)
          .where(
            and(
              eq(judgmentRecord.workspaceId, workspaceId),
              eq(judgmentRecord.targetId, targetId),
              cursor
                ? or(
                    lt(judgmentRecord.createdAt, new Date(cursor[0])),
                    and(
                      eq(judgmentRecord.createdAt, new Date(cursor[0])),
                      lt(judgmentRecord.id, cursor[1])
                    )
                  )
                : undefined
            )
          )
          .orderBy(desc(judgmentRecord.createdAt), desc(judgmentRecord.id))
          .limit(page.limit + 1);
        return {
          type: 'judgments_listed',
          judgments: rows.slice(0, page.limit),
          nextCursor:
            rows.length > page.limit ? encode(rows[page.limit - 1]!) : null,
        };
      }),
  };
}
