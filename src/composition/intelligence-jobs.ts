import { timingSafeEqual } from 'node:crypto';

import {
  generateWeeklyReport,
  handleProviderCallback,
  type IngestionDeps,
  runWorkspaceIngest,
  type WeeklyReportGenerationDeps,
} from '@/modules/intelligence';
import {
  createOpenAiReportGenerator,
  createProviderRegistry,
  createSlackAlert,
  getCronSecret,
  getProviderCredential,
  getProviderWebhookSecret,
} from '@/modules/intelligence/backend';
import { toWorkspaceId, zWorkspaceId } from '@/modules/kernel';
import type { JsonValue } from '@/modules/kernel/domain/json';

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

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/** Cron routes require `Authorization: Bearer ${CRON_SECRET}`. */
function constantTimeStringEquals(actual: string, expected: string): boolean {
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.toLowerCase().startsWith('bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

function isAuthorizedCronRequest(request: Request): boolean {
  const secret = getCronSecret();
  if (!secret) {
    getKernel().logger.warn({
      event: 'intelligence.cron.secret_not_configured',
      details: { message: 'CRON_SECRET environment variable is not set' },
    });
    return false;
  }
  const token = getBearerToken(request);
  return token ? constantTimeStringEquals(token, secret) : false;
}

function isAuthorizedProviderCallbackRequest(request: Request): boolean {
  const secret = getProviderWebhookSecret();
  if (!secret) {
    getKernel().logger.warn({
      event: 'intelligence.provider_callback.secret_not_configured',
      details: {
        message: 'PROVIDER_WEBHOOK_SECRET environment variable is not set',
      },
    });
    return false;
  }

  const token =
    getBearerToken(request) ?? request.headers.get('x-provider-webhook-secret');
  return token ? constantTimeStringEquals(token, secret) : false;
}

export async function handleWeeklyReportsCron(
  request: Request
): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  const summary = await runWeeklyReports();
  return jsonResponse({ ok: true, ...summary });
}

export async function handleDailyIngestCron(
  request: Request
): Promise<Response> {
  if (!isAuthorizedCronRequest(request)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }
  const summary = await runDailyIngest();
  return jsonResponse({ ok: true, ...summary });
}

async function readJsonBody(request: Request): Promise<JsonValue> {
  try {
    return (await request.json()) as JsonValue;
  } catch (error) {
    const contentLength = request.headers.get('content-length');
    if (contentLength !== '0') {
      getKernel().logger.warn({
        event: 'intelligence.provider_callback.invalid_json_body',
        error: error instanceof Error ? error.message : String(error),
        exception: error,
        details: {
          contentLength,
          contentType: request.headers.get('content-type'),
        },
      });
    }
    return null;
  }
}

/**
 * Generic provider callback entrypoint: stores the raw payload first, then
 * normalizes to source records when an adapter and `?workspaceId=` are present.
 */
export async function handleProviderCallbackRequest(
  provider: string,
  request: Request
): Promise<Response> {
  if (!isAuthorizedProviderCallbackRequest(request)) {
    return jsonResponse({ error: 'unauthorized' }, 401);
  }

  const url = new URL(request.url);
  const workspaceIdParam = url.searchParams.get('workspaceId');
  const parsedWorkspaceId = workspaceIdParam
    ? zWorkspaceId().safeParse(workspaceIdParam)
    : null;

  const payload = await readJsonBody(request);
  const result = await handleProviderCallback(buildIngestionDeps(), {
    providerName: provider,
    workspaceId: parsedWorkspaceId?.success ? parsedWorkspaceId.data : null,
    payload,
  });
  if (result.isError()) {
    return jsonResponse({ ok: false, error: result.getError().message }, 500);
  }
  return jsonResponse({ ok: true, ...result.get() });
}
