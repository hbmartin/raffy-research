import { z } from 'zod';

import type { ProtectedContext } from '@/modules/auth/backend';
import {
  zSourceRecordId,
  zWeeklyReportId,
  zWorkspaceId,
} from '@/modules/kernel/domain/ids';
import {
  type OutcomeHandlerConfig,
  unwrapApplicationResult,
} from '@/modules/kernel/transport/tanstack/result-mapper';

import type {
  ReportGetOutcome,
  ReportLatestOutcome,
} from '../../application/ports/report-repository';
import type {
  SourceLabelOutcome,
  SourceRecordGetOutcome,
} from '../../application/ports/source-repository';
import type { ListProviderCallbacksOutcome } from '../../application/use-cases/ingestion-queries';
import type {
  LatestReportForUserOutcome,
  ListReportSourcesOutcome,
  ListReportsOutcome,
} from '../../application/use-cases/report-queries';
import type { ScoreReportOutcome } from '../../application/use-cases/score-report';
import type { ForbiddenOutcome } from '../../application/use-cases/types';
import type {
  GetWorkspaceConfigOutcome,
  WorkspaceConfig,
} from '../../application/use-cases/workspace-queries';
import type { ListWorkspacesOutcome } from '../../application/use-cases/workspace-queries';
import type { ProviderCallbackEvent } from '../../domain/ingestion';
import type {
  ReportSourceLink,
  WeeklyReport,
  WeeklyReportSummary,
} from '../../domain/report';
import type { ReportRubricScore } from '../../domain/rubric';
import {
  RUBRIC_NOTE_MAX_LENGTH,
  RUBRIC_SCORE_MAX,
  RUBRIC_SCORE_MIN,
} from '../../domain/rubric';
import type { SourceRecord } from '../../domain/source';
import { SOURCE_RELEVANCE_LABELS } from '../../domain/source';
import type { Workspace } from '../../domain/workspace';
import type { IntelligenceUseCases } from '../../factory';

export const zReportByIdInput = () => z.object({ reportId: zWeeklyReportId() });
export const zReportSourcesInput = () =>
  z.object({ reportId: zWeeklyReportId() });
export const zSourceByIdInput = () => z.object({ sourceId: zSourceRecordId() });
export const zWorkspaceConfigInput = () =>
  z.object({ workspaceId: zWorkspaceId() });
export const zListProviderCallbacksInput = () =>
  z.object({
    workspaceId: zWorkspaceId(),
    limit: z.number().int().min(1).max(200).optional(),
  });
const zRubricValue = () =>
  z.number().int().min(RUBRIC_SCORE_MIN).max(RUBRIC_SCORE_MAX);
export const zScoreReportInput = () =>
  z.object({
    workspaceId: zWorkspaceId(),
    reportId: zWeeklyReportId(),
    relevance: zRubricValue(),
    accuracy: zRubricValue(),
    novelty: zRubricValue(),
    note: z.string().trim().max(RUBRIC_NOTE_MAX_LENGTH).optional(),
  });
export const zReportScoreInput = () =>
  z.object({ workspaceId: zWorkspaceId(), reportId: zWeeklyReportId() });
export const zLabelSourceInput = () =>
  z.object({
    workspaceId: zWorkspaceId(),
    sourceRecordId: zSourceRecordId(),
    label: z.enum(SOURCE_RELEVANCE_LABELS).nullable(),
  });

type IntelligenceHandlerDeps = {
  getUseCases: (ctx: ProtectedContext) => IntelligenceUseCases;
};

export type LatestReportPayload = {
  report: WeeklyReport | null;
  workspaceId: string | null;
};

const latestForUserConfig = {
  forbidden: 'FORBIDDEN',
  report_ready: (outcome) => ({
    report: outcome.report,
    workspaceId: outcome.workspaceId,
  }),
  no_report: (outcome) => ({
    report: null,
    workspaceId: outcome.workspaceId,
  }),
} as const satisfies OutcomeHandlerConfig<
  LatestReportForUserOutcome | ForbiddenOutcome,
  LatestReportPayload
>;

const reportGetConfig = {
  forbidden: 'FORBIDDEN',
  report_found: (outcome) => outcome.report,
  report_not_found: 'NOT_FOUND',
} as const satisfies OutcomeHandlerConfig<
  ReportGetOutcome | ForbiddenOutcome,
  WeeklyReport
>;

const latestConfig = {
  forbidden: 'FORBIDDEN',
  report_found: (outcome) => outcome.report,
  report_none: 'NOT_FOUND',
} as const satisfies OutcomeHandlerConfig<
  ReportLatestOutcome | ForbiddenOutcome,
  WeeklyReport
>;

const reportSourcesConfig = {
  forbidden: 'FORBIDDEN',
  report_sources_listed: (outcome) => outcome.sources,
} as const satisfies OutcomeHandlerConfig<
  ListReportSourcesOutcome,
  ReportSourceLink[]
>;

const reportsListedConfig = {
  forbidden: 'FORBIDDEN',
  reports_listed: (outcome) => outcome.reports,
} as const satisfies OutcomeHandlerConfig<
  ListReportsOutcome,
  WeeklyReportSummary[]
>;

const sourceGetConfig = {
  forbidden: 'FORBIDDEN',
  source_record_found: (outcome) => outcome.sourceRecord,
  source_record_not_found: 'NOT_FOUND',
} as const satisfies OutcomeHandlerConfig<
  SourceRecordGetOutcome | ForbiddenOutcome,
  SourceRecord
>;

const callbacksListedConfig = {
  forbidden: 'FORBIDDEN',
  callbacks_listed: (outcome) => outcome.callbacks,
} as const satisfies OutcomeHandlerConfig<
  ListProviderCallbacksOutcome,
  ProviderCallbackEvent[]
>;

const workspacesListedConfig = {
  forbidden: 'FORBIDDEN',
  workspaces_listed: (outcome) => outcome.workspaces,
} as const satisfies OutcomeHandlerConfig<ListWorkspacesOutcome, Workspace[]>;

const workspaceConfigConfig = {
  forbidden: 'FORBIDDEN',
  workspace_not_found: 'NOT_FOUND',
  workspace_config: (outcome) => outcome.config,
} as const satisfies OutcomeHandlerConfig<
  GetWorkspaceConfigOutcome | ForbiddenOutcome,
  WorkspaceConfig
>;

const scoreReportConfig = {
  forbidden: 'FORBIDDEN',
  report_scored: (outcome) => outcome.score,
} as const satisfies OutcomeHandlerConfig<
  ScoreReportOutcome | ForbiddenOutcome,
  ReportRubricScore
>;

const reportScoreConfig = {
  forbidden: 'FORBIDDEN',
  rubric_score_found: (outcome) => outcome.score,
  rubric_score_none: () => null,
} as const satisfies OutcomeHandlerConfig<
  | { type: 'rubric_score_found'; score: ReportRubricScore }
  | { type: 'rubric_score_none' }
  | ForbiddenOutcome,
  ReportRubricScore | null
>;

const labelSourceConfig = {
  forbidden: 'FORBIDDEN',
  source_labeled: (outcome) => outcome.sourceRecord,
  source_record_not_found: 'NOT_FOUND',
} as const satisfies OutcomeHandlerConfig<
  SourceLabelOutcome | ForbiddenOutcome,
  SourceRecord
>;

export const createIntelligenceHandlers = ({
  getUseCases,
}: IntelligenceHandlerDeps) => ({
  getLatestReportForUser: (ctx: ProtectedContext) =>
    unwrapApplicationResult(
      getUseCases(ctx).getLatestReportForUser({
        currentUserId: ctx.scope.userId,
      }),
      latestForUserConfig
    ),
  getReportById: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zReportByIdInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).getReport({
        currentUserId: ctx.scope.userId,
        reportId: data.reportId,
      }),
      reportGetConfig
    ),
  getReportSources: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zReportSourcesInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).listReportSources({
        currentUserId: ctx.scope.userId,
        reportId: data.reportId,
      }),
      reportSourcesConfig
    ),
  getSourceById: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zSourceByIdInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).getSourceRecord({
        currentUserId: ctx.scope.userId,
        sourceRecordId: data.sourceId,
      }),
      sourceGetConfig
    ),
  listWorkspaces: (ctx: ProtectedContext) =>
    unwrapApplicationResult(
      getUseCases(ctx).listWorkspaces({ currentUserId: ctx.scope.userId }),
      workspacesListedConfig
    ),
  getWorkspaceConfig: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zWorkspaceConfigInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).getWorkspaceConfig({
        currentUserId: ctx.scope.userId,
        workspaceId: data.workspaceId,
      }),
      workspaceConfigConfig
    ),
  scoreReport: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zScoreReportInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).scoreReport({
        currentUserId: ctx.scope.userId,
        workspaceId: data.workspaceId,
        reportId: data.reportId,
        relevance: data.relevance,
        accuracy: data.accuracy,
        novelty: data.novelty,
        note: data.note ?? null,
      }),
      scoreReportConfig
    ),
  getReportScore: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zReportScoreInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).getReportRubricScore({
        currentUserId: ctx.scope.userId,
        workspaceId: data.workspaceId,
        reportId: data.reportId,
      }),
      reportScoreConfig
    ),
  labelSource: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zLabelSourceInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).labelSource({
        currentUserId: ctx.scope.userId,
        workspaceId: data.workspaceId,
        sourceRecordId: data.sourceRecordId,
        label: data.label,
      }),
      labelSourceConfig
    ),
  // latestConfig is exported for the workspace-scoped latest report variant.
  getLatestReport: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zWorkspaceConfigInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).getLatestReport({
        currentUserId: ctx.scope.userId,
        workspaceId: data.workspaceId,
      }),
      latestConfig
    ),
  listReports: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zWorkspaceConfigInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).listReports({
        currentUserId: ctx.scope.userId,
        workspaceId: data.workspaceId,
      }),
      reportsListedConfig
    ),
  listProviderCallbacks: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zListProviderCallbacksInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).listProviderCallbacks({
        currentUserId: ctx.scope.userId,
        workspaceId: data.workspaceId,
        limit: data.limit,
      }),
      callbacksListedConfig
    ),
});

export type IntelligenceHandlers = ReturnType<
  typeof createIntelligenceHandlers
>;
