/**
 * Mints a git-storable eval case from the database, pinned to one report id.
 *
 * This is the only place an eval touches live data. Everything downstream reads
 * the exported files, so experiments stay reproducible as the database moves on.
 */
import { getIntelligenceRepositories } from '@/composition/intelligence';
import { toWeeklyReportId, type WorkspaceId } from '@/modules/kernel';

import {
  CASE_FORMAT_VERSION,
  type CaseManifest,
  type CaseReport,
  type CaseSource,
  type CaseSummary,
  type CaseWorkspace,
  readExistingPhoenixBindings,
  writeCase,
} from './case';

const toPlain = <T>(value: T): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

export async function exportCase(input: {
  workspaceId: WorkspaceId;
  reportId?: string;
  name?: string;
  /** Restrict exported summaries to these models; omitted exports the latest. */
  summaryModels?: string[];
  outDir: string;
  log: (message: string, data?: Record<string, unknown>) => void;
}): Promise<string> {
  const repositories = getIntelligenceRepositories();

  const workspaceResult = await repositories.workspaceRepository.getById(
    input.workspaceId
  );
  if (workspaceResult.isError()) throw workspaceResult.getError();
  const workspaceOutcome = workspaceResult.get();
  if (workspaceOutcome.type === 'workspace_not_found') {
    throw new Error(`Workspace ${input.workspaceId} not found`);
  }
  const workspace = workspaceOutcome.workspace;

  // A pinned report id is what keeps the reference output from drifting; the
  // latest published report is only a convenience default for the first export.
  let report: {
    id: string;
    reportData: unknown;
    periodStart: Date;
    periodEnd: Date;
    modelMetadata?: unknown;
  };
  if (input.reportId) {
    const found = await repositories.reportRepository.getById(
      toWeeklyReportId(input.reportId)
    );
    if (found.isError()) throw found.getError();
    const outcome = found.get();
    if (outcome.type === 'report_not_found') {
      throw new Error(`Report ${input.reportId} not found`);
    }
    report = outcome.report as typeof report;
  } else {
    const latest = await repositories.reportRepository.getLatestPublished(
      input.workspaceId
    );
    if (latest.isError()) throw latest.getError();
    const outcome = latest.get();
    if (outcome.type === 'report_none') {
      throw new Error('No published report to export');
    }
    report = outcome.report as typeof report;
    input.log('No --report given, pinning the latest published report', {
      reportId: report.id,
    });
  }

  const [sources, keywords, competitors, social, priorReports] =
    await Promise.all([
      repositories.sourceRepository.listForPeriod({
        workspaceId: input.workspaceId,
        periodStart: report.periodStart,
        periodEnd: report.periodEnd,
      }),
      repositories.workspaceRepository.listKeywords(input.workspaceId, {
        activeOnly: true,
      }),
      repositories.workspaceRepository.listCompetitors(input.workspaceId),
      repositories.workspaceRepository.listSocialAccounts(input.workspaceId),
      repositories.reportRepository.listByWorkspace(input.workspaceId, {
        limit: 4,
      }),
    ]);
  if (sources.isError()) throw sources.getError();
  if (keywords.isError()) throw keywords.getError();
  if (competitors.isError()) throw competitors.getError();
  if (social.isError()) throw social.getError();
  if (priorReports.isError()) throw priorReports.getError();

  // Summaries are pinned like everything else, so summary-quality experiments
  // are reproducible from git rather than from a database that keeps moving.
  const summaryModels = input.summaryModels ?? [];
  const sourceIds = sources.get().map((source) => source.id);
  const summaryResults = await Promise.all(
    summaryModels.length > 0
      ? summaryModels.map((modelName) =>
          repositories.sourceRepository.listLatestSummariesForSources({
            workspaceId: input.workspaceId,
            sourceRecordIds: sourceIds,
            modelName,
          })
        )
      : [
          repositories.sourceRepository.listLatestSummariesForSources({
            workspaceId: input.workspaceId,
            sourceRecordIds: sourceIds,
          }),
        ]
  );
  const caseSummaries: CaseSummary[] = [];
  for (const result of summaryResults) {
    if (result.isError()) throw result.getError();
    for (const summary of result.get()) {
      caseSummaries.push({
        id: summary.id,
        sourceRecordId: summary.sourceRecordId,
        summaryText: summary.summaryText,
        evidenceCandidateText: summary.evidenceCandidateText,
        modelName: summary.modelName,
        modelProvider: summary.modelProvider,
        promptVersion: summary.promptVersion,
        createdAt: summary.createdAt.toISOString(),
      });
    }
  }

  const caseWorkspace: CaseWorkspace = {
    workspace: toPlain(workspace),
    keywords: keywords.get().map(toPlain),
    competitors: competitors.get().map(toPlain),
    socialAccounts: social.get().map(toPlain),
  };

  const caseSources = sources.get().map(toPlain) as CaseSource[];

  // modelMetadata carries the full raw generation transcript (hundreds of KB of
  // stream events). Only the model identity is ever read back, and the rest
  // would bloat every diff of this case, so keep just those fields.
  const rawMetadata = (report.modelMetadata ?? null) as Record<
    string,
    unknown
  > | null;
  const modelMetadata = rawMetadata
    ? {
        modelName: rawMetadata.modelName,
        modelProvider: rawMetadata.modelProvider,
        promptVersion: rawMetadata.promptVersion,
      }
    : null;

  const caseReport: CaseReport = {
    id: report.id,
    reportData: (report.reportData ?? null) as Record<string, unknown> | null,
    periodStart: report.periodStart.toISOString(),
    periodEnd: report.periodEnd.toISOString(),
    modelMetadata,
  };

  const name =
    input.name ??
    `${workspace.companyName ?? 'workspace'}-${report.periodStart.toISOString().slice(0, 10)}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

  const manifest: CaseManifest = {
    formatVersion: CASE_FORMAT_VERSION,
    name,
    workspaceId: input.workspaceId,
    reportId: report.id,
    periodStart: caseReport.periodStart,
    periodEnd: caseReport.periodEnd,
    exportedAt: new Date().toISOString(),
    sourceCount: caseSources.length,
    summaryCount: caseSummaries.length,
    summaryModels: summaryModels.length > 0 ? summaryModels : undefined,
    // Carried over from a previous export so a refreshed case keeps the
    // datasets it has already been pushed to.
    phoenix: readExistingPhoenixBindings(input.outDir),
  };

  const dir = writeCase(input.outDir, {
    manifest,
    workspace: caseWorkspace,
    sources: caseSources,
    report: caseReport,
    priorReports: priorReports.get().map(toPlain),
    summaries: caseSummaries,
  });

  input.log('Exported eval case', {
    dir,
    name,
    reportId: report.id,
    sources: caseSources.length,
    summaries: caseSummaries.length,
    summaryModels,
  });
  return dir;
}
