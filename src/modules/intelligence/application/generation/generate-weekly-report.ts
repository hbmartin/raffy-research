import { Result } from '@swan-io/boxed';

import type { Clock, Logger } from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { WeeklyReportId, WorkspaceId } from '@/modules/kernel/domain/ids';

import {
  buildRepairPrompt,
  buildReportPrompt,
  REPORT_PROMPT_VERSION,
} from './build-report-prompt';
import type { AlertPort, ReportGeneratorPort } from '../ports/report-generator';
import type { ReportRepository } from '../ports/report-repository';
import type { SourceRepository } from '../ports/source-repository';
import type { WorkspaceRepository } from '../ports/workspace-repository';
import { computeWeeklyPeriod, formatPeriodDate } from '../../domain/period';
import type { WeeklyReport } from '../../domain/report';
import type { GeneratedReportDataValidation } from '../../domain/report-data';
import {
  parseGeneratedReportJson,
  validateReportData,
} from '../../domain/report-data';

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
};

export type GenerateWeeklyReportOutcome =
  | { type: 'report_published'; report: WeeklyReport }
  | { type: 'report_skipped_published'; report: WeeklyReport }
  | { type: 'report_failed'; reason: string }
  | { type: 'workspace_not_found' };

const MODEL_PROVIDER = 'openai';

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

  // Never overwrite a successfully published report for the same period.
  const existingResult = await deps.reportRepository.findByPeriod({
    workspaceId: workspace.id,
    periodStart: period.periodStart,
  });
  if (existingResult.isError()) return Result.Error(existingResult.getError());
  const existing =
    existingResult.get().type === 'report_found' ? existingResult.get() : null;
  if (
    existing &&
    existing.type === 'report_found' &&
    existing.report.status === 'published'
  ) {
    return Result.Ok({
      type: 'report_skipped_published',
      report: existing.report,
    });
  }
  const existingFailedId =
    existing && existing.type === 'report_found' ? existing.report.id : null;

  // Gather period evidence and configuration.
  const [keywords, competitors, social, sources, priorReports] =
    await Promise.all([
      deps.workspaceRepository.listKeywords(workspace.id, { activeOnly: true }),
      deps.workspaceRepository.listCompetitors(workspace.id),
      deps.workspaceRepository.listSocialAccounts(workspace.id),
      deps.sourceRepository.listForPeriod({
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
    sources: sources.get(),
    priorReports: priorReports.get(),
    periodStartLabel,
    periodEndLabel,
  });

  // Generate, then a single bounded repair pass if the JSON is invalid.
  const first = await deps.reportGenerator.generate({ prompt });
  if (first.isError()) {
    return recordFailure(deps, {
      workspace,
      period,
      existingFailedId,
      reason: first.getError().message,
    });
  }

  let modelName = first.get().modelName;
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
    });
    if (repair.isError()) {
      return recordFailure(deps, {
        workspace,
        period,
        existingFailedId,
        reason: repair.getError().message,
      });
    }
    modelName = repair.get().modelName;
    validation = parseGeneratedReportJson(repair.get().text);
  }

  if (validation.type === 'generated_report_data_invalid') {
    return recordFailure(deps, {
      workspace,
      period,
      existingFailedId,
      reason: `schema validation failed: ${validation.issues.join('; ')}`,
    });
  }

  const generatedData = validation.data;
  const modelMetadata = {
    modelProvider: MODEL_PROVIDER,
    modelName,
    promptVersion: REPORT_PROMPT_VERSION,
  };

  // Reserve a report row so report_data can reference the durable report id.
  let reportId: WeeklyReportId;
  if (existingFailedId) {
    reportId = existingFailedId;
  } else {
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
  }

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
      existingFailedId: reportId,
      reason: `schema validation failed: ${reportDataValidation.issues.join('; ')}`,
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
    });
  }

  // Link cited / relevant-but-unused sources that exist in this period.
  const sourceById = new Map(
    sources.get().map((source) => [source.id as string, source.id])
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
    existingFailedId: WeeklyReport['id'] | null;
    reason: string;
  }
): Promise<ApplicationResult<GenerateWeeklyReportOutcome>> {
  const now = deps.clock.now();
  deps.logger.error({
    event: 'intelligence.report.failed',
    details: { workspaceId: input.workspace.id, reason: input.reason },
  });

  if (input.existingFailedId) {
    const replaced = await deps.reportRepository.replaceContent(
      input.existingFailedId,
      { status: 'failed', failureReason: input.reason, generatedAt: now }
    );
    if (replaced.isError()) return Result.Error(replaced.getError());
  } else {
    const created = await deps.reportRepository.create({
      workspaceId: input.workspace.id,
      periodStart: input.period.periodStart,
      periodEnd: input.period.periodEnd,
      timezone: input.workspace.timezone,
      status: 'failed',
      failureReason: input.reason,
      generatedAt: now,
    });
    if (created.isError()) return Result.Error(created.getError());
  }

  const alert = await deps.alert.sendAlert({
    title: 'Weekly report generation failed',
    message: `Workspace ${input.workspace.id}: ${input.reason}`,
  });
  if (alert.isError()) {
    const error = alert.getError();
    deps.logger.warn({
      event: 'intelligence.report.failure_alert_failed',
      error: error.message,
      details: {
        errorCode: error.code,
        workspaceId: input.workspace.id,
      },
    });
  }

  return Result.Ok({ type: 'report_failed', reason: input.reason });
}
