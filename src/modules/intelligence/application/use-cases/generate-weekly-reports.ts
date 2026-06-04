import type { IdGenerator, Logger } from '@/modules/kernel';

import type { IntelligenceRepository } from '../ports/intelligence-repository';
import type { ReportGenerator } from '../ports/report-generator';
import { calculateCompletedWeekWindow } from '../../domain/report-period';
import type { ReportData } from '../../domain/report-schema';
import type { IntelligenceRuntimeConfig } from '../../infrastructure/config/intelligence-env';

export type WeeklyReportGenerationSummary = {
  failed: number;
  generated: number;
  skippedFrozen: number;
  workspacesProcessed: number;
};

type GenerateWeeklyReportsDeps = {
  clock: { now(): Date };
  fetch: typeof fetch;
  idGenerator: IdGenerator;
  logger?: Pick<Logger, 'error' | 'info'>;
  repository: IntelligenceRepository;
  reportGenerator: ReportGenerator;
  runtimeConfig: IntelligenceRuntimeConfig;
};

export function createGenerateWeeklyReportsUseCase(
  deps: GenerateWeeklyReportsDeps
) {
  return async (): Promise<WeeklyReportGenerationSummary> => {
    const summary: WeeklyReportGenerationSummary = {
      failed: 0,
      generated: 0,
      skippedFrozen: 0,
      workspacesProcessed: 0,
    };
    const workspaces = await deps.repository.listWorkspaces();

    for (const workspace of workspaces) {
      summary.workspacesProcessed += 1;
      const period = calculateCompletedWeekWindow({
        now: deps.clock.now(),
        timezone: workspace.timezone,
      });
      const existing = await deps.repository.findReportByPeriod({
        workspaceId: workspace.id,
        ...period,
      });

      if (existing && existing.status !== 'failed') {
        summary.skippedFrozen += 1;
        continue;
      }

      const reportId = existing?.id ?? deps.idGenerator.createId();
      const sourceRecords = await deps.repository.listSourceRecordsForPeriod({
        workspaceId: workspace.id,
        ...period,
      });

      try {
        const generated = await deps.reportGenerator.generate({
          period,
          reportId,
          sources: sourceRecords,
          workspace,
        });
        const now = deps.clock.now();
        const title = generated.reportData.title;

        const report = existing
          ? await deps.repository.updateWeeklyReport(existing.id, {
              failureReason: null,
              generatedAt: now,
              modelMetadata: generated.modelMetadata,
              publishedAt: now,
              reportData: generated.reportData,
              status: 'published',
              title,
            })
          : await deps.repository.insertWeeklyReport({
              id: reportId,
              workspaceId: workspace.id,
              periodStart: period.periodStart,
              periodEnd: period.periodEnd,
              timezone: workspace.timezone,
              status: 'published',
              generatedAt: now,
              publishedAt: now,
              title,
              reportData: generated.reportData,
              modelMetadata: generated.modelMetadata,
            });

        if (!report) {
          throw new Error(`Unable to freeze report ${reportId}.`);
        }

        await deps.repository.insertWeeklyReportSources(
          sourceRecords.map((sourceRecord) => ({
            id: deps.idGenerator.createId(),
            workspaceId: workspace.id,
            reportId,
            sourceRecordId: sourceRecord.id,
            relationType: collectCitedSourceIds(generated.reportData).has(
              sourceRecord.id
            )
              ? 'cited'
              : 'relevant_unused',
          }))
        );

        for (const sourceSummary of generated.sourceSummaries) {
          await deps.repository.insertSourceSummary({
            id: deps.idGenerator.createId(),
            workspaceId: workspace.id,
            sourceRecordId: sourceSummary.sourceRecordId,
            summaryText: sourceSummary.summaryText,
            evidenceCandidateText: sourceSummary.evidenceCandidateText,
            modelName: String(generated.modelMetadata.model ?? ''),
            modelProvider: 'openai',
            promptVersion: String(generated.modelMetadata.promptVersion ?? ''),
            inputMetadata: {
              reportId,
              periodStart: period.periodStart.toISOString(),
              periodEnd: period.periodEnd.toISOString(),
            },
            outputPayload: {},
          });
        }

        summary.generated += 1;
      } catch (error) {
        summary.failed += 1;
        const message = error instanceof Error ? error.message : 'unknown';
        deps.logger?.error({
          event: 'intelligence.weekly_report_generation_failed',
          exception: error,
          details: {
            reportId,
            workspaceId: workspace.id,
          },
        });

        if (existing) {
          await deps.repository.updateWeeklyReport(existing.id, {
            failureReason: message,
            status: 'failed',
          });
        } else {
          await deps.repository.insertWeeklyReport({
            id: reportId,
            workspaceId: workspace.id,
            periodStart: period.periodStart,
            periodEnd: period.periodEnd,
            timezone: workspace.timezone,
            status: 'failed',
            failureReason: message,
          });
        }

        await sendSlackFailureAlert({
          fetch: deps.fetch,
          message,
          reportId,
          slackAlertWebhookUrl: deps.runtimeConfig.slackAlertWebhookUrl,
          workspaceName: workspace.name,
        });
      }
    }

    deps.logger?.info({
      event: 'intelligence.weekly_reports_completed',
      details: summary,
    });
    return summary;
  };
}

function collectCitedSourceIds(reportData: ReportData) {
  const sourceIds = new Set<string>();

  for (const section of [
    reportData.what_looks_most_interesting,
    reportData.contradictions,
    reportData.topic_clusters,
    reportData.competitor_watch,
    reportData.suggested_competitors,
    reportData.market_questions,
    reportData.possible_leads,
    reportData.social_product_feedback,
    reportData.source_library,
  ]) {
    for (const item of section) {
      for (const evidence of [
        ...item.evidence,
        ...item.representative_evidence,
        ...item.all_evidence,
      ]) {
        for (const sourceId of evidence.source_ids) sourceIds.add(sourceId);
      }
    }
  }

  return sourceIds;
}

async function sendSlackFailureAlert(input: {
  fetch: typeof fetch;
  message: string;
  reportId: string;
  slackAlertWebhookUrl?: string;
  workspaceName: string;
}) {
  if (!input.slackAlertWebhookUrl) return;

  await input.fetch(input.slackAlertWebhookUrl, {
    body: JSON.stringify({
      text: `Weekly intelligence report failed for ${input.workspaceName}: ${input.message}`,
      reportId: input.reportId,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  });
}
