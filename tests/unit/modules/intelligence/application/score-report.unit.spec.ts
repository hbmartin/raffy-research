import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  createIntelligenceUseCases,
  type IntelligenceUseCaseDeps,
  type ReportRubricScore,
  type WeeklyReport,
} from '@/modules/intelligence';
import {
  toRubricScoreId,
  toUserId,
  toWeeklyReportId,
  toWorkspaceId,
} from '@/modules/kernel';
import type { Logger } from '@/modules/kernel/application/ports/logger';

const now = new Date('2026-06-01T00:00:00.000Z');
const workspaceId = toWorkspaceId('ws-1');
const otherWorkspaceId = toWorkspaceId('ws-2');
const userId = toUserId('user-1');
const reportId = toWeeklyReportId('report-1');

const makeLogger = (): Logger => ({
  debug: vi.fn<Logger['debug']>(),
  info: vi.fn<Logger['info']>(),
  warn: vi.fn<Logger['warn']>(),
  error: vi.fn<Logger['error']>(),
});

const report = {
  id: reportId,
  workspaceId,
  periodStart: now,
  periodEnd: now,
  timezone: 'UTC',
  status: 'published',
  generatedAt: now,
  publishedAt: now,
  title: 'Report',
  reportData: null,
  modelMetadata: null,
  failureReason: null,
  createdAt: now,
  updatedAt: now,
} satisfies WeeklyReport;

const rubricScore = {
  id: toRubricScoreId('score-1'),
  workspaceId,
  reportId,
  userId,
  relevance: 4,
  accuracy: 3,
  novelty: 5,
  note: null,
  createdAt: now,
  updatedAt: now,
} satisfies ReportRubricScore;

function makeDeps(
  overrides: Partial<IntelligenceUseCaseDeps> = {}
): IntelligenceUseCaseDeps {
  const deps = {
    workspaceRepository: {},
    sourceRepository: {},
    reportRepository: {
      getById: vi.fn(async () =>
        Result.Ok({ type: 'report_found' as const, report })
      ),
    },
    rubricScoreRepository: {
      upsert: vi.fn(async () => Result.Ok(rubricScore)),
      getForReportAndUser: vi.fn(async () =>
        Result.Ok({ type: 'rubric_score_found' as const, score: rubricScore })
      ),
    },
    ingestionRepository: {},
    permissionChecker: {
      hasPermission: vi.fn(async () =>
        Result.Ok({ type: 'permission_granted' as const })
      ),
    },
    idGenerator: { createId: vi.fn() },
    clock: { now: vi.fn(() => now) },
    logger: makeLogger(),
  } as unknown as IntelligenceUseCaseDeps;

  return { ...deps, ...overrides };
}

function expectOkType(
  result: Awaited<
    ReturnType<ReturnType<typeof createIntelligenceUseCases>['scoreReport']>
  >
) {
  if (result.isError()) throw result.getError();
  return result.get().type;
}

describe('scoreReport', () => {
  it('upserts the rubric score when the report is in the workspace', async () => {
    const deps = makeDeps();
    const useCases = createIntelligenceUseCases(deps);

    const result = await useCases.scoreReport({
      currentUserId: userId,
      workspaceId,
      reportId,
      relevance: 4,
      accuracy: 3,
      novelty: 5,
    });

    expect(expectOkType(result)).toBe('report_scored');
    expect(deps.rubricScoreRepository.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        workspaceId,
        reportId,
        userId,
        relevance: 4,
        accuracy: 3,
        novelty: 5,
        note: null,
      })
    );
  });

  it('does not score a report that belongs to another workspace', async () => {
    const deps = makeDeps({
      reportRepository: {
        ...makeDeps().reportRepository,
        getById: vi.fn(async () =>
          Result.Ok({
            type: 'report_found' as const,
            report: { ...report, workspaceId: otherWorkspaceId },
          })
        ),
      },
    });
    const useCases = createIntelligenceUseCases(deps);

    const result = await useCases.scoreReport({
      currentUserId: userId,
      workspaceId,
      reportId,
      relevance: 4,
      accuracy: 3,
      novelty: 5,
    });

    expect(expectOkType(result)).toBe('forbidden');
    expect(deps.rubricScoreRepository.upsert).not.toHaveBeenCalled();
  });

  it('rejects out-of-range rubric values', async () => {
    const deps = makeDeps();
    const useCases = createIntelligenceUseCases(deps);

    const result = await useCases.scoreReport({
      currentUserId: userId,
      workspaceId,
      reportId,
      relevance: 6,
      accuracy: 3,
      novelty: 5,
    });

    expect(
      result.match({
        Ok: () => null,
        Error: (error) => error.code,
      })
    ).toBe('RUBRIC_SCORE_INVALID');
    expect(deps.rubricScoreRepository.upsert).not.toHaveBeenCalled();
  });

  it('returns the current user score for a report', async () => {
    const deps = makeDeps();
    const useCases = createIntelligenceUseCases(deps);

    const result = await useCases.getReportRubricScore({
      currentUserId: userId,
      reportId,
    });

    expect(
      result.match({
        Ok: (outcome) => outcome.type,
        Error: (error) => error.code,
      })
    ).toBe('rubric_score_found');
    expect(deps.rubricScoreRepository.getForReportAndUser).toHaveBeenCalledWith(
      reportId,
      userId
    );
  });
});
