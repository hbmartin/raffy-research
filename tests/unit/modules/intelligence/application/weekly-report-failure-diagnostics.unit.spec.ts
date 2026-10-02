import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  generateWeeklyReport,
  reportFailureContext,
  safeReportFailureDiagnostics,
  type WeeklyReportGenerationDeps,
} from '@/modules/intelligence';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { toWorkspaceId } from '@/modules/kernel/domain/ids';

const fixture = () => {
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

  return { fakeSecret, workspaceId, now, deps, create, logger };
};

describe('weekly report failure privacy', () => {
  it('keeps raw OpenAI errors out of the log, Sentry exception, outcome, and report row', async () => {
    const { fakeSecret, workspaceId, now, deps, create, logger } = fixture();

    const result = await generateWeeklyReport(deps, { workspaceId, now });
    if (result.isError()) throw result.getError();
    expect(result.get()).toEqual({
      type: 'report_failed',
      reason: 'Report generation failed',
      failureCode: 'OPENAI_GENERATION_ERROR',
      diagnostics: {
        stage: 'initial',
        provider: 'openai',
        model: 'gpt-4.1',
        upstreamStatus: 429,
      },
    });
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        failureReason: 'Report generation failed',
      })
    );
    const logged = logger.error.mock.calls[0]?.[0];
    expect(logged).toMatchObject({
      event: 'intelligence.report.generation_failed',
      details: {
        workspaceId,
        failureCode: 'OPENAI_GENERATION_ERROR',
        stage: 'initial',
        provider: 'openai',
        upstreamStatus: 429,
      },
    });
    expect(logged.exception).toBeUndefined();
    expect(
      JSON.stringify({
        log: logged,
        persisted: create.mock.calls,
        outcome: result.get(),
      })
    ).not.toContain(fakeSecret);
  });
});

it('records safe field diagnostics when repair output is invalid', async () => {
  const { deps, workspaceId, logger } = fixture();
  deps.reportGenerator.generate = vi.fn(async () =>
    Result.Ok({
      text: '{"title":42,"executive_summary":{"bullets":["one"]}}',
      modelName: 'model',
    })
  );
  const result = await generateWeeklyReport(deps, { workspaceId });
  expect(result.isOk() && result.get()).toMatchObject({
    type: 'report_failed',
    failureCode: 'REPORT_SCHEMA_INVALID',
  });
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({
        validationDiagnostics: expect.arrayContaining([
          { path: 'title', code: 'invalid_type' },
        ]),
      }),
    })
  );
  expect(logger.error.mock.calls.every(([entry]) => !entry.exception)).toBe(
    true
  );
});

it('logs forbidden-content codes without model text in logs or failed rows', async () => {
  const { deps, workspaceId, logger, create, fakeSecret } = fixture();
  deps.reportGenerator.generate = vi.fn(async () =>
    Result.Ok({
      text: JSON.stringify({
        title: 'Report',
        executive_summary: {
          bullets: [`You should act on ${fakeSecret}`, 'two', 'three'],
        },
        topic_clusters: [],
        confidence: fakeSecret,
      }),
      modelName: 'model',
    })
  );
  const result = await generateWeeklyReport(deps, { workspaceId });
  expect(result.isOk() && result.get()).toMatchObject({
    type: 'report_failed',
    failureCode: 'REPORT_SCHEMA_INVALID',
  });
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({
      details: expect.objectContaining({
        validationDiagnostics: expect.arrayContaining([
          { path: 'confidence', code: 'forbidden_key' },
          { path: 'executive_summary.bullets.0', code: 'forbidden_advice' },
        ]),
      }),
    })
  );
  expect(create).toHaveBeenCalledWith(
    expect.objectContaining({
      failureReason: 'Report schema validation failed',
    })
  );
  expect(
    JSON.stringify({
      logs: logger.error.mock.calls,
      persisted: create.mock.calls,
      result: result.isOk() && result.get(),
    })
  ).not.toContain(fakeSecret);
  expect(logger.error.mock.calls.every(([entry]) => !entry.exception)).toBe(
    true
  );
});

it('returns failure-record persistence errors with a distinct non-capturing diagnostic', async () => {
  const { deps, workspaceId, logger } = fixture();
  const error = new AppError({
    code: 'FAILURE_WRITE_ERROR',
    category: 'system',
    status: 500,
  });
  deps.reportRepository.create = vi.fn(async () => Result.Error(error));
  const result = await generateWeeklyReport(deps, { workspaceId });
  expect(result.isError() && result.getError()).toMatchObject({
    code: error.code,
    category: error.category,
    status: error.status,
    details: {
      reportFailure: {
        failureCode: 'OPENAI_GENERATION_ERROR',
        diagnostics: { stage: 'initial', upstreamStatus: 429 },
      },
    },
  });
  expect(logger.error).toHaveBeenCalledWith(
    expect.objectContaining({
      event: 'intelligence.report.failure_record_failed',
      details: expect.objectContaining({
        errorCode: 'FAILURE_WRITE_ERROR',
        failureCode: 'OPENAI_GENERATION_ERROR',
      }),
    })
  );
  expect(logger.error.mock.calls.every(([entry]) => !entry.exception)).toBe(
    true
  );
});

it('allowlists failure context and bounds safe diagnostic paths at the composition boundary', () => {
  const secret = 'sk-provider-secret';
  const diagnostics = safeReportFailureDiagnostics({
    stage: secret,
    provider: 'openai',
    model: 'model',
    requestId: secret,
    rawPrompt: secret,
    upstreamStatus: 999,
    durationMs: -1,
    validationDiagnostics: [
      { path: `${secret}.confidence`, code: 'forbidden_key', message: secret },
      { path: 'topic_clusters.0.title', code: 'invalid_type' },
      { path: '<root>', code: 'invalid_json' },
      ...Array.from({ length: 30 }, () => ({
        path: 'title',
        code: 'invalid_type',
      })),
    ],
  });
  expect(diagnostics).toMatchObject({ provider: 'openai', model: 'model' });
  expect(diagnostics.validationDiagnostics).toHaveLength(4);
  expect(diagnostics.validationDiagnostics?.slice(0, 3)).toEqual([
    { path: '<unknown>.confidence', code: 'forbidden_key' },
    { path: 'topic_clusters.0.title', code: 'invalid_type' },
    { path: '<root>', code: 'invalid_json' },
  ]);
  expect(JSON.stringify(diagnostics)).not.toContain(secret);
  const error = new AppError({
    code: 'DB_ERROR',
    category: 'system',
    status: 500,
    details: { reportFailure: { failureCode: secret, diagnostics } },
  });
  expect(reportFailureContext(error)).toBeUndefined();
});
