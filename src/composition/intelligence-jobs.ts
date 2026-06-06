import {
  generateWeeklyReport,
  handleProviderCallback,
  type IngestionDeps,
  runWorkspaceIngest,
  type WeeklyReportGenerationDeps,
} from '@/modules/intelligence';
import {
  createIntelligenceJobRequestHandlers,
  createOpenAiReportGenerator,
  createProviderRegistry,
  createSlackAlert,
  getCronSecret,
  getProviderCredential,
  getProviderWebhookSecret,
} from '@/modules/intelligence/backend';
import { toWorkspaceId } from '@/modules/kernel';

import { getIntelligenceRepositories } from './intelligence';
import { getKernel } from './kernel';

const providerRegistry = createProviderRegistry();

function buildIngestionDeps(): IngestionDeps {
  const kernel = getKernel();
  const repositories = getIntelligenceRepositories();
  return {
    workspaceRepository: repositories.workspaceRepository,
    sourceRepository: repositories.sourceRepository,
    ingestionRepository: repositories.ingestionRepository,
    registry: providerRegistry,
    credentialResolver: { resolve: getProviderCredential },
    clock: kernel.clock,
    logger: kernel.logger,
  };
}

/**
 * Vercel Workflow jobs.
 *
 * The `'use workflow'` / `'use step'` directives make these durable, resumable
 * workflows when deployed on Vercel (the platform's workflow plugin transforms
 * them at build time). Locally and in tests the directives are no-op string
 * prologues, so the jobs run inline as ordinary async functions.
 */

function buildGenerationDeps(): WeeklyReportGenerationDeps {
  const kernel = getKernel();
  const repositories = getIntelligenceRepositories();
  return {
    workspaceRepository: repositories.workspaceRepository,
    sourceRepository: repositories.sourceRepository,
    reportRepository: repositories.reportRepository,
    reportGenerator: createOpenAiReportGenerator(),
    alert: createSlackAlert(),
    clock: kernel.clock,
    logger: kernel.logger,
  };
}

type WorkspaceReportStepResult = {
  outcome: string;
  reason?: string;
};

async function generateOneWorkspaceReport(
  workspaceId: string,
  nowMs: number | null
): Promise<WorkspaceReportStepResult> {
  'use step';
  const deps = buildGenerationDeps();
  const result = await generateWeeklyReport(deps, {
    workspaceId: toWorkspaceId(workspaceId),
    now: nowMs === null ? undefined : new Date(nowMs),
  });
  if (result.isError()) {
    return { outcome: 'error', reason: result.getError().message };
  }
  const value = result.get();
  return {
    outcome: value.type,
    reason: value.type === 'report_failed' ? value.reason : undefined,
  };
}

export type WeeklyReportsRunSummary = {
  total: number;
  generated: number;
  failed: number;
  skipped: number;
};

/** Generate the weekly report for every workspace (Monday cron entrypoint). */
export async function runWeeklyReports(input?: {
  nowMs?: number;
}): Promise<WeeklyReportsRunSummary> {
  'use workflow';
  const repositories = getIntelligenceRepositories();
  const workspaces = await repositories.workspaceRepository.list();
  if (workspaces.isError()) {
    const error = workspaces.getError();
    getKernel().logger.error({
      event: 'intelligence.weekly_reports.workspace_list_failed',
      error: error.message,
      details: { errorCode: error.code },
    });
    return { total: 0, generated: 0, failed: 0, skipped: 0 };
  }

  const list = workspaces.get();
  let generated = 0;
  let failed = 0;
  let skipped = 0;
  for (const workspace of list) {
    const step = await generateOneWorkspaceReport(
      workspace.id,
      input?.nowMs ?? null
    );
    if (step.outcome === 'report_published') generated += 1;
    else if (step.outcome === 'report_failed' || step.outcome === 'error') {
      failed += 1;
    } else skipped += 1;
  }

  return { total: list.length, generated, failed, skipped };
}

export type DailyIngestRunSummary = {
  workspaces: number;
  ingested: number;
};

/**
 * Daily ingestion entrypoint. Provider adapters are wired in the provider
 * ingestion step; this orchestrator iterates configured workspaces.
 */
async function ingestOneWorkspace(
  workspaceId: string,
  nowMs: number | null
): Promise<number> {
  'use step';
  const deps = buildIngestionDeps();
  const result = await runWorkspaceIngest(deps, {
    workspaceId: toWorkspaceId(workspaceId),
    now: nowMs === null ? undefined : new Date(nowMs),
  });
  if (result.isError()) return 0;
  const value = result.get();
  return value.type === 'workspace_ingested'
    ? value.sourceRecords + value.searchResults
    : 0;
}

export async function runDailyIngest(input?: {
  nowMs?: number;
}): Promise<DailyIngestRunSummary> {
  'use workflow';
  const repositories = getIntelligenceRepositories();
  const workspaces = await repositories.workspaceRepository.list();
  if (workspaces.isError()) {
    const error = workspaces.getError();
    getKernel().logger.error({
      event: 'intelligence.daily_ingest.workspace_list_failed',
      error: error.message,
      details: { errorCode: error.code },
    });
    return { workspaces: 0, ingested: 0 };
  }

  const list = workspaces.get();
  let ingested = 0;
  for (const workspace of list) {
    ingested += await ingestOneWorkspace(workspace.id, input?.nowMs ?? null);
  }
  return { workspaces: list.length, ingested };
}

const jobRequestHandlers = createIntelligenceJobRequestHandlers({
  getCronSecret: () => getCronSecret() ?? null,
  getProviderWebhookSecret: () => getProviderWebhookSecret() ?? null,
  getLogger: () => getKernel().logger,
  runWeeklyReports: () => runWeeklyReports(),
  runDailyIngest: () => runDailyIngest(),
  handleProviderCallback: (input) =>
    handleProviderCallback(buildIngestionDeps(), input),
});

export const handleWeeklyReportsCron =
  jobRequestHandlers.handleWeeklyReportsCron;
export const handleDailyIngestCron = jobRequestHandlers.handleDailyIngestCron;
export const handleProviderCallbackRequest =
  jobRequestHandlers.handleProviderCallbackRequest;
