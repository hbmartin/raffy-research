import { Result } from '@swan-io/boxed';
import { and, eq } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';

import type { UserId, WeeklyReportId } from '@/modules/kernel/domain/ids';
import {
  toRubricScoreId,
  toUserId,
  toWeeklyReportId,
  toWorkspaceId,
} from '@/modules/kernel/domain/ids';
import { observeRepository } from '@/modules/kernel/infrastructure/db/observability';
import type { DbLike } from '@/modules/kernel/infrastructure/db/types';
import { isRootDatabase } from '@/modules/kernel/infrastructure/db/types';

import { judgmentRecord } from './judgment-schema';
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
      const work = async (db: DbLike) => {
        const [upserted] = await db
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
          throw intelligenceInvariantError(
            'RUBRIC_SCORE_UPSERT_EMPTY',
            'rubric score upsert returned no row'
          );
        }
        await db.insert(judgmentRecord).values({
          id: randomUUID(),
          workspaceId: input.workspaceId,
          targetId: input.reportId,
          kind: 'rubric',
          provenance: {
            ...input.provenance,
            origin: 'human',
            channel: input.provenance?.channel ?? 'web',
            actorId: input.userId,
          },
          payload: {
            relevance: input.relevance,
            accuracy: input.accuracy,
            novelty: input.novelty,
            note: input.note ?? null,
          },
        });
        return toRubricScore(upserted);
      };
      const value =
        isRootDatabase(this.db) && this.db.$runInTransaction
          ? await this.db.$runInTransaction(work)
          : await work(this.db);
      return Result.Ok(value);
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
