import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type {
  UserId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import { reportBelongsToWorkspace } from './workspace-ownership';
import type { RubricScoreGetOutcome } from '../ports/rubric-score-repository';
import type { ReportRubricScore } from '../../domain/rubric';
import { isRubricScoreValue, RUBRIC_DIMENSIONS } from '../../domain/rubric';

export type ScoreReportInput = {
  currentUserId: UserId;
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId;
  relevance: number;
  accuracy: number;
  novelty: number;
  note?: string | null;
};

export type ScoreReportOutcome = {
  type: 'report_scored';
  score: ReportRubricScore;
};

/**
 * Upserts the analyst's rubric judgment for a report. One score per
 * report+user; re-scoring replaces the prior judgment.
 */
export async function scoreReport(
  deps: IntelligenceUseCaseDeps,
  input: ScoreReportInput
): Promise<ApplicationResult<ScoreReportOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    report: ['score'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const invalidDimension = RUBRIC_DIMENSIONS.find(
    (dimension) => !isRubricScoreValue(input[dimension])
  );
  if (invalidDimension) {
    return Result.Error(
      new AppError({
        code: 'RUBRIC_SCORE_INVALID',
        category: 'bad_request',
        status: 400,
        message: `Rubric ${invalidDimension} must be an integer from 1 to 5`,
      })
    );
  }

  const matchesWorkspace = await reportBelongsToWorkspace(
    deps,
    input.reportId,
    input.workspaceId
  );
  if (matchesWorkspace.isError())
    return Result.Error(matchesWorkspace.getError());
  if (matchesWorkspace.get().type === 'not_in_workspace') {
    return Result.Ok({ type: 'forbidden' });
  }

  const upserted = await deps.rubricScoreRepository.upsert({
    workspaceId: input.workspaceId,
    reportId: input.reportId,
    userId: input.currentUserId,
    relevance: input.relevance,
    accuracy: input.accuracy,
    novelty: input.novelty,
    note: input.note ?? null,
  });
  if (upserted.isError()) return Result.Error(upserted.getError());

  return Result.Ok({ type: 'report_scored', score: upserted.get() });
}

export type GetReportRubricScoreInput = {
  currentUserId: UserId;
  reportId: WeeklyReportId;
};

export async function getReportRubricScore(
  deps: IntelligenceUseCaseDeps,
  input: GetReportRubricScoreInput
): Promise<ApplicationResult<RubricScoreGetOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    report: ['read'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  return deps.rubricScoreRepository.getForReportAndUser(
    input.reportId,
    input.currentUserId
  );
}
