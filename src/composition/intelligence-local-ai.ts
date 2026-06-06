import { Result } from '@swan-io/boxed';

import { getAuthUseCases } from '@/composition/auth';
import {
  getIntelligenceRepositories,
  getIntelligenceUseCases,
} from '@/composition/intelligence';
import { getKernel } from '@/composition/kernel';
import {
  type AlertPort,
  type IngestionDeps,
  type WeeklyReportGenerationDeps,
} from '@/modules/intelligence';
import {
  createLocalAiReportGenerator,
  createLocalAiStreamHandler,
  createProviderRegistry,
  generateLocalText,
  getLocalAiConfig,
  getProviderCredential,
  type LocalAiStreamHandlerDeps,
} from '@/modules/intelligence/backend';
import { envClient } from '@/platform/env/client';

const providerRegistry = createProviderRegistry();

const noOpAlert: AlertPort = {
  async sendAlert() {
    return Result.Ok({ type: 'alert_skipped' });
  },
};

function buildIngestionDeps(): IngestionDeps {
  const kernel = getKernel();
  const repositories = getIntelligenceRepositories();
  return {
    workspaceRepository: repositories.workspaceRepository,
    sourceRepository: repositories.sourceRepository,
    ingestionRepository: repositories.ingestionRepository,
    registry: providerRegistry,
    credentialResolver: {
      resolve: getProviderCredential,
    },
    clock: kernel.clock,
    logger: kernel.logger,
  };
}

function buildGenerationDeps(
  input: Parameters<LocalAiStreamHandlerDeps['buildGenerationDeps']>[0]
): WeeklyReportGenerationDeps {
  const kernel = getKernel();
  const repositories = getIntelligenceRepositories();
  return {
    workspaceRepository: repositories.workspaceRepository,
    sourceRepository: repositories.sourceRepository,
    reportRepository: repositories.reportRepository,
    reportGenerator: createLocalAiReportGenerator({
      provider: input.provider,
      model: input.model,
      rawOutputDir: input.rawOutputDir,
      runId: input.runId,
      action: input.action,
      abortSignal: input.abortSignal,
      onEvent: input.emit,
    }),
    alert: noOpAlert,
    clock: kernel.clock,
    logger: kernel.logger,
  };
}

export const handleLocalAiStreamRequest = createLocalAiStreamHandler({
  isDev: () => envClient.DEV,
  getConfig: getLocalAiConfig,
  getAuthUseCases,
  getIntelligenceUseCases,
  getRepositories: getIntelligenceRepositories,
  buildIngestionDeps,
  buildGenerationDeps,
  generateLocalText,
});
