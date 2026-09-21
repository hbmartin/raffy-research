import type {
  RubricScoreId,
  UserId,
  WeeklyReportId,
  WorkspaceId,
} from '@/modules/kernel/domain/ids';

export const RUBRIC_DIMENSIONS = ['relevance', 'accuracy', 'novelty'] as const;

export type RubricDimension = (typeof RUBRIC_DIMENSIONS)[number];

export const RUBRIC_SCORE_MIN = 1;
export const RUBRIC_SCORE_MAX = 5;

export const RUBRIC_NOTE_MAX_LENGTH = 2000;

export function isRubricScoreValue(value: number): boolean {
  return (
    Number.isInteger(value) &&
    value >= RUBRIC_SCORE_MIN &&
    value <= RUBRIC_SCORE_MAX
  );
}

export function isRubricNoteValue(note: string | null | undefined): boolean {
  return note == null || note.length <= RUBRIC_NOTE_MAX_LENGTH;
}

/**
 * One analyst judgment of a published report. Upserted per report+user so
 * re-scoring replaces the prior judgment; the table accumulates one row per
 * report over time for trend tracking.
 */
export type ReportRubricScore = {
  id: RubricScoreId;
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId;
  userId: UserId;
  relevance: number;
  accuracy: number;
  novelty: number;
  note: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type ReportRubricScoreWriteInput = {
  workspaceId: WorkspaceId;
  reportId: WeeklyReportId;
  userId: UserId;
  relevance: number;
  accuracy: number;
  novelty: number;
  note?: string | null;
};
