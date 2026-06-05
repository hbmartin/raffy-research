import type { ApplicationResult } from '@/modules/kernel/application/result';
import type {
  SourceRecordId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';

import type {
  ReportSourceLink,
  ReportSourceRelation,
  ReportStatus,
  WeeklyReport,
  WeeklyReportSummary,
} from '../../domain/report';
import type { ReportData } from '../../domain/report-data';

export type ReportGetOutcome =
  | { type: 'report_found'; report: WeeklyReport }
  | { type: 'report_not_found' };

export type ReportLatestOutcome =
  | { type: 'report_found'; report: WeeklyReport }
  | { type: 'report_none' };

export type ReportSourceLinkInput = {
  sourceRecordId: SourceRecordId;
  relationType: ReportSourceRelation;
  topicClusterId?: string | null;
  sectionKey?: string | null;
};

export interface ReportRepository {
  getById(id: WeeklyReportId): Promise<ApplicationResult<ReportGetOutcome>>;
  getLatestPublished(
    workspaceId: WorkspaceId
  ): Promise<ApplicationResult<ReportLatestOutcome>>;
  listByWorkspace(
    workspaceId: WorkspaceId,
    options?: { limit?: number }
  ): Promise<ApplicationResult<WeeklyReportSummary[]>>;
  findByPeriod(input: {
    workspaceId: WorkspaceId;
    periodStart: Date;
  }): Promise<ApplicationResult<ReportGetOutcome>>;

  create(input: {
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
  }): Promise<ApplicationResult<WeeklyReport>>;

  /** Replace a non-published report's content (used only when regenerating a failed report). */
  replaceContent(
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
  ): Promise<ApplicationResult<ReportGetOutcome>>;

  addSources(input: {
    workspaceId: WorkspaceId;
    reportId: WeeklyReportId;
    sources: ReportSourceLinkInput[];
  }): Promise<
    ApplicationResult<{ type: 'report_sources_linked'; count: number }>
  >;
  listSources(
    reportId: WeeklyReportId
  ): Promise<ApplicationResult<ReportSourceLink[]>>;
}
