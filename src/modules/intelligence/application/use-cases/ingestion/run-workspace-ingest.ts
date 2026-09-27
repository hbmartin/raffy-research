import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { WorkspaceId } from '@/modules/kernel/domain/ids';

import type { IngestionDeps } from './types';
import type { ProviderDailyContext } from '../../ports/provider-adapter';

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

function providerOutcomeStatus(input: {
  persistenceFailed: boolean;
  requestsFailed: number;
  requestsSucceeded: number;
  itemsIngested: number;
}): 'succeeded' | 'partial' | 'failed' {
  if (!input.persistenceFailed && input.requestsFailed === 0)
    return 'succeeded';
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

  const [keywords, competitors, social, notes, providerConfigs] =
    await Promise.all([
      deps.workspaceRepository.listKeywords(workspace.id, { activeOnly: true }),
      deps.workspaceRepository.listCompetitors(workspace.id),
      deps.workspaceRepository.listSocialAccounts(workspace.id),
      deps.workspaceRepository.listInternalNoteConfigs(workspace.id, {
        enabledOnly: true,
      }),
      deps.workspaceRepository.listProviderConfigs(workspace.id),
    ]);
  if (keywords.isError()) return Result.Error(keywords.getError());
  if (competitors.isError()) return Result.Error(competitors.getError());
  if (social.isError()) return Result.Error(social.getError());
  if (notes.isError()) return Result.Error(notes.getError());
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
      internalNoteConfigs: notes.get(),
      config,
      credential,
      now,
      periodStart: new Date(now.getTime() - DAILY_WINDOW_MS),
      logger: deps.logger,
    };

    const ingest = await adapter.runDailyIngest(context);
    if (ingest.isError()) {
      providersFailed += 1;
      requestsFailed += 1;
      const finished = await finishRun(deps, runId, {
        status: 'failed',
        failureReason: 'Provider ingestion failed',
        finishedAt: deps.clock.now(),
      });
      if (finished.isError()) return Result.Error(finished.getError());
      continue;
    }

    const { sourceRecords, searchResults } = ingest.get();
    const providerRequestsSucceeded = ingest.get().requestsSucceeded ?? 1;
    const providerRequestsFailed = ingest.get().requestsFailed ?? 0;
    requestsSucceeded += providerRequestsSucceeded;
    requestsFailed += providerRequestsFailed;
    let ingested = 0;
    let persistenceFailed = false;
    for (const record of sourceRecords) {
      const created = await deps.sourceRepository.createSourceRecord(record);
      if (created.isError()) {
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
