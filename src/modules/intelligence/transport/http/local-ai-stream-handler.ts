import { Result } from '@swan-io/boxed';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import type { AuthUseCases } from '@/modules/auth';
import {
  computeWeeklyPeriod,
  evaluateLabReport,
  generateWeeklyReport,
  handleProviderCallback,
  type IngestionDeps,
  type IngestionRepository,
  type IntelligenceUseCases,
  type LabTextPort,
  type ReportGetOutcome,
  type ReportLatestOutcome,
  type ReportRepository,
  runWorkspaceIngest,
  type SourceRepository,
  summarizeLabSource,
  type WeeklyReportGenerationDeps,
  type WorkspaceRepository,
} from '@/modules/intelligence';
import {
  toSourceRecordId,
  toWeeklyReportId,
  zProviderCallbackEventId,
  zSourceRecordId,
  zWorkspaceId,
} from '@/modules/kernel';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

import {
  LOCAL_AI_PROVIDERS,
  type LocalAiConfig,
  type LocalAiNdjsonEvent,
  type LocalAiProviderName,
  type LocalTextGenerator,
} from '../../domain/local-ai';

type LocalAiRepositories = {
  workspaceRepository: WorkspaceRepository;
  sourceRepository: SourceRepository;
  reportRepository: ReportRepository;
  ingestionRepository: IngestionRepository;
};

export type LocalAiStreamHandlerDeps = {
  isDev: () => boolean;
  getConfig: () => LocalAiConfig;
  getAuthUseCases: () => Pick<AuthUseCases, 'getCurrentSession'>;
  getIntelligenceUseCases: () => Pick<
    IntelligenceUseCases,
    'getWorkspaceConfig'
  >;
  getRepositories: () => LocalAiRepositories;
  buildIngestionDeps: () => IngestionDeps;
  buildGenerationDeps: (input: {
    provider: LocalAiProviderName;
    model: string;
    rawOutputDir: string;
    runId: string;
    ollamaBaseUrl?: string;
    ollamaNumCtx?: number;
    action: string;
    abortSignal: AbortSignal;
    emit: (event: LocalAiNdjsonEvent) => void | Promise<void>;
  }) => WeeklyReportGenerationDeps;
  generateLocalText: LocalTextGenerator;
  recordEvaluation?: (input: {
    workspaceId: string;
    targetId: string;
    kind: 'evaluation';
    provenance: import('../../domain/judgment').JudgmentProvenance;
    payload: Record<string, unknown>;
  }) => Promise<
    import('@/modules/kernel/application/result').ApplicationResult<{
      type: string;
    }>
  >;
};

const zLocalAiAction = z.enum([
  'list_sources',
  'ingest_enabled',
  'reprocess_callbacks',
  'summarize_sources',
  'generate_report',
  'evaluate_report',
  'full_workflow',
]);

const zLocalAiRequest = z
  .object({
    action: zLocalAiAction,
    workspaceId: zWorkspaceId(),
    periodDate: z.string().optional(),
    sourceRecordIds: z.array(zSourceRecordId()).default([]),
    callbackEventIds: z.array(zProviderCallbackEventId()).default([]),
    provider: z.enum(LOCAL_AI_PROVIDERS).optional(),
    model: z.string().trim().min(1).optional(),
    includeSourceSummaries: z.boolean().default(true),
  })
  .superRefine((data, ctx) => {
    if (
      data.action === 'reprocess_callbacks' &&
      data.callbackEventIds.length === 0
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['callbackEventIds'],
        message: 'callbackEventIds is required for reprocess_callbacks',
      });
    }
  });

type LocalAiRequest = z.infer<typeof zLocalAiRequest>;

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

const nowIso = () => new Date().toISOString();

function createLocalAiAbortError(message: string, cause?: unknown) {
  return new AppError({
    code: 'LOCAL_AI_RUN_ABORTED',
    category: 'system',
    status: 499,
    message,
    cause,
  });
}

const parsePeriodDate = (value: string | undefined) => {
  if (!value) return new Date();
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new AppError({
      code: 'LOCAL_AI_INVALID_PERIOD_DATE',
      category: 'bad_request',
      status: 400,
      message: 'periodDate must be parseable as a Date',
    });
  }
  return parsed;
};

function throwIfAborted(signal: AbortSignal) {
  if (!signal.aborted) return;
  const reason = signal.reason;
  if (reason instanceof AppError) throw reason;
  throw createLocalAiAbortError(
    reason instanceof Error
      ? reason.message
      : typeof reason === 'string'
        ? reason
        : 'Local AI run aborted',
    reason
  );
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
}

async function listPeriodSources(
  deps: LocalAiStreamHandlerDeps,
  input: {
    workspaceId: LocalAiRequest['workspaceId'];
    periodDate: Date;
  }
) {
  const repositories = deps.getRepositories();
  const workspaceResult = await repositories.workspaceRepository.getById(
    input.workspaceId
  );
  if (workspaceResult.isError()) throw workspaceResult.getError();
  const workspaceOutcome = workspaceResult.get();
  if (workspaceOutcome.type === 'workspace_not_found') {
    throw new AppError({
      code: 'LOCAL_AI_WORKSPACE_NOT_FOUND',
      category: 'not_found',
      status: 404,
      message: 'Workspace not found',
    });
  }
  const period = computeWeeklyPeriod(
    input.periodDate,
    workspaceOutcome.workspace.timezone
  );
  const sources = await repositories.sourceRepository.listForPeriod({
    workspaceId: input.workspaceId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
  if (sources.isError()) throw sources.getError();
  return {
    workspace: workspaceOutcome.workspace,
    period,
    sources: sources.get(),
  };
}

async function resolveSourcesForRun(
  deps: LocalAiStreamHandlerDeps,
  input: {
    data: LocalAiRequest;
    periodDate: Date;
  }
) {
  const repositories = deps.getRepositories();
  if (input.data.sourceRecordIds.length > 0) {
    const sources = await repositories.sourceRepository.getManyByIds(
      input.data.workspaceId,
      input.data.sourceRecordIds
    );
    if (sources.isError()) throw sources.getError();
    return sources.get();
  }
  return (
    await listPeriodSources(deps, {
      workspaceId: input.data.workspaceId,
      periodDate: input.periodDate,
    })
  ).sources;
}

function streamLabText(
  deps: LocalAiStreamHandlerDeps,
  input: Parameters<typeof summarizeSources>[1]
): LabTextPort {
  return async ({ prompt, label }) => {
    try {
      const output = await deps.generateLocalText({
        provider: input.provider,
        model: input.model,
        prompt,
        label,
        action: input.data.action,
        runId: input.runId,
        rawOutputDir: input.rawOutputDir,
        ollamaBaseUrl: input.ollamaBaseUrl,
        ollamaNumCtx: input.ollamaNumCtx,
        abortSignal: input.abortSignal,
        onEvent: input.emit,
      });
      return Result.Ok({ type: 'text_generated', ...output });
    } catch (cause) {
      return Result.Error(
        cause instanceof AppError
          ? cause
          : new AppError({
              code: 'LOCAL_MODEL_FAILED',
              category: 'system',
              status: 502,
              cause,
            })
      );
    }
  };
}

async function summarizeSources(
  deps: LocalAiStreamHandlerDeps,
  input: {
    data: LocalAiRequest;
    periodDate: Date;
    provider: LocalAiProviderName;
    model: string;
    rawOutputDir: string;
    runId: string;
    ollamaBaseUrl?: string;
    ollamaNumCtx?: number;
    abortSignal: AbortSignal;
    emit: (event: LocalAiNdjsonEvent) => void | Promise<void>;
  }
) {
  const repositories = deps.getRepositories();
  const sources = await resolveSourcesForRun(deps, {
    data: input.data,
    periodDate: input.periodDate,
  });
  const summaries = [];

  for (const source of sources) {
    throwIfAborted(input.abortSignal);
    const created = await summarizeLabSource(
      {
        generate: streamLabText(deps, input),
        sources: repositories.sourceRepository,
      },
      source
    );
    if (created.isError()) throw created.getError();
    const outcome = created.get();
    if (outcome.type !== 'source_summarized')
      throw new AppError({
        code: 'LOCAL_AI_INTERRUPTED',
        category: 'conflict',
        status: 409,
      });
    summaries.push(outcome.summary);
    await input.emit({
      type: 'artifact',
      runId: input.runId,
      action: input.data.action,
      label: 'source-summary',
      artifact: {
        kind: 'source_summary',
        sourceRecordId: source.id,
        sourceSummaryId: outcome.summaryId,
      },
      at: nowIso(),
    });
  }

  return summaries;
}

async function reprocessCallbacks(
  deps: LocalAiStreamHandlerDeps,
  input: {
    data: LocalAiRequest;
    runId: string;
    abortSignal: AbortSignal;
    emit: (event: LocalAiNdjsonEvent) => void | Promise<void>;
  }
) {
  const repositories = deps.getRepositories();
  const ingestionDeps = deps.buildIngestionDeps();
  const callbacks =
    await repositories.ingestionRepository.getCallbackEventsByIds({
      workspaceId: input.data.workspaceId,
      ids: input.data.callbackEventIds,
    });
  if (callbacks.isError()) throw callbacks.getError();

  let normalized = 0;
  let sourceRecords = 0;
  for (const callback of callbacks.get()) {
    throwIfAborted(input.abortSignal);
    await input.emit({
      type: 'step',
      runId: input.runId,
      action: input.data.action,
      label: 'callback-reprocess',
      message: 'callback_reprocess_started',
      at: nowIso(),
      data: {
        callbackEventId: callback.id,
        providerName: callback.providerName,
      },
    });
    const result = await handleProviderCallback(ingestionDeps, {
      providerName: callback.providerName,
      workspaceId: input.data.workspaceId,
      payload: callback.rawPayload,
    });
    if (result.isError()) throw result.getError();
    const value = result.get();
    normalized += value.normalized ? 1 : 0;
    sourceRecords += value.sourceRecords;
  }

  return {
    callbacks: callbacks.get().length,
    normalized,
    sourceRecords,
  };
}

/**
 * LLM-judge pass over the workspace's latest published report: claims are
 * checked against the report period's source records. The verdict is only
 * streamed back (and captured in raw-output files); nothing is persisted.
 */
async function evaluateLatestReport(
  deps: LocalAiStreamHandlerDeps,
  input: {
    data: LocalAiRequest;
    reportId?: string;
    runId: string;
    actorId?: string;
    provider: LocalAiProviderName;
    model: string;
    rawOutputDir: string;
    ollamaBaseUrl?: string;
    ollamaNumCtx?: number;
    abortSignal: AbortSignal;
    emit: (event: LocalAiNdjsonEvent) => void | Promise<void>;
  }
) {
  const repositories = deps.getRepositories();
  const latest: import('@/modules/kernel/application/result').ApplicationResult<
    ReportGetOutcome | ReportLatestOutcome
  > = input.reportId
    ? await repositories.reportRepository.getById(
        toWeeklyReportId(input.reportId)
      )
    : await repositories.reportRepository.getLatestPublished(
        input.data.workspaceId
      );
  if (latest.isError()) throw latest.getError();
  const latestOutcome = latest.get();
  if (latestOutcome.type !== 'report_found') {
    throw new AppError({
      code: 'LOCAL_AI_NO_PUBLISHED_REPORT',
      category: 'not_found',
      status: 404,
      message: 'No published report to evaluate for this workspace',
    });
  }
  const report = latestOutcome.report;

  const sources = await repositories.sourceRepository.listForPeriod({
    workspaceId: input.data.workspaceId,
    periodStart: report.periodStart,
    periodEnd: report.periodEnd,
  });
  if (sources.isError()) throw sources.getError();

  await input.emit({
    type: 'step',
    runId: input.runId,
    action: input.data.action,
    label: 'report-eval',
    message: 'report_evaluation_started',
    at: nowIso(),
    data: { reportId: report.id, sources: sources.get().length },
  });

  const result = await evaluateLabReport(
    streamLabText(deps, { ...input, periodDate: report.periodStart }),
    report,
    sources.get()
  );
  if (result.isError()) throw result.getError();
  const verdict = result.get();
  if (verdict.type === 'report_evaluated' && deps.recordEvaluation) {
    const saved = await deps.recordEvaluation({
      workspaceId: input.data.workspaceId,
      targetId: report.id,
      kind: 'evaluation',
      provenance: {
        origin: 'automated',
        channel: 'web',
        actorId: input.actorId,
        model: verdict.modelName,
        promptVersion: verdict.promptVersion,
      },
      payload: { ...verdict, runId: input.runId },
    });
    if (saved.isError()) throw saved.getError();
  }
  await input.emit({
    type: 'artifact',
    runId: input.runId,
    action: input.data.action,
    label: 'report-eval',
    artifact: {
      kind: 'report_evaluation',
      ...(toJsonValue(verdict) as JsonObject),
    },
    at: nowIso(),
  });
  return {
    reportId: report.id,
    parsedVerdict: verdict.type === 'report_evaluated',
  };
}

async function runAction(
  deps: LocalAiStreamHandlerDeps,
  input: {
    data: LocalAiRequest;
    runId: string;
    actorId?: string;
    provider: LocalAiProviderName;
    model: string;
    rawOutputDir: string;
    ollamaBaseUrl?: string;
    ollamaNumCtx?: number;
    abortSignal: AbortSignal;
    emit: (event: LocalAiNdjsonEvent) => void | Promise<void>;
  }
) {
  throwIfAborted(input.abortSignal);
  const periodDate = parsePeriodDate(input.data.periodDate);

  if (input.data.action === 'list_sources') {
    const listed = await listPeriodSources(deps, {
      workspaceId: input.data.workspaceId,
      periodDate,
    });
    await input.emit({
      type: 'artifact',
      runId: input.runId,
      action: input.data.action,
      label: 'sources',
      artifact: {
        kind: 'period_sources',
        periodStart: listed.period.periodStart.toISOString(),
        periodEnd: listed.period.periodEnd.toISOString(),
        sources: toJsonValue(listed.sources),
      },
      at: nowIso(),
    });
    return { sources: listed.sources.length };
  }

  if (input.data.action === 'evaluate_report') {
    return evaluateLatestReport(deps, input);
  }

  if (
    input.data.action === 'ingest_enabled' ||
    input.data.action === 'full_workflow'
  ) {
    throwIfAborted(input.abortSignal);
    await input.emit({
      type: 'step',
      runId: input.runId,
      action: input.data.action,
      label: 'ingest',
      message: 'workspace_ingest_started',
      at: nowIso(),
    });
    const ingest = await runWorkspaceIngest(deps.buildIngestionDeps(), {
      workspaceId: input.data.workspaceId,
      signal: input.abortSignal,
    });
    if (ingest.isError()) throw ingest.getError();
    await input.emit({
      type: 'artifact',
      runId: input.runId,
      action: input.data.action,
      label: 'ingest',
      artifact: {
        kind: 'workspace_ingest',
        outcome: toJsonValue(ingest.get()),
      },
      at: nowIso(),
    });
    if (input.data.action === 'ingest_enabled') return ingest.get();
  }

  if (
    (input.data.action === 'reprocess_callbacks' ||
      input.data.action === 'full_workflow') &&
    input.data.callbackEventIds.length > 0
  ) {
    const reprocess = await reprocessCallbacks(deps, {
      data: input.data,
      runId: input.runId,
      abortSignal: input.abortSignal,
      emit: input.emit,
    });
    await input.emit({
      type: 'artifact',
      runId: input.runId,
      action: input.data.action,
      label: 'callback-reprocess',
      artifact: { kind: 'callback_reprocess', ...reprocess },
      at: nowIso(),
    });
    if (input.data.action === 'reprocess_callbacks') return reprocess;
  }

  if (
    input.data.action === 'summarize_sources' ||
    input.data.action === 'full_workflow'
  ) {
    const summaries = await summarizeSources(deps, {
      data: input.data,
      periodDate,
      provider: input.provider,
      model: input.model,
      rawOutputDir: input.rawOutputDir,
      runId: input.runId,
      ollamaBaseUrl: input.ollamaBaseUrl,
      ollamaNumCtx: input.ollamaNumCtx,
      abortSignal: input.abortSignal,
      emit: input.emit,
    });
    await input.emit({
      type: 'artifact',
      runId: input.runId,
      action: input.data.action,
      label: 'source-summaries',
      artifact: {
        kind: 'source_summaries',
        count: summaries.length,
        summaries: toJsonValue(summaries),
      },
      at: nowIso(),
    });
    if (input.data.action === 'summarize_sources') {
      return { summaries: summaries.length };
    }
  }

  if (
    input.data.action === 'generate_report' ||
    input.data.action === 'full_workflow'
  ) {
    await input.emit({
      type: 'step',
      runId: input.runId,
      action: input.data.action,
      label: 'report',
      message: 'weekly_report_generation_started',
      at: nowIso(),
    });
    const result = await generateWeeklyReport(
      deps.buildGenerationDeps({
        provider: input.provider,
        model: input.model,
        rawOutputDir: input.rawOutputDir,
        runId: input.runId,
        ollamaBaseUrl: input.ollamaBaseUrl,
        ollamaNumCtx: input.ollamaNumCtx,
        action: input.data.action,
        abortSignal: input.abortSignal,
        emit: input.emit,
      }),
      {
        workspaceId: input.data.workspaceId,
        now: periodDate,
        sourceRecordIds:
          input.data.sourceRecordIds.length > 0
            ? input.data.sourceRecordIds.map((id) => toSourceRecordId(id))
            : undefined,
        includeSourceSummaries: input.data.includeSourceSummaries,
      }
    );
    if (result.isError()) throw result.getError();
    await input.emit({
      type: 'artifact',
      runId: input.runId,
      action: input.data.action,
      label: 'report',
      artifact: { kind: 'weekly_report', outcome: toJsonValue(result.get()) },
      at: nowIso(),
    });
    const published = result.get();
    if (
      input.data.action === 'full_workflow' &&
      published.type === 'report_published'
    ) {
      const evaluation = await evaluateLatestReport(deps, {
        ...input,
        reportId: published.report.id,
      });
      return { ...published, evaluation };
    }
    return published;
  }

  return {};
}

async function authenticateAndAuthorize(
  deps: LocalAiStreamHandlerDeps,
  request: Request,
  data: LocalAiRequest
) {
  const session = await deps.getAuthUseCases().getCurrentSession({
    headers: request.headers,
  });
  if (session.isError()) throw session.getError();
  const sessionOutcome = session.get();
  if (sessionOutcome.type === 'auth_session_missing') {
    return { status: 401, body: { error: 'unauthorized' } };
  }

  if (sessionOutcome.session.user.role !== 'admin') {
    return { status: 403, body: { error: 'forbidden' } };
  }
  const workspaceAccess = await deps
    .getIntelligenceUseCases()
    .getWorkspaceConfig({
      currentUserId: sessionOutcome.session.user.id,
      workspaceId: data.workspaceId,
    });
  if (workspaceAccess.isError()) throw workspaceAccess.getError();
  const workspaceOutcome = workspaceAccess.get();
  if (workspaceOutcome.type === 'forbidden') {
    return { status: 403, body: { error: 'forbidden' } };
  }
  if (workspaceOutcome.type === 'workspace_not_found') {
    return { status: 404, body: { error: 'workspace_not_found' } };
  }
  return { actorId: sessionOutcome.session.user.id };
}

export function createLocalAiStreamHandler(deps: LocalAiStreamHandlerDeps) {
  return async function handleLocalAiStreamRequest(
    request: Request
  ): Promise<Response> {
    if (!deps.isDev()) {
      return jsonResponse({ error: 'not_found' }, 404);
    }

    let parsed: LocalAiRequest;
    try {
      parsed = zLocalAiRequest.parse(await request.json());
    } catch (error) {
      return jsonResponse(
        {
          error: 'invalid_request',
          details: error instanceof z.ZodError ? error.issues : undefined,
        },
        400
      );
    }

    let actorId: string;
    try {
      const access = await authenticateAndAuthorize(deps, request, parsed);
      if ('status' in access) return jsonResponse(access.body, access.status);
      actorId = access.actorId;
    } catch (error) {
      return jsonResponse(
        { error: error instanceof Error ? error.message : 'auth_failed' },
        500
      );
    }

    const config = deps.getConfig();
    const provider = parsed.provider ?? config.provider;
    const model = parsed.model ?? config.model;
    const runId = randomUUID();
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    let consumerGone = false;
    let streamClosed = false;
    const timeoutId = globalThis.setTimeout(() => {
      abortController.abort(createLocalAiAbortError('Local AI run timed out'));
    }, config.timeoutMs);
    const abortFromRequest = () => {
      consumerGone = true;
      abortController.abort(
        createLocalAiAbortError('Local AI request disconnected')
      );
    };
    if (request.signal.aborted) {
      abortFromRequest();
    } else {
      request.signal.addEventListener('abort', abortFromRequest, {
        once: true,
      });
    }
    const cleanup = () => {
      globalThis.clearTimeout(timeoutId);
      request.signal.removeEventListener('abort', abortFromRequest);
    };

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const emit = (event: LocalAiNdjsonEvent) => {
          if (consumerGone || streamClosed) return;
          try {
            controller.enqueue(encoder.encode(`${JSON.stringify(event)}\n`));
          } catch {
            consumerGone = true;
            abortController.abort(
              createLocalAiAbortError('Local AI stream closed')
            );
          }
        };

        void (async () => {
          emit({
            type: 'start',
            runId,
            action: parsed.action,
            provider,
            model,
            at: nowIso(),
          });

          try {
            const result = await runAction(deps, {
              data: parsed,
              actorId,
              runId,
              provider,
              model,
              rawOutputDir: config.rawOutputDir,
              ollamaBaseUrl: config.ollamaBaseUrl,
              ollamaNumCtx: config.ollamaNumCtx,
              abortSignal: abortController.signal,
              emit,
            });
            emit({
              type: 'done',
              runId,
              action: parsed.action,
              at: nowIso(),
              data: { result: toJsonValue(result) },
            });
          } catch (error) {
            emit({
              type: 'error',
              runId,
              action: parsed.action,
              message:
                error instanceof Error ? error.message : 'Local AI run failed',
              at: nowIso(),
              data:
                error instanceof AppError
                  ? {
                      code: error.code,
                      details: toJsonValue(error.details),
                    }
                  : undefined,
            });
          } finally {
            cleanup();
            if (!consumerGone && !streamClosed) {
              streamClosed = true;
              controller.close();
            }
          }
        })();
      },
      cancel() {
        consumerGone = true;
        abortController.abort(
          createLocalAiAbortError('Local AI stream cancelled')
        );
      },
    });

    return new Response(stream, {
      headers: {
        'content-type': 'application/x-ndjson',
        'cache-control': 'no-store',
      },
    });
  };
}
