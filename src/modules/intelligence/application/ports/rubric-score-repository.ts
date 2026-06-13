import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { UserId, WeeklyReportId } from '@/modules/kernel/domain/ids';

import type {
  ReportRubricScore,
  ReportRubricScoreWriteInput,
} from '../../domain/rubric';

export type RubricScoreGetOutcome =
  | { type: 'rubric_score_found'; score: ReportRubricScore }
  | { type: 'rubric_score_none' };

export interface RubricScoreRepository {
  upsert(
    input: ReportRubricScoreWriteInput
  ): Promise<ApplicationResult<ReportRubricScore>>;
  getForReportAndUser(
    reportId: WeeklyReportId,
    userId: UserId
  ): Promise<ApplicationResult<RubricScoreGetOutcome>>;
}
