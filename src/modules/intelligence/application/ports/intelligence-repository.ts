import type {
  FeedbackEvent,
  NewFeedbackEvent,
  NewIngestionRun,
  NewProviderCallbackEvent,
  NewSearchResult,
  NewSourceRecord,
  NewWeeklyReport,
  NewWeeklyReportSource,
  NewWorkspace,
  NewWorkspaceCompetitor,
  NewWorkspaceKeyword,
  NewWorkspaceSocialAccount,
  ProviderCallbackEvent,
  ProviderConfig,
  SearchResult,
  SourceRecord,
  WeeklyReport,
  WeeklyReportSource,
  Workspace,
  WorkspaceCompetitor,
  WorkspaceKeyword,
  WorkspaceSocialAccount,
} from '@/modules/kernel/infrastructure/db/schema';

export type WorkspaceConfiguration = {
  workspace: Workspace;
  keywords: WorkspaceKeyword[];
  socialAccounts: WorkspaceSocialAccount[];
  competitors: WorkspaceCompetitor[];
  providers: ProviderConfig[];
};

export type ReportWithSources = {
  report: WeeklyReport;
  sources: Array<WeeklyReportSource & { sourceRecord: SourceRecord | null }>;
};

export type IntelligenceRepository = {
  createWorkspace(input: NewWorkspace): Promise<Workspace>;
  addWorkspaceKeyword(input: NewWorkspaceKeyword): Promise<WorkspaceKeyword>;
  addWorkspaceSocialAccount(
    input: NewWorkspaceSocialAccount
  ): Promise<WorkspaceSocialAccount>;
  addWorkspaceCompetitor(
    input: NewWorkspaceCompetitor
  ): Promise<WorkspaceCompetitor>;
  listWorkspaces(): Promise<Workspace[]>;
  getWorkspaceConfiguration(
    workspaceId: string
  ): Promise<WorkspaceConfiguration | null>;
  listEnabledProviderConfigs(workspaceId: string): Promise<ProviderConfig[]>;
  insertSourceRecord(input: NewSourceRecord): Promise<SourceRecord>;
  insertSearchResult(input: NewSearchResult): Promise<SearchResult>;
  insertProviderCallbackEvent(
    input: NewProviderCallbackEvent
  ): Promise<ProviderCallbackEvent>;
  updateProviderCallbackEvent(
    id: string,
    input: Partial<NewProviderCallbackEvent>
  ): Promise<ProviderCallbackEvent | null>;
  insertIngestionRun(input: NewIngestionRun): Promise<void>;
  findReportByPeriod(input: {
    workspaceId: string;
    periodStart: Date;
    periodEnd: Date;
  }): Promise<WeeklyReport | null>;
  insertWeeklyReport(input: NewWeeklyReport): Promise<WeeklyReport>;
  insertWeeklyReportSources(inputs: NewWeeklyReportSource[]): Promise<void>;
  getLatestPublishedReport(workspaceId: string): Promise<WeeklyReport | null>;
  getReportWithSources(reportId: string): Promise<ReportWithSources | null>;
  getSourceRecord(sourceRecordId: string): Promise<SourceRecord | null>;
  recordFeedback(input: NewFeedbackEvent): Promise<FeedbackEvent>;
  acceptSuggestedCompetitor(input: {
    workspaceId: string;
    competitorId: string;
  }): Promise<WorkspaceCompetitor | null>;
};
