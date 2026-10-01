import { randomUUID } from 'node:crypto';

import {
  generateWeeklyReport,
  handleProviderCallback,
  type IngestionDeps,
  runWorkspaceIngest,
  type ScheduledJobStatus,
  type WeeklyReportGenerationDeps,
  type WorkspaceJobStatus,
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
import { AppError } from '@/modules/kernel/domain/errors/app-error';

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

const runStatus = (
  succeeded: number,
  partial: number,
  failed: number
): 'succeeded' | 'partial' | 'failed' =>
  failed + partial === 0
    ? 'succeeded'
    : succeeded + partial > 0
      ? 'partial'
      : 'failed';

function logCompletion(event: string, details: Record<string, unknown>) {
  getKernel().logger.info({ event, details });
}

async function beginRun(
  id: string,
  kind: 'daily_ingest' | 'weekly_reports',
  now: Date
): Promise<boolean> {
  const started =
    await getIntelligenceRepositories().scheduledJobRepository.start({
      id,
      kind,
      startedAt: now,
    });
  if (started.isError()) {
    getKernel().logger.error({
      event: 'intelligence.scheduled_job.history_failed',
      details: {
        runId: id,
        kind,
        stage: 'start',
        errorCode: started.getError().code,
      },
    });
    return false;
  }
  return true;
}

async function finishRun(input: {
  id: string;
  status: ScheduledJobStatus;
  total: number;
  succeeded: number;
  partial: number;
  failed: number;
  skipped: number;
  items: number;
  failureCode: string | null;
}): Promise<boolean> {
  const result =
    await getIntelligenceRepositories().scheduledJobRepository.finish({
      ...input,
      finishedAt: new Date(),
    });
  if (result.isError()) {
    getKernel().logger.error({
      event: 'intelligence.scheduled_job.history_failed',
      details: {
        runId: input.id,
        stage: 'finish',
        errorCode: result.getError().code,
      },
    });
    return false;
  }
  return true;
}

type WorkspaceStep = {
  status: WorkspaceJobStatus;
  succeeded: number;
  partial: number;
  failed: number;
  skipped: number;
  items: number;
  requestsFailed?: number;
  failureCode: string | null;
  reportId: string | null;
};

async function recordWorkspace(
  runId: string,
  workspaceId: string,
  startedAt: Date,
  step: WorkspaceStep
): Promise<boolean> {
  const recorded =
    await getIntelligenceRepositories().scheduledJobRepository.upsertWorkspace({
      jobRunId: runId,
      workspaceId: toWorkspaceId(workspaceId),
      startedAt,
      finishedAt: new Date(),
      ...step,
    });
  if (recorded.isError()) {
    getKernel().logger.error({
      event: 'intelligence.scheduled_job.history_failed',
      details: {
        runId,
        workspaceId,
        stage: 'workspace',
        errorCode: recorded.getError().code,
      },
    });
    return false;
  }
  return true;
}

async function generateOneWorkspaceReport(
  workspaceId: string,
  runId: string,
  nowMs: number | null
): Promise<WorkspaceStep> {
  'use step';
  const startedAt = new Date();
  let result: Awaited<ReturnType<typeof generateWeeklyReport>>;
  try {
    result = await generateWeeklyReport(buildGenerationDeps(), {
      workspaceId: toWorkspaceId(workspaceId),
      now: nowMs === null ? undefined : new Date(nowMs),
    });
  } catch {
    const step: WorkspaceStep = {
      status: 'failed',
      succeeded: 0,
      partial: 0,
      failed: 1,
      skipped: 0,
      items: 0,
      failureCode: 'UNEXPECTED_ERROR',
      reportId: null,
    };
    getKernel().logger.error({
      event: 'intelligence.report.failed',
      exception: new AppError({
        code: 'WEEKLY_REPORT_FAILED',
        category: 'system',
        status: 502,
        message: 'Scheduled weekly report failed',
      }),
      details: { runId, workspaceId, failureCode: 'UNEXPECTED_ERROR' },
      sentryTags: { job: 'weekly_reports', failureCode: 'UNEXPECTED_ERROR' },
    });
    await recordWorkspace(runId, workspaceId, startedAt, step);
    return step;
  }
  let step: WorkspaceStep;
  if (result.isError()) {
    step = {
      status: 'failed',
      succeeded: 0,
      partial: 0,
      failed: 1,
      skipped: 0,
      items: 0,
      failureCode: result.getError().code,
      reportId: null,
    };
    getKernel().logger.error({
      event: 'intelligence.report.failed',
      exception: new AppError({
        code: 'WEEKLY_REPORT_FAILED',
        category: 'system',
        status: 502,
        message: 'Scheduled weekly report failed',
      }),
      details: { runId, workspaceId, failureCode: step.failureCode },
      sentryTags: {
        job: 'weekly_reports',
        failureCode: step.failureCode ?? 'REPORT_FAILED',
      },
    });
  } else {
    const value = result.get();
    step =
      value.type === 'report_published'
        ? {
            status: 'succeeded',
            succeeded: 1,
            partial: 0,
            failed: 0,
            skipped: 0,
            items: 1,
            failureCode: null,
            reportId: value.report.id,
          }
        : value.type === 'report_failed'
          ? {
              status: 'failed',
              succeeded: 0,
              partial: 0,
              failed: 1,
              skipped: 0,
              items: 0,
              failureCode: 'REPORT_FAILED',
              reportId: null,
            }
          : {
              status: 'skipped',
              succeeded: 0,
              partial: 0,
              failed: 0,
              skipped: 1,
              items: 0,
              failureCode: null,
              reportId: null,
            };
  }
  if (!(await recordWorkspace(runId, workspaceId, startedAt, step))) {
    return {
      ...step,
      status: 'failed',
      succeeded: 0,
      failed: 1,
      failureCode: 'HISTORY_WRITE_FAILED',
    };
  }
  return step;
}

export type WeeklyReportsRunSummary = {
  runId: string;
  status: ScheduledJobStatus;
  total: number;
  generated: number;
  failed: number;
  skipped: number;
};

/** Generate the weekly report for every workspace (Monday cron entrypoint). */
export async function runWeeklyReports(input?: {
  nowMs?: number;
  runId?: string;
}): Promise<WeeklyReportsRunSummary> {
  'use workflow';
  const runId = input?.runId ?? randomUUID();
  const started = await beginRun(
    runId,
    'weekly_reports',
    new Date(input?.nowMs ?? Date.now())
  );
  const workspaces =
    await getIntelligenceRepositories().workspaceRepository.list();
  if (workspaces.isError()) {
    const failureCode = workspaces.getError().code;
    getKernel().logger.error({
      event: 'intelligence.weekly_reports.workspace_list_failed',
      exception: new AppError({
        code: 'WEEKLY_REPORT_FAILED',
        category: 'system',
        status: 502,
        message: 'Scheduled weekly report failed',
      }),
      details: { runId, failureCode },
      sentryTags: { job: 'weekly_reports', failureCode },
    });
    if (started)
      await finishRun({
        id: runId,
        status: 'failed',
        total: 0,
        succeeded: 0,
        partial: 0,
        failed: 1,
        skipped: 0,
        items: 0,
        failureCode,
      });
    const summary = {
      runId,
      status: 'failed' as const,
      total: 0,
      generated: 0,
      failed: 1,
      skipped: 0,
    };
    logCompletion('intelligence.weekly_reports.completed', summary);
    return summary;
  }
  let generated = 0;
  let failed = 0;
  let skipped = 0;
  const list = workspaces.get();
  for (const workspace of list) {
    const step = await generateOneWorkspaceReport(
      workspace.id,
      runId,
      input?.nowMs ?? null
    );
    generated += step.succeeded;
    failed += step.failed;
    skipped += step.skipped;
  }
  let status = runStatus(generated, 0, failed);
  if (
    !started ||
    !(await finishRun({
      id: runId,
      status,
      total: list.length,
      succeeded: generated,
      partial: 0,
      failed,
      skipped,
      items: generated,
      failureCode: failed > 0 ? 'WORKSPACE_REPORT_FAILED' : null,
    }))
  ) {
    status = 'failed';
    failed += 1;
  }
  const summary = {
    runId,
    status,
    total: list.length,
    generated,
    failed,
    skipped,
  };
  logCompletion('intelligence.weekly_reports.completed', summary);
  return summary;
}

async function ingestOneWorkspace(
  workspaceId: string,
  runId: string,
  nowMs: number | null
): Promise<WorkspaceStep> {
  'use step';
  const startedAt = new Date();
  let result: Awaited<ReturnType<typeof runWorkspaceIngest>>;
  try {
    result = await runWorkspaceIngest(buildIngestionDeps(), {
      workspaceId: toWorkspaceId(workspaceId),
      scheduledJobRunId: runId,
      now: nowMs === null ? undefined : new Date(nowMs),
    });
  } catch {
    const step: WorkspaceStep = {
      status: 'failed',
      succeeded: 0,
      partial: 0,
      failed: 1,
      skipped: 0,
      items: 0,
      requestsFailed: 0,
      failureCode: 'UNEXPECTED_ERROR',
      reportId: null,
    };
    getKernel().logger.error({
      event: 'intelligence.daily_ingest.workspace_failed',
      details: { runId, workspaceId, failureCode: 'UNEXPECTED_ERROR' },
    });
    await recordWorkspace(runId, workspaceId, startedAt, step);
    return step;
  }
  let step: WorkspaceStep;
  if (result.isError()) {
    step = {
      status: 'failed',
      succeeded: 0,
      partial: 0,
      failed: 1,
      skipped: 0,
      items: 0,
      requestsFailed: 0,
      failureCode: result.getError().code,
      reportId: null,
    };
  } else {
    const value = result.get();
    if (value.type === 'workspace_not_found') {
      step = {
        status: 'skipped',
        succeeded: 0,
        partial: 0,
        failed: 0,
        skipped: 1,
        items: 0,
        requestsFailed: 0,
        failureCode: null,
        reportId: null,
      };
    } else {
      const status = runStatus(
        value.providersRun,
        value.providersPartial,
        value.providersFailed
      );
      step = {
        status,
        succeeded: value.providersRun,
        partial: value.providersPartial,
        failed: value.providersFailed,
        skipped: value.providersSkipped,
        items: value.sourceRecords + value.searchResults,
        requestsFailed: value.requestsFailed,
        failureCode:
          value.requestsFailed > 0
            ? 'PROVIDER_REQUEST_FAILED'
            : value.providersFailed + value.providersPartial > 0
              ? 'PROVIDER_INGEST_FAILED'
              : null,
        reportId: null,
      };
    }
  }
  if (!(await recordWorkspace(runId, workspaceId, startedAt, step))) {
    return {
      ...step,
      status: 'failed',
      succeeded: 0,
      partial: 0,
      failed: step.failed + 1,
      failureCode: 'HISTORY_WRITE_FAILED',
    };
  }
  return step;
}

export type DailyIngestRunSummary = {
  runId: string;
  status: ScheduledJobStatus;
  workspaces: number;
  ingested: number;
  failed: number;
  partial: number;
  providersSucceeded: number;
  providersPartial: number;
  providersFailed: number;
  providersSkipped: number;
  requestsFailed: number;
};

/** Daily ingestion entrypoint. */
export async function runDailyIngest(input?: {
  nowMs?: number;
  runId?: string;
}): Promise<DailyIngestRunSummary> {
  'use workflow';
  const runId = input?.runId ?? randomUUID();
  const started = await beginRun(
    runId,
    'daily_ingest',
    new Date(input?.nowMs ?? Date.now())
  );
  const workspaces =
    await getIntelligenceRepositories().workspaceRepository.list();
  if (workspaces.isError()) {
    const failureCode = workspaces.getError().code;
    getKernel().logger.error({
      event: 'intelligence.daily_ingest.workspace_list_failed',
      details: { runId, failureCode },
    });
    if (started)
      await finishRun({
        id: runId,
        status: 'failed',
        total: 0,
        succeeded: 0,
        partial: 0,
        failed: 1,
        skipped: 0,
        items: 0,
        failureCode,
      });
    const summary = {
      runId,
      status: 'failed' as const,
      workspaces: 0,
      ingested: 0,
      failed: 1,
      partial: 0,
      providersSucceeded: 0,
      providersPartial: 0,
      providersFailed: 0,
      providersSkipped: 0,
      requestsFailed: 0,
    };
    logCompletion('intelligence.daily_ingest.completed', summary);
    return summary;
  }
  const list = workspaces.get();
  let ingested = 0;
  let failed = 0;
  let partial = 0;
  let succeeded = 0;
  let skipped = 0;
  let providersSucceeded = 0;
  let providersPartial = 0;
  let providersFailed = 0;
  let providersSkipped = 0;
  let requestsFailed = 0;
  for (const workspace of list) {
    const step = await ingestOneWorkspace(
      workspace.id,
      runId,
      input?.nowMs ?? null
    );
    ingested += step.items;
    failed += Number(step.status === 'failed');
    partial += Number(step.status === 'partial');
    succeeded += Number(step.status === 'succeeded');
    skipped += Number(step.status === 'skipped');
    providersSucceeded += step.succeeded;
    providersPartial += step.partial;
    providersFailed += step.failed;
    providersSkipped += step.skipped;
    requestsFailed += step.requestsFailed ?? 0;
  }
  let status = runStatus(succeeded, partial, failed);
  if (
    !started ||
    !(await finishRun({
      id: runId,
      status,
      total: list.length,
      succeeded,
      partial,
      failed,
      skipped,
      items: ingested,
      failureCode: failed + partial > 0 ? 'WORKSPACE_INGEST_FAILED' : null,
    }))
  ) {
    status = 'failed';
    failed += 1;
  }
  const summary = {
    runId,
    status,
    workspaces: list.length,
    ingested,
    failed,
    partial,
    providersSucceeded,
    providersPartial,
    providersFailed,
    providersSkipped,
    requestsFailed,
  };
  logCompletion('intelligence.daily_ingest.completed', summary);
  return summary;
}

const jobRequestHandlers = createIntelligenceJobRequestHandlers({
  getCronSecret: () => getCronSecret() ?? null,
  getProviderWebhookSecret: () => getProviderWebhookSecret() ?? null,
  getLogger: () => getKernel().logger,
  runWeeklyReports: (runId) => runWeeklyReports({ runId }),
  runDailyIngest: (runId) => runDailyIngest({ runId }),
  handleProviderCallback: (input) =>
    handleProviderCallback(buildIngestionDeps(), input),
});

export const handleWeeklyReportsCron =
  jobRequestHandlers.handleWeeklyReportsCron;
export const handleDailyIngestCron = jobRequestHandlers.handleDailyIngestCron;
export const handleProviderCallbackRequest =
  jobRequestHandlers.handleProviderCallbackRequest;
