import { describe, expect, it, vi } from 'vitest';

import type { IntelligenceRepository } from '@/modules/intelligence';
import type { IntelligenceUseCases } from '@/modules/intelligence/factory';
import { providerAdapters } from '@/modules/intelligence/infrastructure/providers/provider-registry';
import { createIntelligenceHttpHandlers } from '@/modules/intelligence/transport/http/intelligence-handlers';
import { toGeneratedId } from '@/modules/kernel';

describe('intelligence HTTP handlers', () => {
  it('protects cron routes with CRON_SECRET bearer authorization', async () => {
    const startDailyIngestionWorkflow = vi.fn(async () => ({ runId: 'run-1' }));
    const handlers = createIntelligenceHttpHandlers({
      clock: { now: () => new Date('2026-06-03T14:00:00.000Z') },
      getRuntimeConfig: () => ({
        cronSecret: 'secret',
        openAiModel: 'gpt-5.4-mini',
        providerCredentials: {},
      }),
      getProviderAdapter: (providerName) => providerAdapters[providerName],
      getUseCases: vi.fn(),
      idGenerator: { createId: () => toGeneratedId('id-1') },
      startDailyIngestionWorkflow,
      startWeeklyReportsWorkflow: vi.fn(),
    });

    await expect(
      handlers.startDailyIngestion(
        new Request('https://app.example/api/cron/daily-ingest')
      )
    ).rejects.toMatchObject({ status: 401 });

    const response = await handlers.startDailyIngestion(
      new Request('https://app.example/api/cron/daily-ingest', {
        headers: { authorization: 'Bearer secret' },
      })
    );

    await expect(response.json()).resolves.toEqual({
      ok: true,
      runId: 'run-1',
    });
    expect(startDailyIngestionWorkflow).toHaveBeenCalledTimes(1);
  });

  it('stores provider callback raw payload before inserting normalized records', async () => {
    const calls: string[] = [];
    const repository = {
      insertProviderCallbackEvent: vi.fn(async () => {
        calls.push('callback');
        return { id: 'callback-1' };
      }),
      insertSourceRecord: vi.fn(async () => {
        calls.push('source');
        return {};
      }),
      insertSearchResult: vi.fn(async () => {
        calls.push('search');
        return {};
      }),
      updateProviderCallbackEvent: vi.fn(async () => {
        calls.push('callback-update');
        return {};
      }),
    } as unknown as IntelligenceRepository;
    const handlers = createIntelligenceHttpHandlers({
      clock: { now: () => new Date('2026-06-03T14:00:00.000Z') },
      getRuntimeConfig: () => ({
        openAiModel: 'gpt-5.4-mini',
        providerCallbackSecret: 'callback-secret',
        providerCredentials: {},
      }),
      getProviderAdapter: (providerName) => providerAdapters[providerName],
      getUseCases: () =>
        ({
          repository,
        }) as IntelligenceUseCases,
      idGenerator: {
        createId: () => toGeneratedId(`id-${calls.length + 1}`),
      },
      startDailyIngestionWorkflow: vi.fn(),
      startWeeklyReportsWorkflow: vi.fn(),
    });

    const response = await handlers.receiveProviderCallback({
      provider: 'exa',
      request: new Request(
        'https://app.example/api/providers/exa/callback?workspaceId=workspace-1',
        {
          body: JSON.stringify({
            results: [
              {
                id: 'source-a',
                title: 'Market note',
                url: 'https://example.com/note',
                text: 'Teams are comparing agent research workflows.',
              },
            ],
          }),
          headers: {
            authorization: 'Bearer callback-secret',
            'content-type': 'application/json',
          },
          method: 'POST',
        }
      ),
    });

    expect(response.status).toBe(200);
    expect(calls[0]).toBe('callback');
    expect(calls).toEqual(['callback', 'source', 'search', 'callback-update']);
    expect(repository.insertProviderCallbackEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        providerName: 'exa',
        rawPayload: expect.objectContaining({ results: expect.any(Array) }),
        status: 'received',
        workspaceId: 'workspace-1',
      })
    );
  });

  it('rejects provider callbacks without the shared callback secret', async () => {
    const repository = {
      insertProviderCallbackEvent: vi.fn(),
    } as unknown as IntelligenceRepository;
    const handlers = createIntelligenceHttpHandlers({
      clock: { now: () => new Date('2026-06-03T14:00:00.000Z') },
      getRuntimeConfig: () => ({
        openAiModel: 'gpt-5.4-mini',
        providerCallbackSecret: 'callback-secret',
        providerCredentials: {},
      }),
      getProviderAdapter: (providerName) => providerAdapters[providerName],
      getUseCases: () =>
        ({
          repository,
        }) as IntelligenceUseCases,
      idGenerator: { createId: () => toGeneratedId('id-1') },
      startDailyIngestionWorkflow: vi.fn(),
      startWeeklyReportsWorkflow: vi.fn(),
    });

    await expect(
      handlers.receiveProviderCallback({
        provider: 'exa',
        request: new Request(
          'https://app.example/api/providers/exa/callback?workspaceId=workspace-1',
          {
            body: JSON.stringify({ results: [] }),
            headers: { 'content-type': 'application/json' },
            method: 'POST',
          }
        ),
      })
    ).rejects.toMatchObject({ status: 401 });
    expect(repository.insertProviderCallbackEvent).not.toHaveBeenCalled();
  });
});
