import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';

import type { Logger } from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { type WorkspaceId, zWorkspaceId } from '@/modules/kernel/domain/ids';
import type { JsonValue } from '@/modules/kernel/domain/json';

import type { HandleProviderCallbackOutcome } from '../../application/use-cases/ingestion/handle-provider-callback';
import type {
  DailyIngestRunSummary,
  WeeklyReportsRunSummary,
} from '../../domain/scheduled-job';

type JobRequestHandlerDeps = {
  getCronSecret: () => string | null;
  getProviderWebhookSecret: () => string | null;
  getLogger: () => Logger;
  runWeeklyReports: (runId: string) => Promise<WeeklyReportsRunSummary>;
  runDailyIngest: (runId: string) => Promise<DailyIngestRunSummary>;
  handleProviderCallback: (input: {
    providerName: string;
    workspaceId: WorkspaceId | null;
    payload: JsonValue;
  }) => Promise<ApplicationResult<HandleProviderCallbackOutcome>>;
};

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

function constantTimeStringEquals(actual: string, expected: string): boolean {
  const actualHash = createHash('sha256').update(actual).digest();
  const expectedHash = createHash('sha256').update(expected).digest();
  return timingSafeEqual(actualHash, expectedHash);
}

function getBearerToken(request: Request): string | null {
  const authorization = request.headers.get('authorization');
  if (!authorization?.toLowerCase().startsWith('bearer ')) return null;
  return authorization.slice('Bearer '.length).trim() || null;
}

function isAuthorizedCronRequest(
  deps: JobRequestHandlerDeps,
  request: Request
): boolean {
  const secret = deps.getCronSecret();
  if (!secret) {
    deps.getLogger().warn({
      event: 'intelligence.cron.secret_not_configured',
      details: { message: 'CRON_SECRET environment variable is not set' },
    });
    return false;
  }
  const token = getBearerToken(request);
  return token ? constantTimeStringEquals(token, secret) : false;
}

function isAuthorizedProviderCallbackRequest(
  deps: JobRequestHandlerDeps,
  request: Request
): boolean {
  const secret = deps.getProviderWebhookSecret();
  if (!secret) {
    deps.getLogger().warn({
      event: 'intelligence.provider_callback.secret_not_configured',
      details: {
        message: 'PROVIDER_WEBHOOK_SECRET environment variable is not set',
      },
    });
    return false;
  }

  const bearerToken = getBearerToken(request);
  const webhookSecret =
    request.headers.get('x-provider-webhook-secret')?.trim() || null;
  return [bearerToken, webhookSecret].some((token) =>
    token ? constantTimeStringEquals(token, secret) : false
  );
}

async function readJsonBody(
  deps: JobRequestHandlerDeps,
  request: Request
): Promise<JsonValue> {
  try {
    return (await request.json()) as JsonValue;
  } catch (error) {
    const contentLength = request.headers.get('content-length');
    if (contentLength !== '0') {
      deps.getLogger().warn({
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

export function createIntelligenceJobRequestHandlers(
  deps: JobRequestHandlerDeps
) {
  return {
    async handleWeeklyReportsCron(request: Request): Promise<Response> {
      if (!isAuthorizedCronRequest(deps, request)) {
        return jsonResponse({ error: 'unauthorized' }, 401);
      }
      const runId = randomUUID();
      try {
        const summary = await deps.runWeeklyReports(runId);
        return jsonResponse({ ok: summary.status === 'succeeded', ...summary });
      } catch {
        const summary = {
          runId,
          status: 'failed' as const,
          historyStatus: 'failed' as const,
          total: 0,
          generated: 0,
          failed: 0,
          skipped: 0,
        };
        deps.getLogger().error({
          event: 'intelligence.weekly_reports.unexpected_failure',
          exception: new AppError({
            code: 'WEEKLY_REPORT_FAILED',
            category: 'system',
            status: 502,
            message: 'Scheduled weekly report failed',
          }),
          details: { runId, failureCode: 'UNEXPECTED_ERROR' },
          sentryTags: {
            job: 'weekly_reports',
            failureCode: 'UNEXPECTED_ERROR',
          },
        });
        deps.getLogger().info({
          event: 'intelligence.weekly_reports.completed',
          details: summary,
        });
        return jsonResponse({ ok: false, ...summary });
      }
    },

    async handleDailyIngestCron(request: Request): Promise<Response> {
      if (!isAuthorizedCronRequest(deps, request)) {
        return jsonResponse({ error: 'unauthorized' }, 401);
      }
      const runId = randomUUID();
      try {
        const summary = await deps.runDailyIngest(runId);
        return jsonResponse({ ok: summary.status === 'succeeded', ...summary });
      } catch {
        const summary = {
          runId,
          status: 'failed' as const,
          historyStatus: 'failed' as const,
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
        deps.getLogger().error({
          event: 'intelligence.daily_ingest.unexpected_failure',
          details: { runId, failureCode: 'UNEXPECTED_ERROR' },
        });
        deps.getLogger().info({
          event: 'intelligence.daily_ingest.completed',
          details: summary,
        });
        return jsonResponse({ ok: false, ...summary });
      }
    },

    async handleProviderCallbackRequest(
      provider: string,
      request: Request
    ): Promise<Response> {
      if (!isAuthorizedProviderCallbackRequest(deps, request)) {
        return jsonResponse({ error: 'unauthorized' }, 401);
      }

      const url = new URL(request.url);
      const workspaceIdParam = url.searchParams.get('workspaceId');
      const parsedWorkspaceId = workspaceIdParam
        ? zWorkspaceId().safeParse(workspaceIdParam)
        : null;

      const payload = await readJsonBody(deps, request);
      const result = await deps.handleProviderCallback({
        providerName: provider,
        workspaceId: parsedWorkspaceId?.success ? parsedWorkspaceId.data : null,
        payload,
      });
      if (result.isError()) {
        return jsonResponse(
          { ok: false, error: result.getError().message },
          500
        );
      }
      return jsonResponse({ ok: true, ...result.get() });
    },
  };
}
