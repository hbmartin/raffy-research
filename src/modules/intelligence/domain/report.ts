import type {
  ReportSourceId,
  SourceRecordId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';

import type { ReportData } from './report-data';

export type ReportStatus = 'generated' | 'published' | 'failed';

export type ReportSourceRelation = 'cited' | 'relevant_unused';

export type WeeklyReport = {
  id: WeeklyReportId;
  workspaceId: WorkspaceId;
  periodStart: Date;
  periodEnd: Date;
  timezone: string;
  status: ReportStatus;
  generatedAt: Date | null;
  publishedAt: Date | null;
  title: string | null;
  reportData: ReportData | null;
  modelMetadata: JsonObject | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type WeeklyReportSummary = Omit<
  WeeklyReport,
  'reportData' | 'modelMetadata'
>;

export type ReportSourceLink = {
  id: ReportSourceId;
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId;
  sourceRecordId: SourceRecordId;
  relationType: ReportSourceRelation;
  topicClusterId: string | null;
  sectionKey: string | null;
  createdAt: Date;
};

export function isReportPublished(
  report: Pick<WeeklyReport, 'status'>
): boolean {
  return report.status === 'published';
}
