import { Result } from '@swan-io/boxed';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type {
  SourceRecordId,
  UserId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import { zCompetitorId } from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';

import { isAllowed } from './permission';
import type { ForbiddenOutcome, IntelligenceUseCaseDeps } from './types';
import type { FeedbackEvent, FeedbackEventType } from '../../domain/feedback';
import { feedbackMutatesState } from '../../domain/feedback';

export type RecordFeedbackInput = {
  currentUserId: UserId;
  workspaceId: WorkspaceId;
  eventType: FeedbackEventType;
  reportId?: WeeklyReportId | null;
  targetType?: string | null;
  targetId?: string | null;
  sourceRecordId?: SourceRecordId | null;
  payload?: JsonObject | null;
};

export type RecordFeedbackOutcome =
  | {
      type: 'feedback_recorded';
      event: FeedbackEvent;
      competitorAccepted: boolean;
    }
  | { type: 'competitor_not_found'; event: FeedbackEvent };

/**
 * Append-only feedback. The only side effect is `add_competitor_to_watchlist`,
 * which transitions the targeted suggested competitor to `accepted`.
 */
export async function recordFeedback(
  deps: IntelligenceUseCaseDeps,
  input: RecordFeedbackInput
): Promise<ApplicationResult<RecordFeedbackOutcome | ForbiddenOutcome>> {
  const allowed = await isAllowed(deps.permissionChecker, input.currentUserId, {
    feedback: ['create'],
  });
  if (allowed.isError()) return Result.Error(allowed.getError());
  if (!allowed.get()) return Result.Ok({ type: 'forbidden' });

  const created = await deps.feedbackRepository.create({
    workspaceId: input.workspaceId,
    reportId: input.reportId ?? null,
    userId: input.currentUserId,
    eventType: input.eventType,
    targetType: input.targetType ?? null,
    targetId: input.targetId ?? null,
    sourceRecordId: input.sourceRecordId ?? null,
    payload: input.payload ?? null,
  });
  if (created.isError()) return Result.Error(created.getError());
  const event = created.get();

  if (!feedbackMutatesState(input.eventType) || !input.targetId) {
    return Result.Ok({
      type: 'feedback_recorded',
      event,
      competitorAccepted: false,
    });
  }

  const parsedCompetitorId = zCompetitorId().safeParse(input.targetId);
  if (!parsedCompetitorId.success) {
    return Result.Ok({ type: 'competitor_not_found', event });
  }

  const updated = await deps.workspaceRepository.setCompetitorState(
    input.workspaceId,
    parsedCompetitorId.data,
    'accepted'
  );
  if (updated.isError()) return Result.Error(updated.getError());

  if (updated.get().type === 'competitor_not_found') {
    return Result.Ok({ type: 'competitor_not_found', event });
  }

  deps.logger.info({
    event: 'intelligence.competitor.accepted',
    details: { competitorId: parsedCompetitorId.data },
  });
  return Result.Ok({
    type: 'feedback_recorded',
    event,
    competitorAccepted: true,
  });
}
