import type { ApplicationResult } from '@/modules/kernel/application/result';
import type {
  SourceRecordId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';

export type ReportEvalInput = {
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId;
  reportData: JsonObject;
  sources: {
    id: SourceRecordId;
    title?: string | null;
    provider: string;
    contentText?: string | null;
  }[];
  evaluation: {
    claim_support: number;
    coverage: number;
    noise: number;
    violations: JsonObject[];
    missed_signals: JsonObject[];
    summary: string;
  };
  modelName: string;
  modelProvider: string;
};

export type ReportGenerationInput = {
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId;
  prompt: string;
  reportData: JsonObject;
  modelName: string;
  modelProvider: string;
};

export type SummaryEvalInput = {
  workspaceId: WorkspaceId;
  sourceRecordId: SourceRecordId;
  sourceContent: {
    title?: string | null;
    provider: string;
    contentText?: string | null;
  };
  summary: {
    summaryText: string;
    evidenceCandidateText: string | null;
  };
  modelName: string;
  modelProvider: string;
};

export interface EvalExperimentPort {
  recordReportGeneration(
    input: ReportGenerationInput
  ): Promise<ApplicationResult<{ datasetId: string; exampleId: string }>>;

  recordReportEvaluation(
    input: ReportEvalInput
  ): Promise<ApplicationResult<{ experimentId: string }>>;

  recordSummaryEvaluation(
    input: SummaryEvalInput
  ): Promise<ApplicationResult<{ experimentId: string }>>;
}
