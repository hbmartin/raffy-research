import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  generateWeeklyReport,
  type WeeklyReportGenerationDeps,
} from '@/modules/intelligence';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { toWorkspaceId } from '@/modules/kernel/domain/ids';

describe('weekly report failure privacy', () => {
  it('keeps raw OpenAI errors out of the log, Sentry exception, outcome, and report row', async () => {
    const fakeSecret = 'sk-secret-fake-123';
    const now = new Date('2026-06-08T15:00:00.000Z');
    const workspaceId = toWorkspaceId('ws-1');
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
      debug: vi.fn(),
    };
    const create = vi.fn(async () => Result.Ok({ id: 'report-1' }));
    const listByWorkspace = vi.fn(async () => Result.Ok([]));
    const deps = {
      workspaceRepository: {
        getById: async () =>
          Result.Ok({
            type: 'workspace_found',
            workspace: {
              id: workspaceId,
              name: 'Acme',
              companyName: 'Acme',
              companyDescription: 'Description',
              subcategory: 'Software',
              timezone: 'UTC',
              website: null,
              positioning: null,
              icp: null,
              marketAssumptions: null,
              gtmFocus: null,
              createdAt: now,
              updatedAt: now,
            },
          }),
        listKeywords: async () => Result.Ok([]),
        listCompetitors: async () => Result.Ok([]),
        listSocialAccounts: async () => Result.Ok([]),
      },
      sourceRepository: { listForPeriod: async () => Result.Ok([]) },
      reportRepository: { create, listByWorkspace },
      reportGenerator: {
        generate: async () =>
          Result.Error(
            new AppError({
              code: 'OPENAI_GENERATION_ERROR',
              category: 'system',
              status: 502,
              message: 'OpenAI report generation failed',
              details: {
                stage: 'initial',
                provider: 'openai',
                model: 'gpt-4.1',
                upstreamStatus: 429,
              },
              cause: new Error(`raw prompt ${fakeSecret}`),
            })
          ),
      },
      alert: { sendAlert: async () => Result.Ok({ type: 'alert_skipped' }) },
      clock: { now: () => now },
      logger,
    } as unknown as WeeklyReportGenerationDeps;

    const result = await generateWeeklyReport(deps, { workspaceId, now });
    if (result.isError()) throw result.getError();
    expect(result.get()).toEqual({
      type: 'report_failed',
      reason: 'Report generation failed',
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        failureReason: 'Report generation failed',
      })
    );
    const logged = logger.error.mock.calls[0]?.[0];
    expect(logged).toMatchObject({
      event: 'intelligence.report.failed',
      details: {
        workspaceId,
        failureCode: 'OPENAI_GENERATION_ERROR',
        stage: 'initial',
        provider: 'openai',
        upstreamStatus: 429,
      },
      sentryTags: { job: 'weekly_reports' },
    });
    expect(logged.exception.cause).toBeUndefined();
    expect(
      JSON.stringify({
        log: logged,
        persisted: create.mock.calls,
        outcome: result.get(),
      })
    ).not.toContain(fakeSecret);
  });
});
