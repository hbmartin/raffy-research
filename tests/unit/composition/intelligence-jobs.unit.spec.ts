import { Result } from '@swan-io/boxed';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

vi.mock('@/modules/intelligence', () => ({
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
      failed: 1,
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
        Result.Ok({ type: 'report_failed', reason: 'Report generation failed' })
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
});
