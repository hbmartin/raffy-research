import type { Logger } from '@/modules/kernel';
import type { IdGenerator } from '@/modules/kernel/application/ports/id-generator';
import { AppError } from '@/modules/kernel/domain/errors/app-error';

import type { ProviderName } from '../../domain/intelligence';
import { zProviderName } from '../../domain/intelligence';
import type { IntelligenceUseCases } from '../../factory';
import type { IntelligenceRuntimeConfig } from '../../infrastructure/config/intelligence-env';
import { getProviderAdapter } from '../../infrastructure/providers/provider-registry';

type StartWorkflow = () => Promise<{ runId: string }>;

type IntelligenceHttpHandlerDeps = {
  clock: { now(): Date };
  getRuntimeConfig: (options?: {
    requireCronSecret?: boolean;
  }) => IntelligenceRuntimeConfig;
  getUseCases: () => IntelligenceUseCases;
  idGenerator: IdGenerator;
  logger?: Pick<Logger, 'error' | 'warn'>;
  startDailyIngestionWorkflow: StartWorkflow;
  startWeeklyReportsWorkflow: StartWorkflow;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const headersToJson = (headers: Headers): Record<string, string> =>
  Object.fromEntries(headers.entries());

const payloadWorkspaceId = (payload: unknown) => {
  if (!isRecord(payload)) return undefined;
  const value = payload.workspaceId ?? payload.workspace_id;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const requestWorkspaceId = (request: Request, payload: unknown) => {
  const url = new URL(request.url);
  return (
    url.searchParams.get('workspaceId') ??
    request.headers.get('x-workspace-id') ??
    payloadWorkspaceId(payload) ??
    undefined
  );
};

async function readPayload(request: Request): Promise<unknown> {
  const body = await request.text();
  if (!body.trim()) return {};

  const contentType = request.headers.get('content-type') ?? '';
  if (!contentType.includes('application/json')) {
    return { rawText: body };
  }

  return JSON.parse(body) as unknown;
}

function parseProvider(provider: string): ProviderName {
  const result = zProviderName().safeParse(provider);
  if (result.success) return result.data;

  throw new AppError({
    category: 'bad_request',
    code: 'INTELLIGENCE_PROVIDER_UNSUPPORTED',
    exposeDetails: true,
    message: 'Unsupported intelligence provider.',
    status: 400,
    details: { provider },
  });
}

function assertCronAuthorization(request: Request, cronSecret: string) {
  const expected = `Bearer ${cronSecret}`;
  if (request.headers.get('authorization') === expected) return;

  throw new AppError({
    category: 'unauthorized',
    code: 'INTELLIGENCE_CRON_UNAUTHORIZED',
    message: 'Cron route authorization failed.',
    status: 401,
  });
}

export function createIntelligenceHttpHandlers(
  deps: IntelligenceHttpHandlerDeps
) {
  const receiveProviderCallback = async (input: {
    provider: string;
    request: Request;
  }) => {
    const providerName = parseProvider(input.provider);
    const payload = await readPayload(input.request);
    const workspaceId = requestWorkspaceId(input.request, payload);
    const now = deps.clock.now();
    const { repository } = deps.getUseCases();
    const callbackEvent = await repository.insertProviderCallbackEvent({
      id: deps.idGenerator.createId(),
      workspaceId,
      providerName,
      status: 'received',
      receivedAt: now,
      headers: headersToJson(input.request.headers),
      rawPayload: isRecord(payload) ? payload : { payload },
    });

    if (!workspaceId) {
      return Response.json({
        ok: true,
        callbackEventId: callbackEvent.id,
        normalized: false,
        reason: 'missing_workspace_id',
      });
    }

    try {
      const normalized = getProviderAdapter(providerName).normalizeCallback({
        now,
        payload,
        providerName,
      });

      for (const source of normalized.sourceRecords) {
        await repository.insertSourceRecord({
          ...source,
          id: deps.idGenerator.createId(),
          workspaceId,
          providerName,
          capturedAt: now,
        });
      }

      for (const searchResult of normalized.searchResults) {
        await repository.insertSearchResult({
          ...searchResult,
          id: deps.idGenerator.createId(),
          workspaceId,
          providerName,
          returnedAt: searchResult.returnedAt ?? now,
        });
      }

      await repository.updateProviderCallbackEvent(callbackEvent.id, {
        metadata: {
          searchResultsInserted: normalized.searchResults.length,
          sourcesInserted: normalized.sourceRecords.length,
        },
        normalizedAt: deps.clock.now(),
        status: 'normalized',
      });

      return Response.json({
        ok: true,
        callbackEventId: callbackEvent.id,
        normalized: true,
        searchResultsInserted: normalized.searchResults.length,
        sourcesInserted: normalized.sourceRecords.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown';
      deps.logger?.warn({
        event: 'intelligence.provider_callback_normalization_failed',
        exception: error,
        details: { callbackEventId: callbackEvent.id, providerName },
      });
      await repository.updateProviderCallbackEvent(callbackEvent.id, {
        failureReason: message,
        status: 'failed',
      });
      return Response.json(
        {
          ok: false,
          callbackEventId: callbackEvent.id,
          error: message,
        },
        { status: 202 }
      );
    }
  };

  const startDailyIngestion = async (request: Request) => {
    const config = deps.getRuntimeConfig({ requireCronSecret: true });
    assertCronAuthorization(request, config.cronSecret!);
    const run = await deps.startDailyIngestionWorkflow();
    return Response.json({ ok: true, runId: run.runId });
  };

  const startWeeklyReports = async (request: Request) => {
    const config = deps.getRuntimeConfig({ requireCronSecret: true });
    assertCronAuthorization(request, config.cronSecret!);
    const run = await deps.startWeeklyReportsWorkflow();
    return Response.json({ ok: true, runId: run.runId });
  };

  return {
    receiveProviderCallback,
    startDailyIngestion,
    startWeeklyReports,
  };
}

export type IntelligenceHttpHandlers = ReturnType<
  typeof createIntelligenceHttpHandlers
>;
