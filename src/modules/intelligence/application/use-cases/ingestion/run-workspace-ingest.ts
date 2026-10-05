import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { WorkspaceId } from '@/modules/kernel/domain/ids';

import type { IngestionDeps } from './types';
import {
  type IngestionRun,
  resolveIngestWindowStart,
} from '../../../domain/ingestion';
import type { SourceRecordWriteInput } from '../../../domain/source';
import type {
  NormalizedIngest,
  ProviderAdapter,
  ProviderDailyContext,
} from '../../ports/provider-adapter';

function providerOutcomeStatus(input: {
  persistenceFailed: boolean;
  requestsFailed: number;
  requestsSucceeded: number;
  itemsIngested: number;
}): 'succeeded' | 'partial' | 'failed' {
  if (!input.persistenceFailed && input.requestsFailed === 0)
    return 'succeeded';
  if (input.persistenceFailed)
    return input.itemsIngested > 0 ? 'partial' : 'failed';
  return input.itemsIngested > 0 || input.requestsSucceeded > 0
    ? 'partial'
    : 'failed';
}

export type RunWorkspaceIngestInput = {
  workspaceId: WorkspaceId;
  /** Legacy callers may supply coverage dates; fetching always uses the clock. */
  now?: Date;
  executionTime?: Date;
  providerNames?: string[];
  signal?: AbortSignal;
  scheduledJobRunId?: string;
};

export type RunWorkspaceIngestOutcome =
  | {
      type: 'workspace_ingested';
      providersRun: number;
      providersSkipped: number;
      providersPartial: number;
      providersFailed: number;
      requestsSucceeded: number;
      requestsFailed: number;
      sourceRecords: number;
      searchResults: number;
      reusedCaptures: number;
      observations: number;
    }
  | { type: 'workspace_not_found' };

/** Run every configured provider's daily ingestion for a single workspace. */
export async function runWorkspaceIngest(
  deps: IngestionDeps,
  input: RunWorkspaceIngestInput
): Promise<ApplicationResult<RunWorkspaceIngestOutcome>> {
  const workspaceResult = await deps.workspaceRepository.getById(
    input.workspaceId
  );
  if (workspaceResult.isError())
    return Result.Error(workspaceResult.getError());
  const workspaceOutcome = workspaceResult.get();
  if (workspaceOutcome.type === 'workspace_not_found') {
    return Result.Ok({ type: 'workspace_not_found' });
  }
  const workspace = workspaceOutcome.workspace;

  const [keywords, competitors, social, providerConfigs] = await Promise.all([
    deps.workspaceRepository.listKeywords(workspace.id, { activeOnly: true }),
    deps.workspaceRepository.listCompetitors(workspace.id),
    deps.workspaceRepository.listSocialAccounts(workspace.id),
    deps.workspaceRepository.listProviderConfigs(workspace.id),
  ]);
  if (keywords.isError()) return Result.Error(keywords.getError());
  if (competitors.isError()) return Result.Error(competitors.getError());
  if (social.isError()) return Result.Error(social.getError());
  if (providerConfigs.isError())
    return Result.Error(providerConfigs.getError());

  let providersRun = 0;
  let providersSkipped = 0;
  let providersPartial = 0;
  let providersFailed = 0;
  let requestsSucceeded = 0;
  let requestsFailed = 0;
  let sourceRecordCount = 0;
  let searchResultCount = 0;
  let reusedCaptureCount = 0;
  let observationCount = 0;

  for (const config of providerConfigs.get()) {
    const now = input.executionTime ?? deps.clock.now();
    if (
      !config.enabled ||
      (input.providerNames &&
        !input.providerNames.includes(config.providerName))
    )
      continue;
    if (input.signal?.aborted)
      return Result.Error(
        new AppError({
          code: 'INGESTION_CANCELLED',
          category: 'conflict',
          status: 409,
        })
      );
    const adapter = deps.registry.get(config.providerName);
    if (!adapter?.runDailyIngest) continue;

    const credential = deps.credentialResolver.resolve(config.credentialsRef);
    if (!adapter.isConfigured({ config, credential })) {
      const skipped = await deps.ingestionRepository.startRun({
        workspaceId: workspace.id,
        scheduledJobRunId: input.scheduledJobRunId,
        providerName: config.providerName,
        runType: 'daily',
        status: 'skipped',
        finishedAt: now,
      });
      if (skipped.isError()) return Result.Error(skipped.getError());
      providersSkipped += 1;
      continue;
    }

    const run = await deps.ingestionRepository.startRun({
      workspaceId: workspace.id,
      scheduledJobRunId: input.scheduledJobRunId,
      providerName: config.providerName,
      runType: 'daily',
      status: 'started',
      startedAt: now,
    });
    if (run.isError()) return Result.Error(run.getError());
    const runId = run.get().id;
    // The lookup excludes started runs. Its own failure now has a durable record.
    const window = await resolvePeriodStart(deps, {
      workspaceId: workspace.id,
      providerName: config.providerName,
      adapter,
      now,
    });
    if (window.isError()) {
      const finished = await finishRun(deps, runId, {
        status: 'failed',
        failureReason: 'Provider watermark lookup failed',
        metadata: { stage: 'watermark', errorCode: window.getError().code },
        finishedAt: deps.clock.now(),
      });
      if (finished.isError()) return Result.Error(finished.getError());
      providersFailed++;
      continue;
    }
    const periodStart = window.get();
    const windowMetadata = {
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
    };

    const context: ProviderDailyContext = {
      signal: input.signal,
      workspace,
      keywords: keywords.get(),
      competitors: competitors.get(),
      socialAccounts: social.get(),
      config,
      credential,
      now,
      periodStart,
      logger: deps.logger,
    };

    const pulled = await pullProvider({
      workspaceId: workspace.id,
      providerName: config.providerName,
      adapter,
      context,
      runId,
    });
    if (pulled.type === 'pull_failed') {
      providersFailed += 1;
      requestsFailed += pulled.requestsFailed;
      const finished = await finishRun(deps, runId, {
        status: 'failed',
        failureReason: pulled.failureReason,
        metadata: windowMetadata,
        finishedAt: deps.clock.now(),
      });
      if (finished.isError()) return Result.Error(finished.getError());
      continue;
    }

    const { ingest, sourceRecords } = pulled;
    const providerRequestsSucceeded = ingest.requestsSucceeded ?? 1;
    const providerRequestsFailed = ingest.requestsFailed ?? 0;
    requestsSucceeded += providerRequestsSucceeded;
    requestsFailed += providerRequestsFailed;
    const persisted = await deps.sourceRepository.createCallbackArtifacts({
      sourceRecords,
      searchResults: ingest.searchResults,
      observation: { kind: 'pull', runId, observedAt: now },
    });
    const persistenceFailed = persisted.isError();
    const counts = persisted.isOk()
      ? persisted.get()
      : {
          createdCaptures: 0,
          reusedCaptures: 0,
          observations: 0,
          searchResults: [],
        };
    const ingested = counts.createdCaptures;
    sourceRecordCount += counts.createdCaptures;
    reusedCaptureCount += counts.reusedCaptures;
    observationCount += counts.observations;
    searchResultCount += counts.searchResults.length;
    if (persisted.isError())
      deps.logger.error({
        event: 'intelligence.ingestion.persistence_failed',
        details: {
          workspaceId: workspace.id,
          provider: config.providerName,
          runId,
          stage: 'capture_batch',
          errorCode: persisted.getError().code,
        },
      });

    const providerStatus = providerOutcomeStatus({
      persistenceFailed,
      requestsFailed: providerRequestsFailed,
      requestsSucceeded: providerRequestsSucceeded,
      itemsIngested: ingested,
    });
    const finished = await finishRun(deps, runId, {
      status: providerStatus,
      itemsIngested: ingested,
      failureReason: persistenceFailed
        ? 'Source persistence failed'
        : providerRequestsFailed > 0
          ? 'Provider requests failed'
          : null,
      metadata: {
        ...windowMetadata,
        createdCaptures: counts.createdCaptures,
        reusedCaptures: counts.reusedCaptures,
        observations: counts.observations,
        searchResults: counts.searchResults.length,
        requestsSucceeded: providerRequestsSucceeded,
        requestsFailed: providerRequestsFailed,
      },
      finishedAt: deps.clock.now(),
    });
    if (finished.isError()) return Result.Error(finished.getError());
    if (providerStatus === 'partial') providersPartial += 1;
    else if (providerStatus === 'failed') providersFailed += 1;
    else providersRun += 1;
  }

  return Result.Ok({
    type: 'workspace_ingested',
    providersRun,
    providersSkipped,
    providersPartial,
    providersFailed,
    requestsSucceeded,
    requestsFailed,
    sourceRecords: sourceRecordCount,
    searchResults: searchResultCount,
    reusedCaptures: reusedCaptureCount,
    observations: observationCount,
  });
}

type WindowInput = {
  workspaceId: WorkspaceId;
  providerName: string;
  adapter: ProviderAdapter;
};

/**
 * Where this pull's window starts. Two strategies; docs/ingestion-window.md
 * explains both with examples.
 */
async function resolvePeriodStart(
  deps: IngestionDeps,
  input: WindowInput & { now: Date }
): Promise<ApplicationResult<Date>> {
  if (input.adapter.overlappingWindow) {
    return Result.Ok(
      new Date(input.now.getTime() - input.adapter.overlappingWindow.lookbackMs)
    );
  }
  // Only `succeeded` advances the watermark: after a partial or failed pull
  // the next run re-covers the window rather than leaving a gap.
  const lastSuccessfulRun =
    await deps.ingestionRepository.getLastSuccessfulDailyRun({
      workspaceId: input.workspaceId,
      providerName: input.providerName,
    });
  if (lastSuccessfulRun.isError())
    return Result.Error(lastSuccessfulRun.getError());
  return Result.Ok(
    resolveIngestWindowStart({
      now: input.now,
      lastSuccessfulRun: lastSuccessfulRun.get(),
    })
  );
}

type PullOutcome =
  | {
      type: 'pulled';
      ingest: NormalizedIngest;
      /** The records to write: all of them, or only the new ones. */
      sourceRecords: SourceRecordWriteInput[];
      storedCopies: number;
    }
  | { type: 'pull_failed'; failureReason: string; requestsFailed: number };

/**
 * Run the provider's pull and decide which records to write. An overlapping
 * window returns mostly what earlier pulls already stored, so only new pages
 * and new versions of known pages are kept.
 */
async function pullProvider(
  input: WindowInput & {
    context: ProviderDailyContext;
    runId: IngestionRun['id'];
  }
): Promise<PullOutcome> {
  const ingest = await input.adapter.runDailyIngest?.(input.context);
  if (!ingest || ingest.isError()) {
    return {
      type: 'pull_failed',
      failureReason: 'Provider ingestion failed',
      requestsFailed: 1,
    };
  }
  return {
    type: 'pulled',
    ingest: ingest.get(),
    sourceRecords: ingest.get().sourceRecords,
    storedCopies: 0,
  };
}

type FinishRunInput = Parameters<
  IngestionDeps['ingestionRepository']['finishRun']
>[1];

async function finishRun(
  deps: IngestionDeps,
  runId: Parameters<IngestionDeps['ingestionRepository']['finishRun']>[0],
  input: FinishRunInput
): Promise<ApplicationResult<undefined>> {
  const finished = await deps.ingestionRepository.finishRun(runId, input);
  if (finished.isError()) return Result.Error(finished.getError());
  if (finished.get().type === 'run_not_found') {
    return Result.Error(
      new AppError({
        code: 'INTELLIGENCE_INGESTION_RUN_MISSING',
        category: 'system',
        status: 500,
        message: 'Ingestion run vanished before finalization',
        details: { runId },
      })
    );
  }
  return Result.Ok(undefined);
}
