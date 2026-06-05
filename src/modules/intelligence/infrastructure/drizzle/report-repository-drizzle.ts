import { Result } from '@swan-io/boxed';
import { and, desc, eq } from 'drizzle-orm';

import type { WeeklyReportId, WorkspaceId } from '@/modules/kernel/domain/ids';
import {
  toReportSourceId,
  toSourceRecordId,
  toWeeklyReportId,
  toWorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';
import { observeRepository } from '@/modules/kernel/infrastructure/db/observability';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import {
  intelligenceInvariantError,
  mapIntelligenceDbError,
} from './map-db-error';
import {
  weeklyReport as weeklyReportTable,
  weeklyReportSource as weeklyReportSourceTable,
} from './schema';
import type {
  ReportRepository,
  ReportSourceLinkInput,
} from '../../application/ports/report-repository';
import type {
  ReportSourceLink,
  ReportStatus,
  WeeklyReport,
  WeeklyReportSummary,
} from '../../domain/report';
import type { ReportData } from '../../domain/report-data';

type ReportRow = typeof weeklyReportTable.$inferSelect;
type ReportSourceRow = typeof weeklyReportSourceTable.$inferSelect;

const toReport = (row: ReportRow): WeeklyReport => ({
  id: toWeeklyReportId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  timezone: row.timezone,
  status: row.status,
  generatedAt: row.generatedAt,
  publishedAt: row.publishedAt,
  title: row.title,
  reportData: row.reportData ?? null,
  modelMetadata: row.modelMetadata ?? null,
  failureReason: row.failureReason,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

const toReportSummary = (row: ReportRow): WeeklyReportSummary => {
  const {
    reportData: _reportData,
    modelMetadata: _modelMetadata,
    ...rest
  } = toReport(row);
  return rest;
};

const toReportSourceLink = (row: ReportSourceRow): ReportSourceLink => ({
  id: toReportSourceId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  reportId: toWeeklyReportId(row.reportId),
  sourceRecordId: toSourceRecordId(row.sourceRecordId),
  relationType: row.relationType,
  topicClusterId: row.topicClusterId,
  sectionKey: row.sectionKey,
  createdAt: row.createdAt,
});

export class ReportRepositoryDrizzle implements ReportRepository {
  constructor(private readonly db: DbLike) {}

  async getById(id: WeeklyReportId) {
    try {
      const [row] = await this.db
        .select()
        .from(weeklyReportTable)
        .where(eq(weeklyReportTable.id, id))
        .limit(1);
      return Result.Ok(
        row
          ? ({ type: 'report_found', report: toReport(row) } as const)
          : ({ type: 'report_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'REPORT_GET_ERROR'));
    }
  }

  async getLatestPublished(workspaceId: WorkspaceId) {
    try {
      const [row] = await this.db
        .select()
        .from(weeklyReportTable)
        .where(
          and(
            eq(weeklyReportTable.workspaceId, workspaceId),
            eq(weeklyReportTable.status, 'published')
          )
        )
        .orderBy(desc(weeklyReportTable.periodStart))
        .limit(1);
      return Result.Ok(
        row
          ? ({ type: 'report_found', report: toReport(row) } as const)
          : ({ type: 'report_none' } as const)
      );
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'REPORT_LATEST_ERROR'));
    }
  }

  async listByWorkspace(
    workspaceId: WorkspaceId,
    options?: { limit?: number }
  ) {
    try {
      const rows = await this.db
        .select()
        .from(weeklyReportTable)
        .where(eq(weeklyReportTable.workspaceId, workspaceId))
        .orderBy(desc(weeklyReportTable.periodStart))
        .limit(options?.limit ?? 52);
      return Result.Ok(rows.map(toReportSummary));
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'REPORT_LIST_ERROR'));
    }
  }

  async findByPeriod(input: { workspaceId: WorkspaceId; periodStart: Date }) {
    try {
      const [row] = await this.db
        .select()
        .from(weeklyReportTable)
        .where(
          and(
            eq(weeklyReportTable.workspaceId, input.workspaceId),
            eq(weeklyReportTable.periodStart, input.periodStart)
          )
        )
        .limit(1);
      return Result.Ok(
        row
          ? ({ type: 'report_found', report: toReport(row) } as const)
          : ({ type: 'report_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'REPORT_FIND_PERIOD_ERROR')
      );
    }
  }

  async create(input: {
    workspaceId: WorkspaceId;
    periodStart: Date;
    periodEnd: Date;
    timezone: string;
    status: ReportStatus;
    title?: string | null;
    reportData?: ReportData | null;
    modelMetadata?: JsonObject | null;
    failureReason?: string | null;
    generatedAt?: Date | null;
    publishedAt?: Date | null;
  }) {
    try {
      const [created] = await this.db
        .insert(weeklyReportTable)
        .values({
          workspaceId: input.workspaceId,
          periodStart: input.periodStart,
          periodEnd: input.periodEnd,
          timezone: input.timezone,
          status: input.status,
          title: input.title ?? null,
          reportData: (input.reportData ?? {}) as any,
          modelMetadata: input.modelMetadata ?? {},
          failureReason: input.failureReason ?? null,
          generatedAt: input.generatedAt ?? null,
          publishedAt: input.publishedAt ?? null,
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'REPORT_CREATE_EMPTY',
            'report insert returned no row'
          )
        );
      }
      return Result.Ok(toReport(created));
    } catch (error) {
      return Result.Error(mapIntelligenceDbError(error, 'REPORT_CREATE_ERROR'));
    }
  }

  async replaceContent(
    id: WeeklyReportId,
    input: {
      status: ReportStatus;
      title?: string | null;
      reportData?: ReportData | null;
      modelMetadata?: JsonObject | null;
      failureReason?: string | null;
      generatedAt?: Date | null;
      publishedAt?: Date | null;
    }
  ) {
    try {
      const [updated] = await this.db
        .update(weeklyReportTable)
        .set({
          status: input.status,
          title: input.title ?? null,
          reportData: (input.reportData ?? {}) as any,
          modelMetadata: input.modelMetadata ?? {},
          failureReason: input.failureReason ?? null,
          generatedAt: input.generatedAt ?? null,
          publishedAt: input.publishedAt ?? null,
        })
        .where(eq(weeklyReportTable.id, id))
        .returning();
      return Result.Ok(
        updated
          ? ({ type: 'report_found', report: toReport(updated) } as const)
          : ({ type: 'report_not_found' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'REPORT_REPLACE_ERROR')
      );
    }
  }

  async addSources(input: {
    workspaceId: WorkspaceId;
    reportId: WeeklyReportId;
    sources: ReportSourceLinkInput[];
  }) {
    try {
      if (input.sources.length === 0) {
        return Result.Ok({ type: 'report_sources_linked', count: 0 } as const);
      }
      const inserted = await this.db
        .insert(weeklyReportSourceTable)
        .values(
          input.sources.map((source) => ({
            workspaceId: input.workspaceId,
            reportId: input.reportId,
            sourceRecordId: source.sourceRecordId,
            relationType: source.relationType,
            topicClusterId: source.topicClusterId ?? null,
            sectionKey: source.sectionKey ?? null,
          }))
        )
        .returning({ id: weeklyReportSourceTable.id });
      return Result.Ok({
        type: 'report_sources_linked',
        count: inserted.length,
      } as const);
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'REPORT_ADD_SOURCES_ERROR')
      );
    }
  }

  async listSources(reportId: WeeklyReportId) {
    try {
      const rows = await this.db
        .select()
        .from(weeklyReportSourceTable)
        .where(eq(weeklyReportSourceTable.reportId, reportId));
      return Result.Ok(rows.map(toReportSourceLink));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'REPORT_LIST_SOURCES_ERROR')
      );
    }
  }
}

export function createReportRepository(dependencies: {
  db: DbLike;
}): ReportRepository {
  return observeRepository(
    new ReportRepositoryDrizzle(dependencies.db),
    'intelligence.report'
  );
}
