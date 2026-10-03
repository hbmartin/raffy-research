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
  now?: Date;
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
    }
  | { type: 'workspace_not_found' };

/** Run every configured provider's daily ingestion for a single workspace. */
export async function runWorkspaceIngest(
  deps: IngestionDeps,
  input: RunWorkspaceIngestInput
): Promise<ApplicationResult<RunWorkspaceIngestOutcome>> {
  const now = input.now ?? deps.clock.now();

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

  for (const config of providerConfigs.get()) {
    if (!config.enabled) continue;
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

    // Read before this run's own row exists, so a watermark is the previous
    // successful pull rather than this one.
    const window = await resolvePeriodStart(deps, {
      workspaceId: workspace.id,
      providerName: config.providerName,
      adapter,
      now,
    });
    if (window.isError()) return Result.Error(window.getError());
    const periodStart = window.get();
    const windowMetadata = {
      periodStart: periodStart.toISOString(),
      periodEnd: now.toISOString(),
    };

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

    const context: ProviderDailyContext = {
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

    const pulled = await pullProvider(deps, {
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

    const { ingest, sourceRecords, storedCopies } = pulled;
    const { searchResults } = ingest;
    const providerRequestsSucceeded = ingest.requestsSucceeded ?? 1;
    const providerRequestsFailed = ingest.requestsFailed ?? 0;
    requestsSucceeded += providerRequestsSucceeded;
    requestsFailed += providerRequestsFailed;
    let ingested = 0;
    let persistenceFailed = false;
    for (const record of sourceRecords) {
      const created = await deps.sourceRepository.createSourceRecord(record);
      if (created.isError()) {
        deps.logger.error({
          event: 'intelligence.ingestion.persistence_failed',
          details: {
            workspaceId: workspace.id,
            provider: config.providerName,
            runId,
            stage: 'source_record',
            errorCode: created.getError().code,
          },
        });
        persistenceFailed = true;
        break;
      }
      sourceRecordCount += 1;
      ingested += 1;
    }
    for (const searchResult of persistenceFailed ? [] : searchResults) {
      const created =
        await deps.sourceRepository.createSearchResult(searchResult);
      if (created.isError()) {
        deps.logger.error({
          event: 'intelligence.ingestion.persistence_failed',
          details: {
            workspaceId: workspace.id,
            provider: config.providerName,
            runId,
            stage: 'search_result',
            errorCode: created.getError().code,
          },
        });
        persistenceFailed = true;
        break;
      }
      searchResultCount += 1;
      ingested += 1;
    }

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
        storedCopiesSkipped: storedCopies,
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
  deps: IngestionDeps,
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
  const records = ingest.get().sourceRecords;
  if (!input.adapter.overlappingWindow) {
    return {
      type: 'pulled',
      ingest: ingest.get(),
      sourceRecords: records,
      storedCopies: 0,
    };
  }

  const excluded = await deps.sourceRepository.excludeStoredCopies({
    workspaceId: input.workspaceId,
    providerName: input.providerName,
    capturedSince: input.context.periodStart,
    records,
  });
  if (excluded.isError()) {
    deps.logger.error({
      event: 'intelligence.ingestion.persistence_failed',
      details: {
        workspaceId: input.workspaceId,
        provider: input.providerName,
        runId: input.runId,
        stage: 'stored_copies',
        errorCode: excluded.getError().code,
      },
    });
    return {
      type: 'pull_failed',
      failureReason: 'Stored copy lookup failed',
      requestsFailed: 0,
    };
  }
  return {
    type: 'pulled',
    ingest: ingest.get(),
    sourceRecords: excluded.get().fresh,
    storedCopies: excluded.get().storedCopies,
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
