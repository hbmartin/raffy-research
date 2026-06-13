import { Result } from '@swan-io/boxed';
import { and, eq } from 'drizzle-orm';

import type { UserId, WeeklyReportId } from '@/modules/kernel/domain/ids';
import {
  toRubricScoreId,
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
import { reportRubricScore as rubricScoreTable } from './schema';
import type { RubricScoreRepository } from '../../application/ports/rubric-score-repository';
import type {
  ReportRubricScore,
  ReportRubricScoreWriteInput,
} from '../../domain/rubric';

type RubricScoreRow = typeof rubricScoreTable.$inferSelect;

const toRubricScore = (row: RubricScoreRow): ReportRubricScore => ({
  id: toRubricScoreId(row.id),
  workspaceId: toWorkspaceId(row.workspaceId),
  reportId: toWeeklyReportId(row.reportId),
  userId: toUserId(row.userId),
  relevance: row.relevance,
  accuracy: row.accuracy,
  novelty: row.novelty,
  note: row.note,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
});

export class RubricScoreRepositoryDrizzle implements RubricScoreRepository {
  constructor(private readonly db: DbLike) {}

  async upsert(input: ReportRubricScoreWriteInput) {
    try {
      const [upserted] = await this.db
        .insert(rubricScoreTable)
        .values({
          workspaceId: input.workspaceId,
          reportId: input.reportId,
          userId: input.userId,
          relevance: input.relevance,
          accuracy: input.accuracy,
          novelty: input.novelty,
          note: input.note ?? null,
        })
        .onConflictDoUpdate({
          target: [rubricScoreTable.reportId, rubricScoreTable.userId],
          set: {
            relevance: input.relevance,
            accuracy: input.accuracy,
            novelty: input.novelty,
            note: input.note ?? null,
            updatedAt: new Date(),
          },
        })
        .returning();
      if (!upserted) {
        return Result.Error(
          intelligenceInvariantError(
            'RUBRIC_SCORE_UPSERT_EMPTY',
            'rubric score upsert returned no row'
          )
        );
      }
      return Result.Ok(toRubricScore(upserted));
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'RUBRIC_SCORE_UPSERT_ERROR')
      );
    }
  }

  async getForReportAndUser(reportId: WeeklyReportId, userId: UserId) {
    try {
      const [row] = await this.db
        .select()
        .from(rubricScoreTable)
        .where(
          and(
            eq(rubricScoreTable.reportId, reportId),
            eq(rubricScoreTable.userId, userId)
          )
        )
        .limit(1);
      return Result.Ok(
        row
          ? ({ type: 'rubric_score_found', score: toRubricScore(row) } as const)
          : ({ type: 'rubric_score_none' } as const)
      );
    } catch (error) {
      return Result.Error(
        mapIntelligenceDbError(error, 'RUBRIC_SCORE_GET_ERROR')
      );
    }
  }
}

export function createRubricScoreRepository(dependencies: {
  db: DbLike;
}): RubricScoreRepository {
  return observeRepository(
    new RubricScoreRepositoryDrizzle(dependencies.db),
    'intelligence.rubricScore'
  );
}
