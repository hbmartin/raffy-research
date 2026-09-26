/**
 * Mints a git-storable eval case from the database, pinned to one report id.
 *
 * This is the only place an eval touches live data. Everything downstream reads
 * the exported files, so experiments stay reproducible as the database moves on.
 */
import { getIntelligenceRepositories } from '@/composition/intelligence';
import {
  type SourceRecordId,
  toWeeklyReportId,
  type WorkspaceId,
} from '@/modules/kernel';

import {
  CASE_FORMAT_VERSION,
  type CaseManifest,
  type CaseReport,
  type CaseSource,
  type CaseSummary,
  type CaseWorkspace,
  DEFAULT_SAMPLE_SIZE,
  pickSampleSourceIds,
  readExistingPhoenixBindings,
  writeCase,
} from './case';

const toPlain = <T>(value: T): Record<string, unknown> =>
  JSON.parse(JSON.stringify(value)) as Record<string, unknown>;

/** Repository results are all shaped alike; unwrapping inline buried the flow. */
type Unwrappable<T> = {
  isError: () => boolean;
  getError: () => unknown;
  get: () => T;
};

function unwrap<T>(result: Unwrappable<T>): T {
  if (result.isError()) throw result.getError();
  return result.get();
}

type ExportReport = {
  id: string;
  reportData: unknown;
  periodStart: Date;
  periodEnd: Date;
  modelMetadata?: unknown;
};

type Repositories = ReturnType<typeof getIntelligenceRepositories>;

/**
 * A pinned report id is what keeps the reference output from drifting; the
 * latest published report is only a convenience default for a first export.
 */
async function resolveExportReport(
  repositories: Repositories,
  input: {
    workspaceId: WorkspaceId;
    reportId?: string;
    log: (message: string, data?: Record<string, unknown>) => void;
  }
): Promise<ExportReport> {
  if (input.reportId) {
    const outcome = unwrap(
      await repositories.reportRepository.getById(
        toWeeklyReportId(input.reportId)
      )
    );
    if (outcome.type === 'report_not_found') {
      throw new Error(`Report ${input.reportId} not found`);
    }
    return outcome.report as ExportReport;
  }

  const outcome = unwrap(
    await repositories.reportRepository.getLatestPublished(input.workspaceId)
  );
  if (outcome.type === 'report_none') {
    throw new Error('No published report to export');
  }
  input.log('No --report given, pinning the latest published report', {
    reportId: outcome.report.id,
  });
  return outcome.report as ExportReport;
}

/**
 * Summaries are pinned like everything else, so summary-quality experiments
 * are reproducible from git rather than from a database that keeps moving.
 * Without a model filter this takes the latest summary per source, whichever
 * model wrote it.
 */
async function loadCaseSummaries(
  repositories: Repositories,
  input: {
    workspaceId: WorkspaceId;
    sourceRecordIds: SourceRecordId[];
    summaryModels: string[];
  }
): Promise<CaseSummary[]> {
  const queries =
    input.summaryModels.length > 0
      ? input.summaryModels.map((modelName) => ({ modelName }))
      : [{ modelName: undefined }];

  const results = await Promise.all(
    queries.map(({ modelName }) =>
      repositories.sourceRepository.listLatestSummariesForSources({
        workspaceId: input.workspaceId,
        sourceRecordIds: input.sourceRecordIds,
        ...(modelName ? { modelName } : {}),
      })
    )
  );

  return results.flatMap((result) =>
    unwrap(result).map((summary) => ({
      id: summary.id,
      sourceRecordId: summary.sourceRecordId,
      summaryText: summary.summaryText,
      evidenceCandidateText: summary.evidenceCandidateText,
      modelName: summary.modelName,
      modelProvider: summary.modelProvider,
      promptVersion: summary.promptVersion,
      createdAt: summary.createdAt.toISOString(),
    }))
  );
}

/**
 * modelMetadata carries the full raw generation transcript -- hundreds of KB
 * of stream events. Only the model identity is ever read back, and the rest
 * would bloat every diff of this case.
 */
function trimModelMetadata(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object') return null;
  const metadata = raw as Record<string, unknown>;
  return {
    modelName: metadata.modelName,
    modelProvider: metadata.modelProvider,
    promptVersion: metadata.promptVersion,
  };
}

function deriveCaseName(companyName: string | null, periodStart: Date): string {
  return `${companyName ?? 'workspace'}-${periodStart.toISOString().slice(0, 10)}`
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export async function exportCase(input: {
  workspaceId: WorkspaceId;
  reportId?: string;
  name?: string;
  /** Restrict exported summaries to these models; omitted exports the latest. */
  summaryModels?: string[];
  /** Size of the fixed sample split; ignored when sampleSourceIds is given. */
  sampleSize?: number;
  /** Pin exactly these sources as the sample instead of choosing them. */
  sampleSourceIds?: string[];
  outDir: string;
  log: (message: string, data?: Record<string, unknown>) => void;
}): Promise<string> {
  const repositories = getIntelligenceRepositories();

  const workspaceOutcome = unwrap(
    await repositories.workspaceRepository.getById(input.workspaceId)
  );
  if (workspaceOutcome.type === 'workspace_not_found') {
    throw new Error(`Workspace ${input.workspaceId} not found`);
  }
  const workspace = workspaceOutcome.workspace;

  const report = await resolveExportReport(repositories, input);

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

  const caseSources = unwrap(sources).map(toPlain) as CaseSource[];
  const summaryModels = input.summaryModels ?? [];
  const caseSummaries = await loadCaseSummaries(repositories, {
    workspaceId: input.workspaceId,
    sourceRecordIds: unwrap(sources).map((source) => source.id),
    summaryModels,
  });

  const caseWorkspace: CaseWorkspace = {
    workspace: toPlain(workspace),
    keywords: unwrap(keywords).map(toPlain),
    competitors: unwrap(competitors).map(toPlain),
    socialAccounts: unwrap(social).map(toPlain),
  };

  const caseReport: CaseReport = {
    id: report.id,
    reportData: (report.reportData ?? null) as Record<string, unknown> | null,
    periodStart: report.periodStart.toISOString(),
    periodEnd: report.periodEnd.toISOString(),
    modelMetadata: trimModelMetadata(report.modelMetadata),
  };

  const name =
    input.name ?? deriveCaseName(workspace.companyName, report.periodStart);

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
    sampleSourceIds: input.sampleSourceIds?.length
      ? input.sampleSourceIds
      : pickSampleSourceIds(
          caseSources
            .filter((source) => source.relevanceLabel !== 'junk')
            .map((source) => source.id),
          input.sampleSize ?? DEFAULT_SAMPLE_SIZE
        ),
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
    priorReports: unwrap(priorReports).map(toPlain),
    summaries: caseSummaries,
  });

  input.log('Exported eval case', {
    dir,
    name,
    reportId: report.id,
    sources: caseSources.length,
    summaries: caseSummaries.length,
    summaryModels,
    sampleSize: manifest.sampleSourceIds?.length ?? 0,
  });
  return dir;
}
