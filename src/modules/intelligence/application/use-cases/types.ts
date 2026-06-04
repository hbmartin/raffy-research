import type {
  Clock,
  IdGenerator,
  Logger,
  PermissionChecker,
} from '@/modules/kernel';

import type { FeedbackRepository } from '../ports/feedback-repository';
import type { IngestionRepository } from '../ports/ingestion-repository';
import type { ReportRepository } from '../ports/report-repository';
import type { SourceRepository } from '../ports/source-repository';
import type { WorkspaceRepository } from '../ports/workspace-repository';

export type IntelligenceUseCaseDeps = {
  workspaceRepository: WorkspaceRepository;
  sourceRepository: SourceRepository;
  reportRepository: ReportRepository;
  feedbackRepository: FeedbackRepository;
  ingestionRepository: IngestionRepository;
  permissionChecker: PermissionChecker;
  idGenerator: IdGenerator;
  clock: Clock;
  logger: Logger;
};

export type ForbiddenOutcome = { type: 'forbidden' };
