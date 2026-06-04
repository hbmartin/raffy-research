import { Result } from '@swan-io/boxed';

import {
  toFeedbackEventId,
  toSourceRecordId,
  toUserId,
  toWeeklyReportId,
  toWorkspaceId,
} from '@/modules/kernel/domain/ids';
import { observeRepository } from '@/modules/kernel/infrastructure/db/observability';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';

import {
  intelligenceInvariantError,
  mapIntelligenceDbError,
} from './map-db-error';
import { feedbackEvent as feedbackEventTable } from './schema';
import type { FeedbackRepository } from '../../application/ports/feedback-repository';
import type {
  FeedbackEvent,
  FeedbackEventType,
  FeedbackEventWriteInput,
} from '../../domain/feedback';

type FeedbackRow = typeof feedbackEventTable.$inferSelect;

const toFeedbackEvent = (row: FeedbackRow): FeedbackEvent => ({
  id: toFeedbackEventId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  reportId: row.reportId ? toWeeklyReportId(row.reportId) : null,
  userId: row.userId ? toUserId(row.userId) : null,
  eventType: row.eventType as FeedbackEventType,
  targetType: row.targetType,
  targetId: row.targetId,
  sourceRecordId: row.sourceRecordId
    ? toSourceRecordId(row.sourceRecordId)
    : null,
  payload: row.payload ?? null,
  createdAt: row.createdAt,
});

export class FeedbackRepositoryDrizzle implements FeedbackRepository {
  constructor(private readonly db: DbLike) {}

  async create(input: FeedbackEventWriteInput) {
    try {
      const [created] = await this.db
        .insert(feedbackEventTable)
        .values({
          workspaceId: input.workspaceId,
          reportId: input.reportId ?? null,
          userId: input.userId ?? null,
          eventType: input.eventType,
          targetType: input.targetType ?? null,
          targetId: input.targetId ?? null,
          sourceRecordId: input.sourceRecordId ?? null,
          payload: input.payload ?? null,
        })
        .returning();
      if (!created) {
        return Result.Error(
          intelligenceInvariantError(
            'FEEDBACK_CREATE_EMPTY',
            'feedback insert returned no row'
          )
        );
      }
      return Result.Ok(toFeedbackEvent(created));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'FEEDBACK_CREATE_ERROR')
      );
    }
  }
}

export function createFeedbackRepository(dependencies: {
  db: DbLike;
}): FeedbackRepository {
  return observeRepository(
    new FeedbackRepositoryDrizzle(dependencies.db),
    'intelligence.feedback'
  );
}
