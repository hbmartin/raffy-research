import {
  createIntelligenceUseCases,
  type IntelligenceRepository,
} from '@/modules/intelligence';
import { createIntelligenceRepository } from '@/modules/intelligence/infrastructure/drizzle/intelligence-repository-drizzle';

import { getKernel, type Kernel } from './kernel';
import { createCachedFactory } from './shared/singleton';

export type IntelligenceOverrides = {
  kernel?: Kernel;
  intelligenceRepository?: IntelligenceRepository;
};

const buildIntelligenceUseCases = (overrides?: IntelligenceOverrides) => {
  const kernel = overrides?.kernel ?? getKernel();
  return createIntelligenceUseCases({
    intelligenceRepository:
      overrides?.intelligenceRepository ??
      createIntelligenceRepository({ db: kernel.db }),
  });
};

const factory = createCachedFactory(buildIntelligenceUseCases);

export const getIntelligenceUseCases = (overrides?: IntelligenceOverrides) =>
  factory.get(overrides);

/** Test-only. */
export const __resetIntelligenceComposition = () => factory.reset();
