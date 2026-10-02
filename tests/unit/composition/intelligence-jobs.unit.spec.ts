import { Result } from '@swan-io/boxed';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

const mocks = vi.hoisted(() => ({
  createOpenAiReportGenerator: vi.fn(),
  createProviderRegistry: vi.fn(),
  createSlackAlert: vi.fn(),
  getCronSecret: vi.fn(),
  getProviderCredential: vi.fn(),
  getProviderWebhookSecret: vi.fn(),
  getIntelligenceRepositories: vi.fn(),
  getKernel: vi.fn(),
  generateWeeklyReport: vi.fn(),
  handleProviderCallback: vi.fn(),
  runWorkspaceIngest: vi.fn(),
}));

vi.mock('@/modules/intelligence/backend', async () => {
  const actual = await vi.importActual<
    typeof import('@/modules/intelligence/backend')
  >('@/modules/intelligence/backend');
  return {
    createIntelligenceJobRequestHandlers:
      actual.createIntelligenceJobRequestHandlers,
    createOpenAiReportGenerator: mocks.createOpenAiReportGenerator,
    createProviderRegistry: mocks.createProviderRegistry,
    createSlackAlert: mocks.createSlackAlert,
    getCronSecret: mocks.getCronSecret,
    getProviderCredential: mocks.getProviderCredential,
    getProviderWebhookSecret: mocks.getProviderWebhookSecret,
  };
});

vi.mock('@/composition/intelligence', () => ({
  getIntelligenceRepositories: mocks.getIntelligenceRepositories,
}));

vi.mock('@/composition/kernel', () => ({
  getKernel: mocks.getKernel,
}));

vi.mock('@/modules/intelligence', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/modules/intelligence')>()),
  generateWeeklyReport: mocks.generateWeeklyReport,
  handleProviderCallback: mocks.handleProviderCallback,
  runWorkspaceIngest: mocks.runWorkspaceIngest,
}));

const logger = {
  error: vi.fn(),
  info: vi.fn(),
  warn: vi.fn(),
};

function withJsonSpy(request: Request, json = vi.fn()) {
  Object.defineProperty(request, 'json', {
    configurable: true,
    value: json,
  });
  return { request, json };
}

describe('intelligence job request auth', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.runWorkspaceIngest.mockReset();
    mocks.generateWeeklyReport.mockReset();
    mocks.createProviderRegistry.mockReturnValue({ get: vi.fn() });
    mocks.createOpenAiReportGenerator.mockReturnValue({});
    mocks.createSlackAlert.mockReturnValue({});
    mocks.getKernel.mockReturnValue({
      clock: { now: () => new Date('2026-06-01T00:00:00.000Z') },
      logger,
    });
    mocks.getIntelligenceRepositories.mockReturnValue({
      workspaceRepository: {
        list: vi.fn(async () => Result.Ok([])),
      },
      sourceRepository: {},
      ingestionRepository: {},
      reportRepository: {},
      scheduledJobRepository: {
        start: vi.fn(async () => Result.Ok({ type: 'run_started' })),
        finish: vi.fn(async () => Result.Ok({ type: 'run_finished' })),
        upsertWorkspace: vi.fn(async () =>
          Result.Ok({ type: 'workspace_recorded' })
        ),
      },
    });
    mocks.handleProviderCallback.mockResolvedValue(
      Result.Ok({
        type: 'callback_stored',
        normalized: false,
        sourceRecords: 0,
      })
    );
  });

  it('rejects cron requests when no cron secret is configured', async () => {
    mocks.getCronSecret.mockReturnValue(null);
    const { handleWeeklyReportsCron } =
      await import('@/composition/intelligence-jobs');

    const response = await handleWeeklyReportsCron(
      new Request('https://example.com/api/cron/weekly-reports')
    );

    expect(response.status).toBe(401);
    expect(mocks.getIntelligenceRepositories).not.toHaveBeenCalled();
  });

  it('accepts cron requests with a matching bearer token', async () => {
    mocks.getCronSecret.mockReturnValue('cron-secret');
    const { handleWeeklyReportsCron } =
      await import('@/composition/intelligence-jobs');

    const response = await handleWeeklyReportsCron(
      new Request('https://example.com/api/cron/weekly-reports', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      status: 'succeeded',
      total: 0,
    });
  });

  it('returns HTTP 200 and ok false when workspace listing fails', async () => {
    mocks.getCronSecret.mockReturnValue('cron-secret');
    mocks.getIntelligenceRepositories.mockReturnValue({
      ...mocks.getIntelligenceRepositories(),
      workspaceRepository: {
        list: vi.fn(async () => Result.Error({ code: 'WORKSPACE_LIST_ERROR' })),
      },
    });
    const { handleDailyIngestCron } =
      await import('@/composition/intelligence-jobs');
    const response = await handleDailyIngestCron(
      new Request('https://example.com/api/cron/daily-ingest', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: 'failed',
      failed: 0,
      historyStatus: 'recorded',
      workspaces: 0,
      runId: expect.any(String),
    });
  });

  it('reports mixed daily ingestion as partial and records both workspaces', async () => {
    mocks.getCronSecret.mockReturnValue('cron-secret');
    const repositories = mocks.getIntelligenceRepositories();
    repositories.workspaceRepository.list = vi.fn(async () =>
      Result.Ok([{ id: 'ws-1' }, { id: 'ws-2' }])
    );
    mocks.runWorkspaceIngest
      .mockResolvedValueOnce(
        Result.Ok({
          type: 'workspace_ingested',
          providersRun: 1,
          providersSkipped: 0,
          providersPartial: 0,
          providersFailed: 0,
          requestsSucceeded: 1,
          requestsFailed: 0,
          sourceRecords: 1,
          searchResults: 0,
        })
      )
      .mockResolvedValueOnce(
        Result.Ok({
          type: 'workspace_ingested',
          providersRun: 0,
          providersSkipped: 0,
          providersPartial: 0,
          providersFailed: 1,
          requestsSucceeded: 0,
          requestsFailed: 1,
          sourceRecords: 0,
          searchResults: 0,
        })
      );
    const { handleDailyIngestCron } =
      await import('@/composition/intelligence-jobs');
    const response = await handleDailyIngestCron(
      new Request('https://example.com/api/cron/daily-ingest', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: 'partial',
      workspaces: 2,
      ingested: 1,
      failed: 1,
      providersFailed: 1,
      requestsFailed: 1,
    });
    expect(
      repositories.scheduledJobRepository.upsertWorkspace
    ).toHaveBeenCalledTimes(2);
    expect(repositories.scheduledJobRepository.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'partial',
        failureCode: 'WORKSPACE_INGEST_FAILED',
      })
    );
  });

  it('reports weekly partial failure without changing the HTTP status', async () => {
    mocks.getCronSecret.mockReturnValue('cron-secret');
    const repositories = mocks.getIntelligenceRepositories();
    repositories.workspaceRepository.list = vi.fn(async () =>
      Result.Ok([{ id: 'ws-1' }, { id: 'ws-2' }])
    );
    mocks.generateWeeklyReport
      .mockResolvedValueOnce(
        Result.Ok({ type: 'report_published', report: { id: 'report-1' } })
      )
      .mockResolvedValueOnce(
        Result.Ok({
          type: 'report_failed',
          reason: 'Report generation failed',
          failureCode: 'OPENAI_GENERATION_ERROR',
        })
      );
    const { handleWeeklyReportsCron } =
      await import('@/composition/intelligence-jobs');
    const response = await handleWeeklyReportsCron(
      new Request('https://example.com/api/cron/weekly-reports', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      status: 'partial',
      total: 2,
      generated: 1,
      failed: 1,
    });
    expect(
      repositories.scheduledJobRepository.upsertWorkspace
    ).toHaveBeenCalledWith(
      expect.objectContaining({ workspaceId: 'ws-1', reportId: 'report-1' })
    );
    expect(repositories.scheduledJobRepository.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'partial',
        failureCode: 'WORKSPACE_REPORT_FAILED',
      })
    );
  });

  it('rejects cron requests with the wrong bearer token', async () => {
    mocks.getCronSecret.mockReturnValue('cron-secret');
    const { handleDailyIngestCron } =
      await import('@/composition/intelligence-jobs');

    const response = await handleDailyIngestCron(
      new Request('https://example.com/api/cron/daily-ingest', {
        headers: { authorization: 'Bearer wrong' },
      })
    );

    expect(response.status).toBe(401);
    expect(mocks.getIntelligenceRepositories).not.toHaveBeenCalled();
  });

  it('rejects provider callbacks when no webhook secret is configured', async () => {
    mocks.getProviderWebhookSecret.mockReturnValue(null);
    const { handleProviderCallbackRequest } =
      await import('@/composition/intelligence-jobs');

    const { request, json } = withJsonSpy(
      new Request('https://example.com/api/providers/apify/callback')
    );
    const response = await handleProviderCallbackRequest('apify', request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.handleProviderCallback).not.toHaveBeenCalled();
  });

  it('accepts provider callbacks with a matching bearer token', async () => {
    mocks.getProviderWebhookSecret.mockReturnValue('webhook-secret');
    const { handleProviderCallbackRequest } =
      await import('@/composition/intelligence-jobs');

    const payload = { event: 'done' };
    const { request } = withJsonSpy(
      new Request(
        'https://example.com/api/providers/apify/callback?workspaceId=ws-1',
        { headers: { authorization: 'Bearer webhook-secret' } }
      ),
      vi.fn(async () => payload)
    );
    const response = await handleProviderCallbackRequest('apify', request);

    expect(response.status).toBe(200);
    expect(mocks.handleProviderCallback).toHaveBeenCalledWith(
      expect.any(Object),
      expect.objectContaining({ providerName: 'apify', payload })
    );
  });

  it('accepts provider callbacks with the provider webhook secret header', async () => {
    mocks.getProviderWebhookSecret.mockReturnValue('webhook-secret');
    const { handleProviderCallbackRequest } =
      await import('@/composition/intelligence-jobs');

    const { request } = withJsonSpy(
      new Request('https://example.com/api/providers/apify/callback', {
        headers: { 'x-provider-webhook-secret': 'webhook-secret' },
      }),
      vi.fn(async () => ({ ok: true }))
    );
    const response = await handleProviderCallbackRequest('apify', request);

    expect(response.status).toBe(200);
    expect(mocks.handleProviderCallback).toHaveBeenCalled();
  });

  it('rejects provider callbacks with the wrong token before reading the body', async () => {
    mocks.getProviderWebhookSecret.mockReturnValue('webhook-secret');
    const { handleProviderCallbackRequest } =
      await import('@/composition/intelligence-jobs');

    const { request, json } = withJsonSpy(
      new Request('https://example.com/api/providers/apify/callback', {
        headers: { authorization: 'Bearer wrong' },
      }),
      vi.fn(async () => ({ shouldNotRead: true }))
    );
    const response = await handleProviderCallbackRequest('apify', request);

    expect(response.status).toBe(401);
    expect(json).not.toHaveBeenCalled();
    expect(mocks.handleProviderCallback).not.toHaveBeenCalled();
  });
  it.each(['daily', 'weekly'])(
    'continues %s processing without a history parent',
    async (kind) => {
      const repositories = mocks.getIntelligenceRepositories();
      repositories.workspaceRepository.list = vi.fn(async () =>
        Result.Ok([{ id: 'ws-1' }])
      );
      repositories.scheduledJobRepository.start = vi.fn(async () =>
        Result.Error({ code: 'START_FAILED' })
      );
      mocks.runWorkspaceIngest.mockResolvedValue(
        Result.Ok({
          type: 'workspace_ingested',
          providersRun: 1,
          providersPartial: 0,
          providersFailed: 0,
          providersSkipped: 0,
          sourceRecords: 3,
          searchResults: 0,
          requestsFailed: 0,
        })
      );
      mocks.generateWeeklyReport.mockResolvedValue(
        Result.Ok({ type: 'report_published', report: { id: 'report-1' } })
      );
      const jobs = await import('@/composition/intelligence-jobs');
      const summary = await (kind === 'daily'
        ? jobs.runDailyIngest()
        : jobs.runWeeklyReports());
      expect(summary).toMatchObject({
        status: 'succeeded',
        historyStatus: 'failed',
        failed: 0,
      });
      expect(
        repositories.scheduledJobRepository.upsertWorkspace
      ).not.toHaveBeenCalled();
      expect(repositories.scheduledJobRepository.finish).toHaveBeenCalledWith(
        expect.objectContaining({ id: summary.runId, status: 'succeeded' })
      );
      if (kind === 'daily')
        expect(mocks.runWorkspaceIngest.mock.calls[0]?.[1]).not.toHaveProperty(
          'scheduledJobRunId'
        );
    }
  );

  it.each(['daily', 'weekly'])(
    'keeps %s processing counts when workspace history fails',
    async (kind) => {
      const repositories = mocks.getIntelligenceRepositories();
      repositories.workspaceRepository.list = vi.fn(async () =>
        Result.Ok([{ id: 'ws-1' }])
      );
      repositories.scheduledJobRepository.upsertWorkspace = vi.fn(async () =>
        Result.Error({ code: 'WRITE_FAILED' })
      );
      mocks.runWorkspaceIngest.mockResolvedValue(
        Result.Ok({
          type: 'workspace_ingested',
          providersRun: 2,
          providersPartial: 0,
          providersFailed: 0,
          providersSkipped: 0,
          sourceRecords: 3,
          searchResults: 0,
          requestsFailed: 0,
        })
      );
      mocks.generateWeeklyReport.mockResolvedValue(
        Result.Ok({ type: 'report_published', report: { id: 'report-1' } })
      );
      const jobs = await import('@/composition/intelligence-jobs');
      const summary = await (kind === 'daily'
        ? jobs.runDailyIngest()
        : jobs.runWeeklyReports());
      expect(summary).toMatchObject({
        status: 'succeeded',
        historyStatus: 'failed',
        failed: 0,
      });
      expect(summary).toMatchObject(
        kind === 'daily'
          ? { providersSucceeded: 2, providersFailed: 0, ingested: 3 }
          : { generated: 1 }
      );
      expect(repositories.scheduledJobRepository.finish).toHaveBeenCalledWith(
        expect.objectContaining({ status: 'succeeded', failed: 0 })
      );
    }
  );

  it('returns processing success when final history fails', async () => {
    mocks.getCronSecret.mockReturnValue('cron-secret');
    const repositories = mocks.getIntelligenceRepositories();
    repositories.scheduledJobRepository.finish = vi.fn(async () =>
      Result.Error({ code: 'FINISH_FAILED' })
    );
    const jobs = await import('@/composition/intelligence-jobs');
    const response = await jobs.handleDailyIngestCron(
      new Request('https://example.com/api/cron/daily-ingest', {
        headers: { authorization: 'Bearer cron-secret' },
      })
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      status: 'succeeded',
      historyStatus: 'failed',
      failed: 0,
    });
  });

  it.each(['daily', 'weekly'])(
    'finalizes %s history after unexpected workspace-list failure',
    async (kind) => {
      const repositories = mocks.getIntelligenceRepositories();
      repositories.workspaceRepository.list = vi.fn(async () => {
        throw new Error('unexpected');
      });
      const jobs = await import('@/composition/intelligence-jobs');
      const summary = await (kind === 'daily'
        ? jobs.runDailyIngest()
        : jobs.runWeeklyReports());
      expect(summary).toMatchObject({
        status: 'failed',
        historyStatus: 'recorded',
        failed: 0,
      });
      expect(repositories.scheduledJobRepository.finish).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'failed',
          failed: 0,
          failureCode: 'UNEXPECTED_ERROR',
        })
      );
    }
  );

  it('captures one report exception for a failed workspace and preserves its failure code', async () => {
    const repositories = mocks.getIntelligenceRepositories();
    repositories.workspaceRepository.list = vi.fn(async () =>
      Result.Ok([{ id: 'ws-1' }])
    );
    mocks.generateWeeklyReport.mockResolvedValue(
      Result.Ok({
        type: 'report_failed',
        reason: 'Report validation failed',
        failureCode: 'REPORT_SCHEMA_INVALID',
      })
    );
    const { runWeeklyReports } =
      await import('@/composition/intelligence-jobs');
    expect(await runWeeklyReports()).toMatchObject({
      failed: 1,
      historyStatus: 'recorded',
    });
    expect(
      logger.error.mock.calls.filter(([entry]) => entry.exception)
    ).toHaveLength(1);
    expect(
      repositories.scheduledJobRepository.upsertWorkspace
    ).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'REPORT_SCHEMA_INVALID' })
    );
  });
  it.each(['daily', 'weekly'])(
    'reconciles an absent %s parent without a duplicate exception',
    async (kind) => {
      const repositories = mocks.getIntelligenceRepositories();
      repositories.scheduledJobRepository.start.mockResolvedValue(
        Result.Error({ code: 'START_FAILED' })
      );
      repositories.scheduledJobRepository.finish.mockResolvedValue(
        Result.Error({ code: 'SCHEDULED_JOB_FINISH_MISSING' })
      );
      const jobs = await import('@/composition/intelligence-jobs');
      const summary = await (kind === 'daily'
        ? jobs.runDailyIngest()
        : jobs.runWeeklyReports());
      expect(summary).toMatchObject({
        status: 'succeeded',
        historyStatus: 'failed',
        failed: 0,
      });
      expect(repositories.scheduledJobRepository.finish).toHaveBeenCalledWith(
        expect.objectContaining({ id: summary.runId })
      );
      expect(
        logger.error.mock.calls.filter(([entry]) => entry.exception)
      ).toHaveLength(1);
      expect(logger.warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'intelligence.scheduled_job.reconciliation_missing',
        })
      );
    }
  );

  it.each(['daily', 'weekly'])(
    'counts a missing %s workspace as a skip without writing its FK',
    async (kind) => {
      const repositories = mocks.getIntelligenceRepositories();
      repositories.workspaceRepository.list.mockResolvedValue(
        Result.Ok([{ id: 'deleted-workspace' }])
      );
      mocks.generateWeeklyReport.mockResolvedValue(
        Result.Ok({ type: 'workspace_not_found' })
      );
      mocks.runWorkspaceIngest.mockResolvedValue(
        Result.Ok({ type: 'workspace_not_found' })
      );
      const jobs = await import('@/composition/intelligence-jobs');
      const summary = await (kind === 'daily'
        ? jobs.runDailyIngest()
        : jobs.runWeeklyReports());
      expect(summary).toMatchObject({
        status: 'succeeded',
        historyStatus: 'recorded',
        failed: 0,
      });
      expect(
        repositories.scheduledJobRepository.upsertWorkspace
      ).not.toHaveBeenCalled();
      expect(repositories.scheduledJobRepository.finish).toHaveBeenCalledWith(
        expect.objectContaining({ skipped: 1, total: 1 })
      );
      expect(logger.error).not.toHaveBeenCalled();
    }
  );

  it.each(
    (['daily', 'weekly'] as const).flatMap((kind) =>
      (['start', 'upsertWorkspace', 'finish'] as const).map((stage) => ({
        kind,
        stage,
      }))
    )
  )(
    'captures a safe exception for returned and thrown $kind $stage history failures',
    async ({ kind, stage }) => {
      const jobs = await import('@/composition/intelligence-jobs');
      const repositories = mocks.getIntelligenceRepositories();
      repositories.workspaceRepository.list.mockResolvedValue(
        Result.Ok([{ id: 'ws-1' }])
      );
      mocks.generateWeeklyReport.mockResolvedValue(
        Result.Ok({ type: 'report_published', report: { id: 'report-1' } })
      );
      mocks.runWorkspaceIngest.mockResolvedValue(
        Result.Ok({
          type: 'workspace_ingested',
          providersRun: 1,
          providersPartial: 0,
          providersFailed: 0,
          providersSkipped: 0,
          sourceRecords: 0,
          searchResults: 0,
          requestsFailed: 0,
        })
      );
      const secret = 'sk-history-secret';
      const error = new AppError({
        code: 'HISTORY_WRITE_ERROR',
        category: 'system',
        status: 500,
        message: secret,
        cause: new Error(secret),
      });
      for (const throws of [false, true]) {
        logger.error.mockClear();
        repositories.scheduledJobRepository[stage].mockImplementation(
          async () => {
            if (throws) throw error;
            return Result.Error(error);
          }
        );
        const summary = await (kind === 'weekly'
          ? jobs.runWeeklyReports()
          : jobs.runDailyIngest());
        expect(summary).toMatchObject({
          status: 'succeeded',
          historyStatus: 'failed',
          failed: 0,
        });
        const captures = logger.error.mock.calls.filter(
          ([entry]) => entry.exception
        );
        expect(captures).toHaveLength(1);
        expect(captures[0]?.[0]).toMatchObject({
          event: 'intelligence.scheduled_job.history_failed',
          details: {
            runId: summary.runId,
            kind: kind === 'weekly' ? 'weekly_reports' : 'daily_ingest',
            stage: stage === 'upsertWorkspace' ? 'workspace' : stage,
            errorCode: throws ? 'UNEXPECTED_ERROR' : 'HISTORY_WRITE_ERROR',
          },
        });
        expect(captures[0]?.[0].exception.cause).toBeUndefined();
        expect(JSON.stringify(captures)).not.toContain(secret);
      }
    }
  );

  it('captures an acknowledged parent that vanishes before finalization', async () => {
    const repositories = mocks.getIntelligenceRepositories();
    repositories.scheduledJobRepository.finish.mockResolvedValue(
      Result.Error({ code: 'SCHEDULED_JOB_FINISH_MISSING' })
    );
    const jobs = await import('@/composition/intelligence-jobs');
    await jobs.runDailyIngest();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: expect.any(AppError),
        details: expect.objectContaining({
          errorCode: 'SCHEDULED_JOB_FINISH_MISSING',
        }),
      })
    );
  });

  it('preserves generation context when persisting the failure also fails', async () => {
    const repositories = mocks.getIntelligenceRepositories();
    repositories.workspaceRepository.list.mockResolvedValue(
      Result.Ok([{ id: 'ws-1' }])
    );
    const secret = 'sk-provider-secret';
    mocks.generateWeeklyReport.mockResolvedValue(
      Result.Error(
        new AppError({
          code: 'FAILURE_WRITE_ERROR',
          category: 'system',
          status: 500,
          cause: new Error(secret),
          details: {
            reportFailure: {
              failureCode: 'OPENAI_GENERATION_ERROR',
              diagnostics: {
                stage: 'repair',
                provider: 'openai',
                model: 'model',
                upstreamStatus: 429,
                requestId: 'req-1',
                durationMs: 125,
                rawPrompt: secret,
                validationDiagnostics: [
                  { path: 'title', code: 'invalid_type' },
                ],
              },
            },
          },
        })
      )
    );
    const jobs = await import('@/composition/intelligence-jobs');
    expect(await jobs.runWeeklyReports()).toMatchObject({
      failed: 1,
      historyStatus: 'recorded',
    });
    expect(
      repositories.scheduledJobRepository.upsertWorkspace
    ).toHaveBeenCalledWith(
      expect.objectContaining({ failureCode: 'OPENAI_GENERATION_ERROR' })
    );
    const captures = logger.error.mock.calls.filter(
      ([entry]) => entry.exception
    );
    expect(captures).toHaveLength(1);
    expect(captures[0]?.[0]).toMatchObject({
      sentryTags: { failureCode: 'OPENAI_GENERATION_ERROR' },
      details: {
        failureCode: 'OPENAI_GENERATION_ERROR',
        errorCode: 'FAILURE_WRITE_ERROR',
        stage: 'repair',
        upstreamStatus: 429,
        requestId: 'req-1',
        model: 'model',
        validationDiagnostics: [{ path: 'title', code: 'invalid_type' }],
      },
    });
    expect(captures[0]?.[0].exception.cause).toBeUndefined();
    expect(JSON.stringify(captures)).not.toContain(secret);
  });

  it('includes safe diagnostics in the report outcome exception capture', async () => {
    const repositories = mocks.getIntelligenceRepositories();
    repositories.workspaceRepository.list.mockResolvedValue(
      Result.Ok([{ id: 'ws-1' }])
    );
    mocks.generateWeeklyReport.mockResolvedValue(
      Result.Ok({
        type: 'report_failed',
        failureCode: 'REPORT_SCHEMA_INVALID',
        diagnostics: {
          validationDiagnostics: [{ path: 'title', code: 'invalid_type' }],
        },
      })
    );
    const jobs = await import('@/composition/intelligence-jobs');
    await jobs.runWeeklyReports();
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        exception: expect.any(AppError),
        details: expect.objectContaining({
          validationDiagnostics: [{ path: 'title', code: 'invalid_type' }],
        }),
      })
    );
  });

  it('preserves completed work when a later unexpected failure aborts the run', async () => {
    const repositories = mocks.getIntelligenceRepositories();
    const brokenWorkspace = Object.defineProperty({ id: 'ws-2' }, 'id', {
      get: () => {
        throw new Error('unexpected workspace failure');
      },
    });
    repositories.workspaceRepository.list = vi.fn(async () =>
      Result.Ok([{ id: 'ws-1' }, brokenWorkspace])
    );
    mocks.generateWeeklyReport.mockResolvedValue(
      Result.Ok({ type: 'report_published', report: { id: 'report-1' } })
    );
    const { runWeeklyReports } =
      await import('@/composition/intelligence-jobs');
    expect(await runWeeklyReports()).toMatchObject({
      total: 2,
      generated: 1,
      failed: 0,
      status: 'failed',
      historyStatus: 'recorded',
    });
    expect(repositories.scheduledJobRepository.finish).toHaveBeenCalledWith(
      expect.objectContaining({
        succeeded: 1,
        failed: 0,
        items: 1,
        failureCode: 'UNEXPECTED_ERROR',
      })
    );
  });
});
