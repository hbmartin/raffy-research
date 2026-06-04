import type { IntelligenceRepository } from '../../application/ports/intelligence-repository';

export type IntelligenceHttpHandlers = {
  repository: IntelligenceRepository;
};

export function createIntelligenceHttpHandlers(
  handlers: IntelligenceHttpHandlers
): IntelligenceHttpHandlers {
  return handlers;
}
