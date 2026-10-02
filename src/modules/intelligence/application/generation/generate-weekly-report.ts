import { Result } from '@swan-io/boxed';

import type { Clock, Logger } from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type {
  SourceRecordId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';

import {
  buildRepairPrompt,
  buildReportPrompt,
  REPORT_PROMPT_VERSION,
} from './build-report-prompt';
import type { AlertPort, ReportGeneratorPort } from '../ports/report-generator';
import type { ReportRepository } from '../ports/report-repository';
import type { SourceRepository } from '../ports/source-repository';
import type { WorkspaceRepository } from '../ports/workspace-repository';
import { safeAppErrorDetails } from '../safe-diagnostics';
import { computeWeeklyPeriod, formatPeriodDate } from '../../domain/period';
import type { WeeklyReport, WeeklyReportSummary } from '../../domain/report';
import type { GeneratedReportDataValidation } from '../../domain/report-data';
import {
  parseGeneratedReportJson,
  validateReportData,
} from '../../domain/report-data';
import type { SourceSummary } from '../../domain/source';
import { collapseDuplicateSources } from '../../domain/source-dedup';

export type WeeklyReportGenerationDeps = {
  workspaceRepository: WorkspaceRepository;
  sourceRepository: SourceRepository;
  reportRepository: ReportRepository;
  reportGenerator: ReportGeneratorPort;
  alert: AlertPort;
  clock: Clock;
  logger: Logger;
};

export type GenerateWeeklyReportInput = {
  workspaceId: WorkspaceId;
  now?: Date;
  sourceRecordIds?: SourceRecordId[];
  includeSourceSummaries?: boolean;
};

export type GenerateWeeklyReportOutcome =
  | { type: 'report_published'; report: WeeklyReport }
  | { type: 'report_failed'; reason: string; failureCode: string }
  | { type: 'workspace_not_found' };

export async function generateWeeklyReport(
  deps: WeeklyReportGenerationDeps,
  input: GenerateWeeklyReportInput
): Promise<ApplicationResult<GenerateWeeklyReportOutcome>> {
  const now = input.now ?? deps.clock.now();

  const workspaceResult = await deps.workspaceRepository.getById(
    input.workspaceId
  );
  if (workspaceResult.isError())
    return Result.Error(workspaceResult.getError());
  const workspaceOutcome = workspaceResult.get();
  if (workspaceOutcome.type === 'workspace_not_found') {
    return Result.Ok({ type: 'workspace_not_found' });
  }
  const workspace = workspaceOutcome.workspace;

  const period = computeWeeklyPeriod(now, workspace.timezone);

  // Gather period evidence and configuration.
  const [keywords, competitors, social, sources, priorReports] =
    await Promise.all([
      deps.workspaceRepository.listKeywords(workspace.id, { activeOnly: true }),
      deps.workspaceRepository.listCompetitors(workspace.id),
      deps.workspaceRepository.listSocialAccounts(workspace.id),
      input.sourceRecordIds
        ? deps.sourceRepository.getManyByIds(
            workspace.id,
            input.sourceRecordIds
          )
        : deps.sourceRepository.listForPeriod({
            workspaceId: workspace.id,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
          }),
      deps.reportRepository.listByWorkspace(workspace.id, { limit: 4 }),
    ]);
  if (keywords.isError()) return Result.Error(keywords.getError());
  if (competitors.isError()) return Result.Error(competitors.getError());
  if (social.isError()) return Result.Error(social.getError());
  if (sources.isError()) return Result.Error(sources.getError());
  if (priorReports.isError()) return Result.Error(priorReports.getError());

  // One record per page first. Ingestion keeps every capture, so a page matched
  // by several keywords or re-fetched on later runs is in here many times over,
  // and the survivor inherits the strongest label across all of them.
  const { selected, collapsedCount, inheritedLabelCount } =
    collapseDuplicateSources(sources.get());
  if (collapsedCount > 0) {
    deps.logger.info({
      event: 'intelligence.report.duplicate_sources_collapsed',
      details: {
        workspaceId: workspace.id,
        collapsedCount,
        selectedCount: selected.length,
        inheritedLabelCount,
      },
    });
  }

  // Then drop junk, which now excludes the whole page rather than the single
  // row the analyst happened to have open when they labelled it.
  const usableSources = selected.filter(
    (source) => source.relevanceLabel !== 'junk'
  );
  const junkCount = selected.length - usableSources.length;
  if (junkCount > 0) {
    deps.logger.info({
      event: 'intelligence.report.junk_sources_excluded',
      details: { workspaceId: workspace.id, junkCount },
    });
  }

  let sourceSummaries: SourceSummary[] = [];
  if (input.includeSourceSummaries && usableSources.length > 0) {
    const sourceSummariesResult =
      await deps.sourceRepository.listLatestSummariesForSources({
        workspaceId: workspace.id,
        sourceRecordIds: usableSources.map((source) => source.id),
      });
    if (sourceSummariesResult.isError()) {
      return Result.Error(sourceSummariesResult.getError());
    }
    sourceSummaries = sourceSummariesResult.get();
  }

  const periodStartLabel = formatPeriodDate(
    period.periodStart,
    workspace.timezone
  );
  const periodEndLabel = formatPeriodDate(period.periodEnd, workspace.timezone);

  const prompt = buildReportPrompt({
    workspace,
    keywords: keywords.get(),
    competitors: competitors.get(),
    socialAccounts: social.get(),
    sources: usableSources,
    sourceSummaries,
    priorReports: priorReports.get(),
    periodStartLabel,
    periodEndLabel,
  });

  // Generate, then a single bounded repair pass if the JSON is invalid.
  const first = await deps.reportGenerator.generate({
    prompt,
    stage: 'initial',
  });
  if (first.isError()) {
    return recordFailure(deps, {
      workspace,
      period,
      reason: 'Report generation failed',
      failureCode: first.getError().code,
      diagnostics: safeAppErrorDetails(first.getError()),
    });
  }

  const generationMetadata: JsonObject = {
    initial: first.get().metadata ?? {},
  };
  let modelName = first.get().modelName;
  let modelProvider = first.get().modelProvider ?? 'unknown';
  let validation: GeneratedReportDataValidation = parseGeneratedReportJson(
    first.get().text
  );

  if (validation.type === 'generated_report_data_invalid') {
    const repair = await deps.reportGenerator.generate({
      prompt: buildRepairPrompt({
        originalPrompt: prompt,
        invalidOutput: first.get().text,
        issues: validation.issues,
      }),
      stage: 'repair',
    });
    if (repair.isError()) {
      return recordFailure(deps, {
        workspace,
        period,
        reason: 'Report repair failed',
        failureCode: repair.getError().code,
        diagnostics: safeAppErrorDetails(repair.getError()),
      });
    }
    modelName = repair.get().modelName;
    modelProvider = repair.get().modelProvider ?? modelProvider;
    generationMetadata.repair = repair.get().metadata ?? {};
    validation = parseGeneratedReportJson(repair.get().text);
  }

  if (validation.type === 'generated_report_data_invalid') {
    return recordFailure(deps, {
      workspace,
      period,
      reason: 'Report schema validation failed',
      failureCode: 'REPORT_SCHEMA_INVALID',
      diagnostics: { validationDiagnostics: validation.diagnostics },
    });
  }

  const generatedData = validation.data;
  const modelMetadata = {
    modelProvider,
    modelName,
    promptVersion: REPORT_PROMPT_VERSION,
    ...generationMetadata,
  };

  // Reserve a report row so report_data can reference the durable report id.
  let reportId: WeeklyReportId;
  const created = await deps.reportRepository.create({
    workspaceId: workspace.id,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    timezone: workspace.timezone,
    status: 'generated',
    generatedAt: now,
  });
  if (created.isError()) return Result.Error(created.getError());
  reportId = created.get().id;

  const reportDataValidation = validateReportData({
    ...generatedData,
    workspace_id: workspace.id,
    report_id: reportId,
    period_start: periodStartLabel,
    period_end: periodEndLabel,
    generated_at: now.toISOString(),
    timezone: workspace.timezone,
  });
  if (reportDataValidation.type === 'report_data_invalid') {
    return recordFailure(deps, {
      workspace,
      period,
      reservedReportId: reportId,
      reason: 'Report schema validation failed',
      failureCode: 'REPORT_SCHEMA_INVALID',
      diagnostics: { validationDiagnostics: reportDataValidation.diagnostics },
    });
  }
  const reportData = reportDataValidation.data;

  const frozen = await deps.reportRepository.replaceContent(reportId, {
    status: 'published',
    title: reportData.title,
    reportData,
    modelMetadata,
    generatedAt: now,
    publishedAt: now,
  });
  if (frozen.isError()) return Result.Error(frozen.getError());
  const frozenOutcome = frozen.get();
  if (frozenOutcome.type === 'report_not_found') {
    return Result.Ok({
      type: 'report_failed',
      reason: 'report row vanished before freezing',
      failureCode: 'REPORT_ROW_MISSING',
    });
  }
  if (frozenOutcome.type === 'report_published_protected') {
    return Result.Ok({
      type: 'report_failed',
      reason: 'report row was already published before freezing',
      failureCode: 'REPORT_PUBLISHED_PROTECTED',
    });
  }

  // Link cited / relevant-but-unused sources that exist in this period.
  const sourceById = new Map(
    usableSources.map((source) => [source.id as string, source.id])
  );
  const links = reportData.source_library
    .map((item) => {
      const sourceRecordId = sourceById.get(item.source_id);
      return sourceRecordId
        ? {
            sourceRecordId,
            relationType: item.relation_type,
            topicClusterId: item.topic_cluster_id ?? null,
          }
        : null;
    })
    .filter((link): link is NonNullable<typeof link> => link !== null);
  if (links.length > 0) {
    const linked = await deps.reportRepository.addSources({
      workspaceId: workspace.id,
      reportId,
      sources: links,
    });
    if (linked.isError()) return Result.Error(linked.getError());
  }

  deps.logger.info({
    event: 'intelligence.report.published',
    details: { workspaceId: workspace.id, reportId },
  });
  return Result.Ok({ type: 'report_published', report: frozenOutcome.report });
}

async function recordFailure(
  deps: WeeklyReportGenerationDeps,
  input: {
    workspace: { id: WorkspaceId; timezone: string };
    period: { periodStart: Date; periodEnd: Date };
    reservedReportId?: WeeklyReportId;
    reason: string;
    failureCode?: string;
    diagnostics?: Record<string, unknown>;
  }
): Promise<ApplicationResult<GenerateWeeklyReportOutcome>> {
  const now = deps.clock.now();
  deps.logger.error({
    event: 'intelligence.report.generation_failed',
    details: {
      workspaceId: input.workspace.id,
      failureCode: input.failureCode ?? 'REPORT_FAILED',
      ...input.diagnostics,
    },
  });

  if (input.reservedReportId) {
    const replaced = await deps.reportRepository.replaceContent(
      input.reservedReportId,
      { status: 'failed', failureReason: input.reason, generatedAt: now }
    );
    if (replaced.isError())
      return failureRecordError(deps, input, replaced.getError());
    const replaceOutcome = replaced.get();
    if (replaceOutcome.type !== 'report_found') {
      deps.logger.warn({
        event: 'intelligence.report.failure_record_skipped',
        details: {
          workspaceId: input.workspace.id,
          reportId: input.reservedReportId,
          outcome: replaceOutcome.type,
        },
      });
    }
  } else {
    const reusableFailedReport = await findReusableFailedReport(deps, input);
    if (reusableFailedReport.isError()) {
      return failureRecordError(deps, input, reusableFailedReport.getError());
    }

    const existing = reusableFailedReport.get();
    if (existing) {
      const replaced = await deps.reportRepository.replaceContent(existing.id, {
        status: 'failed',
        failureReason: input.reason,
        generatedAt: now,
      });
      if (replaced.isError())
        return failureRecordError(deps, input, replaced.getError());
      const replaceOutcome = replaced.get();
      if (replaceOutcome.type === 'report_found') {
        await sendFailureAlert(deps, input);
        return Result.Ok({
          type: 'report_failed',
          reason: input.reason,
          failureCode: input.failureCode ?? 'REPORT_FAILED',
        });
      }
    }

    const created = await deps.reportRepository.create({
      workspaceId: input.workspace.id,
      periodStart: input.period.periodStart,
      periodEnd: input.period.periodEnd,
      timezone: input.workspace.timezone,
      status: 'failed',
      failureReason: input.reason,
      generatedAt: now,
    });
    if (created.isError())
      return failureRecordError(deps, input, created.getError());
  }

  await sendFailureAlert(deps, input);

  return Result.Ok({
    type: 'report_failed',
    reason: input.reason,
    failureCode: input.failureCode ?? 'REPORT_FAILED',
  });
}

async function findReusableFailedReport(
  deps: WeeklyReportGenerationDeps,
  input: {
    workspace: { id: WorkspaceId };
    period: { periodStart: Date };
  }
): Promise<ApplicationResult<WeeklyReportSummary | null>> {
  const reports = await deps.reportRepository.listByWorkspace(
    input.workspace.id,
    {
      // Best-effort reuse keeps failure recording bounded; older failed rows may
      // fall outside this recent window.
      limit: 20,
    }
  );
  if (reports.isError()) return Result.Error(reports.getError());
  const reusable =
    reports
      .get()
      .find(
        (report) =>
          report.status === 'failed' &&
          report.periodStart.getTime() === input.period.periodStart.getTime()
      ) ?? null;
  return Result.Ok(reusable);
}

async function sendFailureAlert(
  deps: WeeklyReportGenerationDeps,
  input: {
    workspace: { id: WorkspaceId };
    reason: string;
  }
) {
  const alert = await deps.alert.sendAlert({
    title: 'Weekly report generation failed',
    message: `Workspace ${input.workspace.id}: ${input.reason}`,
  });
  if (alert.isError()) {
    const error = alert.getError();
    deps.logger.warn({
      event: 'intelligence.report.failure_alert_failed',
      error: 'Weekly report alert delivery failed',
      details: {
        errorCode: error.code,
        workspaceId: input.workspace.id,
      },
    });
  }
}

function failureRecordError(
  deps: WeeklyReportGenerationDeps,
  input: { workspace: { id: WorkspaceId }; failureCode?: string },
  error: AppError
): ApplicationResult<GenerateWeeklyReportOutcome> {
  deps.logger.error({
    event: 'intelligence.report.failure_record_failed',
    details: {
      workspaceId: input.workspace.id,
      failureCode: input.failureCode ?? 'REPORT_FAILED',
      errorCode: error.code,
    },
  });
  return Result.Error(error);
}
