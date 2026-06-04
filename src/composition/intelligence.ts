import {
  createIntelligenceUseCases,
  type IntelligenceRepository,
} from '@/modules/intelligence';
import type { ReportGenerator } from '@/modules/intelligence/application/ports/report-generator';
import { getIntelligenceRuntimeConfig } from '@/modules/intelligence/infrastructure/config/intelligence-env';
import { createIntelligenceRepository } from '@/modules/intelligence/infrastructure/drizzle/intelligence-repository-drizzle';
import { OpenAiReportGenerator } from '@/modules/intelligence/infrastructure/openai/openai-report-generator';
import { providerAdapters } from '@/modules/intelligence/infrastructure/providers/provider-registry';
import { ConfigurationError } from '@/modules/kernel';

import { getKernel, type Kernel } from './kernel';
import { createCachedFactory } from './shared/singleton';

export type IntelligenceOverrides = {
  kernel?: Kernel;
  intelligenceRepository?: IntelligenceRepository;
  reportGenerator?: ReportGenerator;
};

const missingOpenAiReportGenerator: ReportGenerator = {
  async generate() {
    throw new ConfigurationError(
      'OPENAI_API_KEY is required to generate intelligence reports.'
    );
  },
};

const buildIntelligenceUseCases = (overrides?: IntelligenceOverrides) => {
  const kernel = overrides?.kernel ?? getKernel();
  const runtimeConfig = getIntelligenceRuntimeConfig();
  const reportGenerator =
    overrides?.reportGenerator ??
    (runtimeConfig.openAiApiKey
      ? new OpenAiReportGenerator({
          apiKey: runtimeConfig.openAiApiKey,
          model: runtimeConfig.openAiModel,
        })
      : missingOpenAiReportGenerator);

  return createIntelligenceUseCases({
    adapters: providerAdapters,
    clock: kernel.clock,
    fetch,
    idGenerator: kernel.idGenerator,
    intelligenceRepository:
      overrides?.intelligenceRepository ??
      createIntelligenceRepository({ db: kernel.db }),
    logger: kernel.logger,
    reportGenerator,
    runtimeConfig,
  });
};

const factory = createCachedFactory(buildIntelligenceUseCases);

export const getIntelligenceUseCases = (overrides?: IntelligenceOverrides) =>
  factory.get(overrides);

export { getIntelligenceRuntimeConfig };

export const getIntelligenceProviderAdapter = (providerName: string) =>
  providerAdapters[providerName as keyof typeof providerAdapters];

/** Test-only. */
export const __resetIntelligenceComposition = () => factory.reset();
