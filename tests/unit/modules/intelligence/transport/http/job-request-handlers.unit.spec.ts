import { Result } from '@swan-io/boxed';
import { expect, it, vi } from 'vitest';

import { createIntelligenceJobRequestHandlers } from '@/modules/intelligence/backend';

it.each(['daily', 'weekly'])(
  'keeps safe HTTP diagnostics for an unexpected %s rejection',
  async (kind) => {
    const error = Object.assign(new TypeError('sk-private-payload'), {
      code: 'ETIMEDOUT',
      cause: new Error('sk-private-payload'),
    });
    const logger = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };
    const handlers = createIntelligenceJobRequestHandlers({
      getCronSecret: () => 'cron-test',
      getProviderWebhookSecret: () => null,
      getLogger: () => logger,
      runWeeklyReports: vi.fn().mockRejectedValue(error),
      runDailyIngest: vi.fn().mockRejectedValue(error),
      handleProviderCallback: async () =>
        Result.Ok({
          type: 'callback_stored',
          normalized: false,
          sourceRecords: 0,
        }),
    });
    const request = new Request('https://example.test/cron', {
      headers: { authorization: 'Bearer cron-test' },
    });
    const response = await (kind === 'weekly'
      ? handlers.handleWeeklyReportsCron(request)
      : handlers.handleDailyIngestCron(request));
    const summary = await response.json();
    expect(response.status).toBe(200);
    expect(summary).toMatchObject({
      ok: false,
      status: 'failed',
      historyStatus: 'failed',
    });
    expect(logger.error).toHaveBeenCalledWith(
      expect.objectContaining({
        details: expect.objectContaining({
          runId: summary.runId,
          stage: 'http',
          errorType: 'TypeError',
          errorCode: 'ETIMEDOUT',
        }),
      })
    );
    expect(
      logger.error.mock.calls.filter(([entry]) => entry.exception)
    ).toHaveLength(kind === 'weekly' ? 1 : 0);
    expect(
      JSON.stringify({ logs: logger.error.mock.calls, summary })
    ).not.toContain('sk-private-payload');
  }
);
