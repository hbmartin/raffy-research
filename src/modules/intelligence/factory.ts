import type { IntelligenceRepository } from './application/ports/intelligence-repository';
import { createGetLatestReportUseCase } from './application/use-cases/get-latest-report';

export type IntelligenceUseCases = {
  getLatestReport: ReturnType<typeof createGetLatestReportUseCase>;
  repository: IntelligenceRepository;
};

export function createIntelligenceUseCases(deps: {
  intelligenceRepository: IntelligenceRepository;
}): IntelligenceUseCases {
  return {
    getLatestReport: createGetLatestReportUseCase({
      repository: deps.intelligenceRepository,
    }),
    repository: deps.intelligenceRepository,
  };
}
