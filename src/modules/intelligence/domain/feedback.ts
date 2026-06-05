import type {
  FeedbackEventId,
  SourceRecordId,
  UserId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';
import type { JsonObject } from '@/modules/kernel/domain/json';

export const FEEDBACK_EVENT_TYPES = [
  'useful',
  'not_useful',
  'more_like_this',
  'less_like_this',
  'flag_bad_synthesis',
  'open_source',
  'copy_excerpt',
  'add_competitor_to_watchlist',
] as const;

export type FeedbackEventType = (typeof FEEDBACK_EVENT_TYPES)[number];

export function isFeedbackEventType(value: string): value is FeedbackEventType {
  return (FEEDBACK_EVENT_TYPES as readonly string[]).includes(value);
}

/**
 * Feedback is append-only and never affects ranking/regeneration/prompts.
 * The sole exception is `add_competitor_to_watchlist`, which transitions a
 * suggested competitor to `accepted`.
 */
export function feedbackMutatesState(eventType: FeedbackEventType): boolean {
  return eventType === 'add_competitor_to_watchlist';
}

export type FeedbackEvent = {
  id: FeedbackEventId;
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId | null;
  userId: UserId | null;
  eventType: FeedbackEventType;
  targetType: string | null;
  targetId: string | null;
  sourceRecordId: SourceRecordId | null;
  payload: JsonObject | null;
  createdAt: Date;
};

export type FeedbackEventWriteInput = {
  workspaceId: WorkspaceId;
  reportId?: WeeklyReportId | null;
  userId?: UserId | null;
  eventType: FeedbackEventType;
  targetType?: string | null;
  targetId?: string | null;
  sourceRecordId?: SourceRecordId | null;
  payload?: JsonObject | null;
};
