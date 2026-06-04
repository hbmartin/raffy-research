import type { IdGenerator, Logger } from '@/modules/kernel';

import type { IntelligenceRepository } from './application/ports/intelligence-repository';
import type { ProviderAdapter } from './application/ports/provider-adapter';
import type { ReportGenerator } from './application/ports/report-generator';
import {
  createGenerateWeeklyReportsUseCase,
  type WeeklyReportGenerationSummary,
} from './application/use-cases/generate-weekly-reports';
import { createGetLatestReportUseCase } from './application/use-cases/get-latest-report';
import {
  createRunDailyIngestionUseCase,
  type DailyIngestionSummary,
} from './application/use-cases/run-daily-ingestion';
import type { ProviderName } from './domain/intelligence';
import type { IntelligenceRuntimeConfig } from './infrastructure/config/intelligence-env';

export type IntelligenceUseCases = {
  generateWeeklyReports: () => Promise<WeeklyReportGenerationSummary>;
  getLatestReport: ReturnType<typeof createGetLatestReportUseCase>;
  runDailyIngestion: () => Promise<DailyIngestionSummary>;
  repository: IntelligenceRepository;
};

export function createIntelligenceUseCases(deps: {
  adapters: Record<ProviderName, ProviderAdapter>;
  clock: { now(): Date };
  fetch: typeof fetch;
  idGenerator: IdGenerator;
  intelligenceRepository: IntelligenceRepository;
  logger?: Pick<Logger, 'error' | 'info' | 'warn'>;
  reportGenerator: ReportGenerator;
  runtimeConfig: IntelligenceRuntimeConfig;
}): IntelligenceUseCases {
  return {
    generateWeeklyReports: createGenerateWeeklyReportsUseCase({
      clock: deps.clock,
      fetch: deps.fetch,
      idGenerator: deps.idGenerator,
      logger: deps.logger,
      repository: deps.intelligenceRepository,
      reportGenerator: deps.reportGenerator,
      runtimeConfig: deps.runtimeConfig,
    }),
    getLatestReport: createGetLatestReportUseCase({
      repository: deps.intelligenceRepository,
    }),
    runDailyIngestion: createRunDailyIngestionUseCase({
      adapters: deps.adapters,
      clock: deps.clock,
      fetch: deps.fetch,
      idGenerator: deps.idGenerator,
      logger: deps.logger,
      repository: deps.intelligenceRepository,
      runtimeConfig: deps.runtimeConfig,
    }),
    repository: deps.intelligenceRepository,
  };
}
