import { z } from 'zod';

import type { ProtectedContext } from '@/modules/auth/backend';
import {
  zSourceRecordId,
  zWeeklyReportId,
  zWorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonValue } from '@/modules/kernel/domain/json';
import {
  type OutcomeHandlerConfig,
  unwrapApplicationResult,
} from '@/modules/kernel/transport/tanstack/result-mapper';

import type {
  ReportGetOutcome,
  ReportLatestOutcome,
} from '../../application/ports/report-repository';
import type { SourceRecordGetOutcome } from '../../application/ports/source-repository';
import type { ListProviderCallbacksOutcome } from '../../application/use-cases/ingestion-queries';
import type { RecordFeedbackOutcome } from '../../application/use-cases/record-feedback';
import type {
  LatestReportForUserOutcome,
  ListReportSourcesOutcome,
  ListReportsOutcome,
} from '../../application/use-cases/report-queries';
import type { ForbiddenOutcome } from '../../application/use-cases/types';
import type {
  GetWorkspaceConfigOutcome,
  WorkspaceConfig,
} from '../../application/use-cases/workspace-queries';
import type { ListWorkspacesOutcome } from '../../application/use-cases/workspace-queries';
import { FEEDBACK_EVENT_TYPES } from '../../domain/feedback';
import type { ProviderCallbackEvent } from '../../domain/ingestion';
import type {
  ReportSourceLink,
  WeeklyReport,
  WeeklyReportSummary,
} from '../../domain/report';
import type { SourceRecord } from '../../domain/source';
import type { Workspace } from '../../domain/workspace';
import type { IntelligenceUseCases } from '../../factory';

const zJsonValue: z.ZodType<JsonValue> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(zJsonValue),
    z.record(z.string(), zJsonValue),
  ])
);

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
export const zRecordFeedbackInput = () =>
  z.object({
    workspaceId: zWorkspaceId(),
    reportId: zWeeklyReportId().optional(),
    eventType: z.enum(FEEDBACK_EVENT_TYPES),
    targetType: z.string().optional(),
    targetId: z.string().optional(),
    sourceRecordId: zSourceRecordId().optional(),
    payload: z.record(z.string(), zJsonValue).optional(),
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

export type RecordFeedbackPayload = {
  recorded: boolean;
  competitorAccepted: boolean;
};

const recordFeedbackConfig = {
  forbidden: 'FORBIDDEN',
  feedback_recorded: (outcome) => ({
    recorded: true,
    competitorAccepted: outcome.competitorAccepted,
  }),
  competitor_not_found: () => ({ recorded: true, competitorAccepted: false }),
} as const satisfies OutcomeHandlerConfig<
  RecordFeedbackOutcome | ForbiddenOutcome,
  RecordFeedbackPayload
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
  recordFeedback: (
    ctx: ProtectedContext,
    data: z.infer<ReturnType<typeof zRecordFeedbackInput>>
  ) =>
    unwrapApplicationResult(
      getUseCases(ctx).recordFeedback({
        currentUserId: ctx.scope.userId,
        workspaceId: data.workspaceId,
        reportId: data.reportId,
        eventType: data.eventType,
        targetType: data.targetType,
        targetId: data.targetId,
        sourceRecordId: data.sourceRecordId,
        payload: data.payload ?? null,
      }),
      recordFeedbackConfig
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
