import type {
  SourceRecord,
  Workspace,
} from '@/modules/kernel/infrastructure/db/schema';

import type { ReportPeriodWindow } from '../../domain/report-period';
import type { ReportData } from '../../domain/report-schema';

export type ReportGenerationInput = {
  period: ReportPeriodWindow;
  reportId: string;
  sources: SourceRecord[];
  workspace: Workspace;
};

export type ReportGenerationOutput = {
  modelMetadata: Record<string, unknown>;
  reportData: ReportData;
  sourceSummaries: Array<{
    evidenceCandidateText?: string | null;
    sourceRecordId: string;
    summaryText?: string | null;
  }>;
};

export type ReportGenerator = {
  generate(input: ReportGenerationInput): Promise<ReportGenerationOutput>;
};
