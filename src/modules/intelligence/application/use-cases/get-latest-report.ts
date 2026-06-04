import type { WeeklyReport } from '@/modules/kernel/infrastructure/db/schema';

import type { IntelligenceRepository } from '../ports/intelligence-repository';

export function createGetLatestReportUseCase(deps: {
  repository: IntelligenceRepository;
}) {
  return async (workspaceId: string): Promise<WeeklyReport | null> =>
    deps.repository.getLatestPublishedReport(workspaceId);
}
