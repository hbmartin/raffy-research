import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  createIntelligenceUseCases,
  type FeedbackEvent,
  type IntelligenceUseCaseDeps,
  type SourceRecord,
  type WeeklyReport,
} from '@/modules/intelligence';
import {
  toFeedbackEventId,
  toSourceRecordId,
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
const sourceRecordId = toSourceRecordId('source-1');

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

const sourceRecord = {
  id: sourceRecordId,
  workspaceId,
  providerName: 'exa',
  providerSourceId: null,
  sourceType: 'web_page',
  sourceSubtype: null,
  sourceName: null,
  sourceUrl: null,
  externalUrl: null,
  title: null,
  authorOrAccount: null,
  domain: null,
  publishedAt: null,
  capturedAt: now,
  contentText: null,
  diffAddedText: null,
  diffRemovedText: null,
  rawPayload: null,
  metadata: null,
  createdAt: now,
  updatedAt: now,
} satisfies SourceRecord;

const feedbackEvent = {
  id: toFeedbackEventId('feedback-1'),
  workspaceId,
  reportId,
  userId,
  eventType: 'copy_excerpt',
  targetType: 'evidence',
  targetId: null,
  sourceRecordId,
  payload: null,
  createdAt: now,
} satisfies FeedbackEvent;

function expectOkType(
  result: Awaited<
    ReturnType<ReturnType<typeof createIntelligenceUseCases>['recordFeedback']>
  >
) {
  if (result.isError()) throw result.getError();
  return result.get().type;
}

function makeDeps(
  overrides: Partial<IntelligenceUseCaseDeps> = {}
): IntelligenceUseCaseDeps {
  const deps = {
    workspaceRepository: {
      setCompetitorState: vi.fn(),
    },
    sourceRepository: {
      getById: vi.fn(async () =>
        Result.Ok({ type: 'source_record_found' as const, sourceRecord })
      ),
    },
    reportRepository: {
      getById: vi.fn(async () =>
        Result.Ok({ type: 'report_found' as const, report })
      ),
    },
    feedbackRepository: {
      create: vi.fn(async () => Result.Ok(feedbackEvent)),
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

describe('recordFeedback', () => {
  it('does not record feedback when the report belongs to another workspace', async () => {
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

    const result = await useCases.recordFeedback({
      currentUserId: userId,
      workspaceId,
      reportId,
      eventType: 'copy_excerpt',
    });

    expect(expectOkType(result)).toBe('forbidden');
    expect(deps.feedbackRepository.create).not.toHaveBeenCalled();
  });

  it('records feedback when report and source are in the requested workspace', async () => {
    const deps = makeDeps();
    const useCases = createIntelligenceUseCases(deps);

    const result = await useCases.recordFeedback({
      currentUserId: userId,
      workspaceId,
      reportId,
      sourceRecordId,
      eventType: 'copy_excerpt',
      targetType: 'evidence',
    });

    expect(expectOkType(result)).toBe('feedback_recorded');
    expect(deps.feedbackRepository.create).toHaveBeenCalledOnce();
  });
});
