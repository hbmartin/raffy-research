import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  NormalizedIngest,
  ProviderCallbackContext,
  ProviderDailyContext,
  ProviderName,
} from '@/modules/intelligence';
import { createProviderRegistry } from '@/modules/intelligence/testing';
import type { Logger } from '@/modules/kernel';
import {
  toCompetitorId,
  toInternalNoteConfigId,
  toProviderConfigId,
  toWorkspaceId,
} from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';

const now = new Date('2026-06-01T00:00:00.000Z');
const workspaceId = toWorkspaceId('ws-1');

const makeLogger = (): Logger => ({
  debug: vi.fn<Logger['debug']>(),
  info: vi.fn<Logger['info']>(),
  warn: vi.fn<Logger['warn']>(),
  error: vi.fn<Logger['error']>(),
});

const workspace = {
  id: workspaceId,
  name: 'Acme',
  companyName: 'Acme Dental',
  companyDescription: 'Recall automation for clinics',
  subcategory: 'Dental SaaS',
  timezone: 'America/Los_Angeles',
  website: null,
  positioning: null,
  icp: null,
  marketAssumptions: null,
  gtmFocus: null,
  createdAt: now,
  updatedAt: now,
};

function makeDailyContext(
  providerName: ProviderName,
  logger: Logger
): ProviderDailyContext {
  return {
    workspace,
    keywords: [],
    competitors: [
      {
        id: toCompetitorId('competitor-1'),
        workspaceId,
        name: 'Competitor',
        domain: 'competitor.example',
        state: 'accepted',
        createdAt: now,
        updatedAt: now,
      },
    ],
    socialAccounts: [],
    internalNoteConfigs: [
      {
        id: toInternalNoteConfigId('note-1'),
        workspaceId,
        sourceSystem: 'slack',
        sourceRef: 'C123',
        enabled: true,
        createdAt: now,
        updatedAt: now,
      },
    ],
    config: {
      id: toProviderConfigId(`provider-${providerName}`),
      workspaceId,
      providerName,
      enabled: true,
      credentialsRef: 'PROVIDER_TOKEN',
      config: null,
      createdAt: now,
      updatedAt: now,
    },
    credential: 'token',
    now,
    periodStart: new Date('2026-05-31T00:00:00.000Z'),
    logger,
  };
}

function expectOkValue(
  result: ApplicationResult<NormalizedIngest> | undefined
): NormalizedIngest {
  if (!result) throw new Error('Expected adapter result');
  if (result.isError()) throw result.getError();
  return result.get();
}

describe('provider adapters', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('logs and skips Slack ok:false responses', async () => {
    const logger = makeLogger();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: false, error: 'invalid_auth' }), {
            status: 200,
          })
      )
    );

    const adapter = createProviderRegistry().get('slack');
    const result = await adapter?.runDailyIngest?.(
      makeDailyContext('slack', logger)
    );
    const value = expectOkValue(result);

    expect(value.sourceRecords).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith({
      event: 'intelligence.ingest.provider_error',
      details: { provider: 'slack', error: 'invalid_auth' },
    });
  });

  it('logs and skips SEMrush ERROR text responses', async () => {
    const logger = makeLogger();
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () => new Response('ERROR: 50 :: ACCESS_DENIED', { status: 200 })
      )
    );

    const adapter = createProviderRegistry().get('semrush');
    const result = await adapter?.runDailyIngest?.(
      makeDailyContext('semrush', logger)
    );
    const value = expectOkValue(result);

    expect(value.sourceRecords).toEqual([]);
    expect(logger.warn).toHaveBeenCalledWith({
      event: 'intelligence.ingest.provider_error',
      details: {
        provider: 'semrush',
        domain: 'competitor.example',
        error: 'ERROR: 50 :: ACCESS_DENIED',
      },
    });
  });

  it('normalizes known empty social callback payloads', async () => {
    const logger = makeLogger();
    const context: ProviderCallbackContext = {
      workspaceId,
      credential: undefined,
      payload: { mentions: [] },
      logger,
    };

    const adapter = createProviderRegistry().get('awario');
    const normalizationResult = await adapter?.normalizeCallback?.(context);

    expect(normalizationResult?.getOr({ type: 'unsupported' })).toEqual({
      type: 'normalized',
      sourceRecords: [],
    });
  });

  it('rejects Apify callback dataset ids with path or query characters', async () => {
    const logger = makeLogger();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const context: ProviderCallbackContext = {
      workspaceId,
      credential: 'token',
      payload: { resource: { defaultDatasetId: 'abc?token=other' } },
      logger,
    };

    const adapter = createProviderRegistry().get('apify');
    const normalizationResult = await adapter?.normalizeCallback?.(context);

    expect(fetchMock).not.toHaveBeenCalled();
    expect(normalizationResult?.getOr({ type: 'unsupported' })).toEqual({
      type: 'invalid',
      reason: 'Apify callback referenced an invalid dataset id',
    });
  });

  it('fetches Apify callback datasets with an encoded path and bearer token', async () => {
    const logger = makeLogger();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      expect(_url).toBe(
        'https://api.apify.com/v2/datasets/abc123/items?clean=true&format=json'
      );
      expect(_init?.headers).toEqual({ Authorization: 'Bearer token' });
      expect(_init?.signal).toBeInstanceOf(AbortSignal);
      return new Response(
        JSON.stringify([
          {
            id: 'item-1',
            url: 'https://example.com/post',
            text: 'Useful market signal',
          },
        ]),
        { status: 200 }
      );
    });
    vi.stubGlobal('fetch', fetchMock);
    const context: ProviderCallbackContext = {
      workspaceId,
      credential: 'token',
      payload: { resource: { defaultDatasetId: 'abc123' } },
      logger,
    };

    const adapter = createProviderRegistry().get('apify');
    const normalizationResult = await adapter?.normalizeCallback?.(context);
    const value = normalizationResult?.getOr({ type: 'unsupported' });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(value).toMatchObject({
      type: 'normalized',
      sourceRecords: [
        {
          workspaceId,
          providerName: 'apify',
          providerSourceId: 'item-1',
          externalUrl: 'https://example.com/post',
        },
      ],
    });
  });

  it('accepts safe Apify named dataset ids', async () => {
    const logger = makeLogger();
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => {
      expect(_url).toBe(
        'https://api.apify.com/v2/datasets/my-dataset.v1/items?clean=true&format=json'
      );
      expect(_init?.headers).toEqual({ Authorization: 'Bearer token' });
      return new Response(JSON.stringify([]), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const context: ProviderCallbackContext = {
      workspaceId,
      credential: 'token',
      payload: { resource: { defaultDatasetId: 'my-dataset.v1' } },
      logger,
    };

    const adapter = createProviderRegistry().get('apify');
    const normalizationResult = await adapter?.normalizeCallback?.(context);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(normalizationResult?.getOr({ type: 'unsupported' })).toEqual({
      type: 'normalized',
      sourceRecords: [],
    });
  });
});
