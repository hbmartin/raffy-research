import {
  createIntelligenceUseCases,
  type FeedbackRepository,
  type IngestionRepository,
  type IntelligenceUseCases,
  type ReportRepository,
  type SourceRepository,
  type WorkspaceRepository,
} from '@/modules/intelligence';
import {
  createFeedbackRepository,
  createIngestionRepository,
  createReportRepository,
  createSourceRepository,
  createWorkspaceRepository,
} from '@/modules/intelligence/backend';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import { getKernel, type Kernel } from './kernel';
import { createCachedFactory } from './shared/singleton';

export type IntelligenceRepositories = {
  workspaceRepository: WorkspaceRepository;
  sourceRepository: SourceRepository;
  reportRepository: ReportRepository;
  feedbackRepository: FeedbackRepository;
  ingestionRepository: IngestionRepository;
};

export type IntelligenceOverrides = {
  kernel?: Kernel;
} & Partial<IntelligenceRepositories>;

const buildRepositories = (
  db: DbLike,
  overrides?: Partial<IntelligenceRepositories>
): IntelligenceRepositories => ({
  workspaceRepository:
    overrides?.workspaceRepository ?? createWorkspaceRepository({ db }),
  sourceRepository:
    overrides?.sourceRepository ?? createSourceRepository({ db }),
  reportRepository:
    overrides?.reportRepository ?? createReportRepository({ db }),
  feedbackRepository:
    overrides?.feedbackRepository ?? createFeedbackRepository({ db }),
  ingestionRepository:
    overrides?.ingestionRepository ?? createIngestionRepository({ db }),
});

const buildIntelligenceUseCases = (
  overrides?: IntelligenceOverrides
): IntelligenceUseCases => {
  const kernel = overrides?.kernel ?? getKernel();
  const repositories = buildRepositories(kernel.db, overrides);
  return createIntelligenceUseCases({
    ...repositories,
    permissionChecker: kernel.permissionChecker,
    idGenerator: kernel.idGenerator,
    clock: kernel.clock,
    logger: kernel.logger,
  });
};

const useCaseFactory = createCachedFactory<
  IntelligenceUseCases,
  IntelligenceOverrides
>(buildIntelligenceUseCases);

export const getIntelligenceUseCases = (
  overrides?: IntelligenceOverrides
): IntelligenceUseCases => useCaseFactory.get(overrides);

/** Repository access for backend ingestion/generation jobs running outside the use-case façade. */
export const getIntelligenceRepositories = (
  overrides?: IntelligenceOverrides
): IntelligenceRepositories => {
  const kernel = overrides?.kernel ?? getKernel();
  return buildRepositories(kernel.db, overrides);
};

/** Test-only. */
export const __resetIntelligenceComposition = () => useCaseFactory.reset();
