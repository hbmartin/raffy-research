import { Result } from '@swan-io/boxed';
import { randomUUID } from 'node:crypto';
import { match, P } from 'ts-pattern';

import {
  type DailyIngestRunSummary,
  generateWeeklyReport,
  handleProviderCallback,
  type IngestionDeps,
  type JobHistoryStatus,
  reportFailureContext,
  type ReportFailureDiagnostics,
  runWorkspaceIngest,
  safeReportFailureDiagnostics,
  safeUnexpectedFailureDiagnostics,
  type ScheduledJobKind,
  type ScheduledJobStatus,
  type WeeklyReportGenerationDeps,
  type WeeklyReportsRunSummary,
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
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';

import { getIntelligenceRepositories } from './intelligence';
import { getKernel } from './kernel';
import { newsletterPublicationNotifier } from './newsletter';

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
    publicationNotifier: newsletterPublicationNotifier,
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

export type {
  DailyIngestRunSummary,
  WeeklyReportsRunSummary,
} from '@/modules/intelligence';

async function writeHistory(
  details: Record<string, unknown>,
  write: () => Promise<ApplicationResult<unknown>>,
  reconcileMissing = false
): Promise<boolean> {
  try {
    const result = await write();
    if (result.isOk()) return true;
    const errorCode = result.getError().code;
    if (reconcileMissing && errorCode === 'SCHEDULED_JOB_FINISH_MISSING') {
      getKernel().logger.warn({
        event: 'intelligence.scheduled_job.reconciliation_missing',
        details: { ...details, errorCode },
      });
    } else logHistoryFailure(details, errorCode);
  } catch (error) {
    logHistoryFailure(
      details,
      'UNEXPECTED_ERROR',
      safeUnexpectedFailureDiagnostics(error)
    );
  }
  return false;
}

function logHistoryFailure(
  details: Record<string, unknown>,
  code: string,
  diagnostics?: ReportFailureDiagnostics
) {
  const errorCode =
    safeReportFailureDiagnostics({ errorCode: code }).errorCode ??
    'UNKNOWN_ERROR';
  getKernel().logger.error({
    event: 'intelligence.scheduled_job.history_failed',
    exception: new AppError({
      code: 'SCHEDULED_JOB_HISTORY_FAILED',
      category: 'system',
      status: 500,
      message: 'Scheduled job history persistence failed',
    }),
    details: {
      ...safeReportFailureDiagnostics(diagnostics),
      ...details,
      errorCode,
    },
    sentryTags: {
      job: String(details.kind),
      stage: String(details.stage),
      errorCode,
    },
  });
}

async function beginRun(id: string, kind: ScheduledJobKind, now: Date) {
  return writeHistory({ runId: id, kind, stage: 'start' }, () =>
    getIntelligenceRepositories().scheduledJobRepository.start({
      id,
      kind,
      startedAt: now,
    })
  );
}

async function finishRun(
  kind: ScheduledJobKind,
  started: boolean,
  input: {
    id: string;
    status: ScheduledJobStatus;
    total: number;
    succeeded: number;
    partial: number;
    failed: number;
    skipped: number;
    items: number;
    failureCode: string | null;
  }
) {
  return writeHistory(
    { runId: input.id, kind, stage: 'finish' },
    () =>
      getIntelligenceRepositories().scheduledJobRepository.finish({
        ...input,
        finishedAt: new Date(),
      }),
    !started
  );
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
type RecordedWorkspaceStep = {
  step: WorkspaceStep;
  historyStatus: JobHistoryStatus;
};

const failedStep = (failureCode: string): WorkspaceStep => ({
  status: 'failed',
  succeeded: 0,
  partial: 0,
  failed: 1,
  skipped: 0,
  items: 0,
  failureCode,
  reportId: null,
});
const skippedStep = (): WorkspaceStep => ({
  status: 'skipped',
  succeeded: 0,
  partial: 0,
  failed: 0,
  skipped: 1,
  items: 0,
  failureCode: null,
  reportId: null,
});

function logReportFailure(
  event: string,
  runId: string,
  failureCode: string,
  workspaceId?: string,
  diagnostics?: ReportFailureDiagnostics,
  errorCode?: string
) {
  const details = {
    ...safeReportFailureDiagnostics(diagnostics),
    runId,
    ...(workspaceId ? { workspaceId } : {}),
    failureCode,
    ...(errorCode ? { errorCode } : {}),
  };
  getKernel().logger.error({
    event,
    exception: new AppError({
      code: 'WEEKLY_REPORT_FAILED',
      category: 'system',
      status: 502,
      message: 'Scheduled weekly report failed',
      details,
    }),
    details,
    sentryTags: { job: 'weekly_reports', failureCode },
  });
}

async function recordWorkspace(
  kind: ScheduledJobKind,
  runId: string | null,
  workspaceId: string,
  startedAt: Date,
  step: WorkspaceStep
): Promise<RecordedWorkspaceStep> {
  const recorded =
    runId !== null &&
    (await writeHistory({ runId, kind, workspaceId, stage: 'workspace' }, () =>
      getIntelligenceRepositories().scheduledJobRepository.upsertWorkspace({
        jobRunId: runId,
        workspaceId: toWorkspaceId(workspaceId),
        startedAt,
        finishedAt: new Date(),
        ...step,
      })
    ));
  return { step, historyStatus: recorded ? 'recorded' : 'failed' };
}

async function generateOneWorkspaceReport(
  workspaceId: string,
  runId: string,
  historyRunId: string | null,
  nowMs: number | null
): Promise<RecordedWorkspaceStep> {
  'use step';
  const startedAt = new Date();
  let step: WorkspaceStep;
  let diagnostics: ReportFailureDiagnostics | undefined;
  let errorCode: string | undefined;
  try {
    const result = await generateWeeklyReport(buildGenerationDeps(), {
      workspaceId: toWorkspaceId(workspaceId),
      now: nowMs === null ? undefined : new Date(nowMs),
    });
    if (result.isOk() && result.get().type === 'workspace_not_found')
      return {
        step: skippedStep(),
        historyStatus: historyRunId === null ? 'failed' : 'recorded',
      };
    step = match(result)
      .with(Result.P.Error(P.select()), (error) => {
        const context = reportFailureContext(error);
        diagnostics =
          context?.diagnostics ?? safeReportFailureDiagnostics(error.details);
        if (context) errorCode = error.code;
        return failedStep(context?.failureCode ?? error.code);
      })
      .with(Result.P.Ok(P.select()), (value) =>
        match(value)
          .with({ type: 'report_published' }, ({ report }): WorkspaceStep => ({
            status: 'succeeded',
            succeeded: 1,
            partial: 0,
            failed: 0,
            skipped: 0,
            items: 1,
            failureCode: null,
            reportId: report.id,
          }))
          .with({ type: 'report_failed' }, (outcome) => {
            diagnostics = outcome.diagnostics;
            return failedStep(outcome.failureCode);
          })
          .with({ type: 'workspace_not_found' }, () => skippedStep())
          .exhaustive()
      )
      .exhaustive();
  } catch (error) {
    diagnostics = {
      ...safeUnexpectedFailureDiagnostics(error),
      stage: 'workspace',
    };
    step = failedStep('UNEXPECTED_ERROR');
  }
  if (step.status === 'failed')
    logReportFailure(
      'intelligence.report.failed',
      runId,
      step.failureCode ?? 'REPORT_FAILED',
      workspaceId,
      diagnostics,
      errorCode
    );
  return recordWorkspace(
    'weekly_reports',
    historyRunId,
    workspaceId,
    startedAt,
    step
  );
}

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
  const summary: WeeklyReportsRunSummary = {
    runId,
    status: 'succeeded',
    historyStatus: started ? 'recorded' : 'failed',
    total: 0,
    generated: 0,
    failed: 0,
    skipped: 0,
  };
  let failureCode: string | null = null;
  try {
    const workspaces =
      await getIntelligenceRepositories().workspaceRepository.list();
    if (workspaces.isError()) {
      failureCode = workspaces.getError().code;
      summary.status = 'failed';
      logReportFailure(
        'intelligence.weekly_reports.workspace_list_failed',
        runId,
        failureCode
      );
    } else {
      summary.total = workspaces.get().length;
      for (const workspace of workspaces.get()) {
        const { step, historyStatus } = await generateOneWorkspaceReport(
          workspace.id,
          runId,
          started ? runId : null,
          input?.nowMs ?? null
        );
        summary.generated += step.succeeded;
        summary.failed += step.failed;
        summary.skipped += step.skipped;
        if (historyStatus === 'failed') summary.historyStatus = 'failed';
      }
      summary.status = runStatus(summary.generated, 0, summary.failed);
      failureCode = summary.failed > 0 ? 'WORKSPACE_REPORT_FAILED' : null;
    }
  } catch (error) {
    summary.status = 'failed';
    failureCode = 'UNEXPECTED_ERROR';
    logReportFailure(
      'intelligence.weekly_reports.unexpected_failure',
      runId,
      failureCode,
      undefined,
      { ...safeUnexpectedFailureDiagnostics(error), stage: 'processing' }
    );
  }
  if (
    !(await finishRun('weekly_reports', started, {
      id: runId,
      status: summary.status,
      total: summary.total,
      succeeded: summary.generated,
      partial: 0,
      failed: summary.failed,
      skipped: summary.skipped,
      items: summary.generated,
      failureCode,
    }))
  )
    summary.historyStatus = 'failed';
  logCompletion('intelligence.weekly_reports.completed', summary);
  return summary;
}

async function ingestOneWorkspace(
  workspaceId: string,
  runId: string,
  historyRunId: string | null,
  nowMs: number | null
): Promise<RecordedWorkspaceStep> {
  'use step';
  const startedAt = new Date();
  let step: WorkspaceStep;
  try {
    const result = await runWorkspaceIngest(buildIngestionDeps(), {
      workspaceId: toWorkspaceId(workspaceId),
      ...(historyRunId !== null ? { scheduledJobRunId: historyRunId } : {}),
      now: nowMs === null ? undefined : new Date(nowMs),
    });
    if (result.isOk() && result.get().type === 'workspace_not_found')
      return {
        step: skippedStep(),
        historyStatus: historyRunId === null ? 'failed' : 'recorded',
      };
    step = match(result)
      .with(Result.P.Error(P.select()), (error) => failedStep(error.code))
      .with(Result.P.Ok(P.select()), (value) =>
        match(value)
          .with({ type: 'workspace_not_found' }, () => skippedStep())
          .with({ type: 'workspace_ingested' }, (outcome): WorkspaceStep => ({
            status: runStatus(
              outcome.providersRun,
              outcome.providersPartial,
              outcome.providersFailed
            ),
            succeeded: outcome.providersRun,
            partial: outcome.providersPartial,
            failed: outcome.providersFailed,
            skipped: outcome.providersSkipped,
            items: outcome.sourceRecords + outcome.searchResults,
            requestsFailed: outcome.requestsFailed,
            failureCode:
              outcome.requestsFailed > 0
                ? 'PROVIDER_REQUEST_FAILED'
                : outcome.providersFailed + outcome.providersPartial > 0
                  ? 'PROVIDER_INGEST_FAILED'
                  : null,
            reportId: null,
          }))
          .exhaustive()
      )
      .exhaustive();
  } catch (error) {
    step = failedStep('UNEXPECTED_ERROR');
    getKernel().logger.error({
      event: 'intelligence.daily_ingest.workspace_failed',
      details: {
        ...safeUnexpectedFailureDiagnostics(error),
        runId,
        workspaceId,
        stage: 'workspace',
        failureCode: 'UNEXPECTED_ERROR',
      },
    });
  }
  return recordWorkspace(
    'daily_ingest',
    historyRunId,
    workspaceId,
    startedAt,
    step
  );
}

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
  const summary: DailyIngestRunSummary = {
    runId,
    status: 'succeeded',
    historyStatus: started ? 'recorded' : 'failed',
    workspaces: 0,
    ingested: 0,
    failed: 0,
    partial: 0,
    providersSucceeded: 0,
    providersPartial: 0,
    providersFailed: 0,
    providersSkipped: 0,
    requestsFailed: 0,
  };
  let succeeded = 0;
  let skipped = 0;
  let failureCode: string | null = null;
  try {
    const workspaces =
      await getIntelligenceRepositories().workspaceRepository.list();
    if (workspaces.isError()) {
      failureCode = workspaces.getError().code;
      summary.status = 'failed';
      getKernel().logger.error({
        event: 'intelligence.daily_ingest.workspace_list_failed',
        details: { runId, failureCode },
      });
    } else {
      summary.workspaces = workspaces.get().length;
      for (const workspace of workspaces.get()) {
        const { step, historyStatus } = await ingestOneWorkspace(
          workspace.id,
          runId,
          started ? runId : null,
          input?.nowMs ?? null
        );
        summary.ingested += step.items;
        summary.failed += Number(step.status === 'failed');
        summary.partial += Number(step.status === 'partial');
        succeeded += Number(step.status === 'succeeded');
        skipped += Number(step.status === 'skipped');
        summary.providersSucceeded += step.succeeded;
        summary.providersPartial += step.partial;
        summary.providersFailed += step.failed;
        summary.providersSkipped += step.skipped;
        summary.requestsFailed += step.requestsFailed ?? 0;
        if (historyStatus === 'failed') summary.historyStatus = 'failed';
      }
      summary.status = runStatus(succeeded, summary.partial, summary.failed);
      failureCode =
        summary.failed + summary.partial > 0 ? 'WORKSPACE_INGEST_FAILED' : null;
    }
  } catch (error) {
    summary.status = 'failed';
    failureCode = 'UNEXPECTED_ERROR';
    getKernel().logger.error({
      event: 'intelligence.daily_ingest.unexpected_failure',
      details: {
        ...safeUnexpectedFailureDiagnostics(error),
        runId,
        stage: 'processing',
        failureCode,
      },
    });
  }
  if (
    !(await finishRun('daily_ingest', started, {
      id: runId,
      status: summary.status,
      total: summary.workspaces,
      succeeded,
      partial: summary.partial,
      failed: summary.failed,
      skipped,
      items: summary.ingested,
      failureCode,
    }))
  )
    summary.historyStatus = 'failed';
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
