import type { IdGenerator, Logger } from '@/modules/kernel';

import type { IntelligenceRepository } from '../ports/intelligence-repository';
import type { ProviderAdapter } from '../ports/provider-adapter';
import type { ProviderName } from '../../domain/intelligence';
import {
  defaultProviderCredentialRefs,
  type IntelligenceRuntimeConfig,
} from '../../infrastructure/config/intelligence-env';

export type DailyIngestionSummary = {
  providersCompleted: number;
  providersFailed: number;
  providersSkipped: number;
  sourcesInserted: number;
  searchResultsInserted: number;
  workspacesProcessed: number;
};

type RunDailyIngestionDeps = {
  adapters: Record<ProviderName, ProviderAdapter>;
  clock: { now(): Date };
  fetch: typeof fetch;
  idGenerator: IdGenerator;
  logger?: Pick<Logger, 'error' | 'info' | 'warn'>;
  repository: IntelligenceRepository;
  runtimeConfig: IntelligenceRuntimeConfig;
};

export function createRunDailyIngestionUseCase(deps: RunDailyIngestionDeps) {
  return async (): Promise<DailyIngestionSummary> => {
    const summary: DailyIngestionSummary = {
      providersCompleted: 0,
      providersFailed: 0,
      providersSkipped: 0,
      sourcesInserted: 0,
      searchResultsInserted: 0,
      workspacesProcessed: 0,
    };
    const workspaces = await deps.repository.listWorkspaces();

    for (const workspace of workspaces) {
      summary.workspacesProcessed += 1;
      const providerConfigs = await deps.repository.listEnabledProviderConfigs(
        workspace.id
      );

      for (const providerConfig of providerConfigs) {
        const providerName = providerConfig.providerName as ProviderName;
        const adapter = deps.adapters[providerName];
        if (!adapter) continue;

        const startedAt = deps.clock.now();
        const credentialRef =
          providerConfig.credentialsRef ??
          defaultProviderCredentialRefs[providerName];
        const credential = credentialRef
          ? deps.runtimeConfig.providerCredentials[credentialRef]
          : undefined;

        try {
          const result = await adapter.ingest({
            credential,
            fetch: deps.fetch,
            now: startedAt,
            providerConfig,
            workspace,
          });

          for (const source of result.sourceRecords) {
            await deps.repository.insertSourceRecord({
              ...source,
              id: deps.idGenerator.createId(),
              workspaceId: workspace.id,
              providerName,
              capturedAt: startedAt,
            });
            summary.sourcesInserted += 1;
          }

          for (const searchResult of result.searchResults) {
            await deps.repository.insertSearchResult({
              ...searchResult,
              id: deps.idGenerator.createId(),
              workspaceId: workspace.id,
              providerName,
              returnedAt: searchResult.returnedAt ?? startedAt,
            });
            summary.searchResultsInserted += 1;
          }

          if (result.status === 'skipped') {
            summary.providersSkipped += 1;
          } else {
            summary.providersCompleted += 1;
          }

          await deps.repository.insertIngestionRun({
            id: deps.idGenerator.createId(),
            workspaceId: workspace.id,
            providerName,
            runType: 'daily_ingest',
            status: result.status,
            startedAt,
            finishedAt: deps.clock.now(),
            failureReason: result.reason,
            metadata: result.metadata ?? {},
          });
        } catch (error) {
          summary.providersFailed += 1;
          const message = error instanceof Error ? error.message : 'unknown';
          deps.logger?.error({
            event: 'intelligence.provider_ingestion_failed',
            exception: error,
            details: {
              providerName,
              workspaceId: workspace.id,
            },
          });
          await deps.repository.insertIngestionRun({
            id: deps.idGenerator.createId(),
            workspaceId: workspace.id,
            providerName,
            runType: 'daily_ingest',
            status: 'failed',
            startedAt,
            finishedAt: deps.clock.now(),
            failureReason: message,
          });
        }
      }
    }

    deps.logger?.info({
      event: 'intelligence.daily_ingestion_completed',
      details: summary,
    });
    return summary;
  };
}
