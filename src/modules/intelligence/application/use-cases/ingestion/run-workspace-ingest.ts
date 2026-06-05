import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { WorkspaceId } from '@/modules/kernel/domain/ids';

import type { IngestionDeps } from './types';
import type { ProviderDailyContext } from '../../ports/provider-adapter';

const DAILY_WINDOW_MS = 24 * 60 * 60 * 1000;

export type RunWorkspaceIngestInput = {
  workspaceId: WorkspaceId;
  now?: Date;
};

export type RunWorkspaceIngestOutcome =
  | {
      type: 'workspace_ingested';
      providersRun: number;
      providersSkipped: number;
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
      const finished = await finishRun(deps, runId, {
        status: 'failed',
        failureReason: ingest.getError().message,
        finishedAt: deps.clock.now(),
      });
      if (finished.isError()) return Result.Error(finished.getError());
      continue;
    }

    const { sourceRecords, searchResults } = ingest.get();
    let ingested = 0;
    for (const record of sourceRecords) {
      const created = await deps.sourceRepository.createSourceRecord(record);
      if (created.isError()) {
        const finished = await finishRun(deps, runId, {
          status: 'failed',
          failureReason: created.getError().message,
          finishedAt: deps.clock.now(),
        });
        if (finished.isError()) return Result.Error(finished.getError());
        return Result.Error(created.getError());
      }
      sourceRecordCount += 1;
      ingested += 1;
    }
    for (const searchResult of searchResults) {
      const created =
        await deps.sourceRepository.createSearchResult(searchResult);
      if (created.isError()) {
        const finished = await finishRun(deps, runId, {
          status: 'failed',
          failureReason: created.getError().message,
          finishedAt: deps.clock.now(),
        });
        if (finished.isError()) return Result.Error(finished.getError());
        return Result.Error(created.getError());
      }
      searchResultCount += 1;
      ingested += 1;
    }

    const finished = await finishRun(deps, runId, {
      status: 'succeeded',
      itemsIngested: ingested,
      finishedAt: deps.clock.now(),
    });
    if (finished.isError()) return Result.Error(finished.getError());
    providersRun += 1;
  }

  return Result.Ok({
    type: 'workspace_ingested',
    providersRun,
    providersSkipped,
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
