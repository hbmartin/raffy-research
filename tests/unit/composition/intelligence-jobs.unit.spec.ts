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
      total: 0,
    });
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
