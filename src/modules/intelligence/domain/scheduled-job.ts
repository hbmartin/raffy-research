import type { WorkspaceId } from '@/modules/kernel/domain/ids';

export type ScheduledJobStatus = 'started' | 'succeeded' | 'partial' | 'failed';
export type WorkspaceJobStatus = 'succeeded' | 'partial' | 'failed' | 'skipped';
export type ScheduledJobKind = 'daily_ingest' | 'weekly_reports';
export type JobHistoryStatus = 'recorded' | 'failed';

export type WeeklyReportsRunSummary = {
  runId: string;
  status: ScheduledJobStatus;
  historyStatus: JobHistoryStatus;
  total: number;
  generated: number;
  failed: number;
  skipped: number;
};

export type DailyIngestRunSummary = {
  runId: string;
  status: ScheduledJobStatus;
  historyStatus: JobHistoryStatus;
  workspaces: number;
  ingested: number;
  failed: number;
  partial: number;
  providersSucceeded: number;
  providersPartial: number;
  providersFailed: number;
  providersSkipped: number;
  requestsFailed: number;
};

export type JobCounts = {
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  skipped: number;
  items: number;
};

export type ScheduledJobRun = JobCounts & {
  id: string;
  kind: ScheduledJobKind;
  status: ScheduledJobStatus;
  startedAt: Date;
  finishedAt: Date | null;
  failureCode: string | null;
};

export type ScheduledJobWorkspaceRun = Omit<JobCounts, 'total'> & {
  jobRunId: string;
  workspaceId: WorkspaceId;
  status: WorkspaceJobStatus;
  startedAt: Date;
  finishedAt: Date;
  failureCode: string | null;
  reportId: string | null;
};

export type WorkspaceJobHistory = {
  run: ScheduledJobRun;
  workspace: ScheduledJobWorkspaceRun | null;
};
