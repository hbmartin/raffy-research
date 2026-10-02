import { afterEach, describe, expect, it, vi } from 'vitest';

import type {
  NormalizedIngest,
  ProviderDailyContext,
} from '@/modules/intelligence';
import { createProviderRegistry } from '@/modules/intelligence/testing';
import type { Logger } from '@/modules/kernel';
import {
  toKeywordId,
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

const keyword = (id: string, keywordString: string) => ({
  id: toKeywordId(id),
  workspaceId,
  keywordString,
  active: true,
  createdAt: now,
  updatedAt: now,
});

function makeContext(
  keywords: ReturnType<typeof keyword>[],
  logger: Logger
): ProviderDailyContext {
  return {
    workspace: {
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
    },
    keywords,
    competitors: [],
    socialAccounts: [],
    internalNoteConfigs: [],
    config: {
      id: toProviderConfigId('provider-exa'),
      workspaceId,
      providerName: 'exa',
      enabled: true,
      credentialsRef: 'EXA_API_KEY',
      config: null,
      createdAt: now,
      updatedAt: now,
    },
    credential: 'token',
    now,
    periodStart: new Date('2026-05-31T00:00:00.000Z'),
    logger,
  } as ProviderDailyContext;
}

const result = (url: string, id = url) => ({
  id,
  url,
  title: 'A page',
  text: 'Some market signal',
  author: null,
  publishedDate: '2026-05-31T00:00:00.000Z',
});

/** Replies to each exa POST in turn with the results it should return. */
function stubExa(responsesByQuery: Record<string, unknown[]>) {
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { query: string };
    return new Response(
      JSON.stringify({ results: responsesByQuery[body.query] ?? [] }),
      { status: 200 }
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

async function runExa(
  context: ProviderDailyContext
): Promise<NormalizedIngest> {
  const adapter = createProviderRegistry().get('exa');
  const ingest = (await adapter?.runDailyIngest?.(context)) as
    | ApplicationResult<NormalizedIngest>
    | undefined;
  if (!ingest) throw new Error('Expected exa to run');
  if (ingest.isError()) throw ingest.getError();
  return ingest.get();
}

describe('exa adapter in-run deduplication', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * A page ranking for several of the workspace's keywords used to be captured
   * once per keyword, which spent the prompt budget rendering it twice and let
   * one page be cited under two unrelated ids.
   */
  it('captures a page matched by two keywords once, carrying both queries', async () => {
    stubExa({
      'dental no-show reduction': [result('https://example.com/guide')],
      'dental practice software': [result('https://example.com/guide')],
    });

    const value = await runExa(
      makeContext(
        [
          keyword('kw-1', 'dental no-show reduction'),
          keyword('kw-2', 'dental practice software'),
        ],
        makeLogger()
      )
    );

    expect(value.sourceRecords).toHaveLength(1);
    expect(value.sourceRecords[0]?.metadata).toEqual({
      queries: ['dental no-show reduction', 'dental practice software'],
    });
  });

  /**
   * Search results answer "what did this query return", which stays true per
   * query even when the page behind them is one. ADR 0003 keeps them distinct.
   */
  it('still records one search result per query', async () => {
    stubExa({
      'dental no-show reduction': [result('https://example.com/guide')],
      'dental practice software': [result('https://example.com/guide')],
    });

    const value = await runExa(
      makeContext(
        [
          keyword('kw-1', 'dental no-show reduction'),
          keyword('kw-2', 'dental practice software'),
        ],
        makeLogger()
      )
    );

    expect(value.searchResults).toHaveLength(2);
    expect(value.searchResults.map((row) => row.query)).toEqual([
      'dental no-show reduction',
      'dental practice software',
    ]);
  });

  it('collapses URL spellings of one page within a run', async () => {
    stubExa({
      'dental practice software': [
        result('https://www.example.com/guide'),
        result('https://example.com/guide/'),
      ],
    });

    const value = await runExa(
      makeContext([keyword('kw-1', 'dental practice software')], makeLogger())
    );

    expect(value.sourceRecords).toHaveLength(1);
    expect(value.searchResults).toHaveLength(2);
  });

  it('keeps genuinely different pages apart', async () => {
    stubExa({
      'dental practice software': [
        result('https://example.com/a'),
        result('https://example.com/b'),
      ],
    });

    const value = await runExa(
      makeContext([keyword('kw-1', 'dental practice software')], makeLogger())
    );

    expect(value.sourceRecords).toHaveLength(2);
  });

  /**
   * Two translations of one page are two pieces of evidence, so the locale
   * segment has to survive canonicalization.
   */
  it('keeps locale variants of one page apart', async () => {
    stubExa({
      'dental practice software': [
        result('https://www.orbidenti.com/en/events-preview/5622'),
        result('https://www.orbidenti.com/events-preview/5622'),
      ],
    });

    const value = await runExa(
      makeContext([keyword('kw-1', 'dental practice software')], makeLogger())
    );

    expect(value.sourceRecords).toHaveLength(2);
  });

  /**
   * exa returns `text` per result, so one query can return a page with less of
   * it than another. Keeping whichever arrived first would silently prefer the
   * weaker copy.
   */
  it('keeps the richer page text when a later keyword returns more of it', async () => {
    stubExa({
      'dental no-show reduction': [
        { ...result('https://example.com/guide'), text: 'thin' },
      ],
      'dental practice software': [
        {
          ...result('https://example.com/guide'),
          text: 'the full page text, much longer than the other copy',
          title: 'The full title',
          publishedDate: '2026-06-02T00:00:00.000Z',
        },
      ],
    });

    const value = await runExa(
      makeContext(
        [
          keyword('kw-1', 'dental no-show reduction'),
          keyword('kw-2', 'dental practice software'),
        ],
        makeLogger()
      )
    );

    expect(value.sourceRecords).toHaveLength(1);
    const [record] = value.sourceRecords;
    expect(record?.contentText).toBe(
      'the full page text, much longer than the other copy'
    );
    // Replaced whole, so these describe the same response as the text.
    expect(record?.title).toBe('The full title');
    expect(record?.publishedAt).toEqual(new Date('2026-06-02T00:00:00.000Z'));
    expect(record?.metadata).toEqual({
      queries: ['dental no-show reduction', 'dental practice software'],
    });
  });

  it('keeps the first copy when it already has the richer text', async () => {
    stubExa({
      'dental no-show reduction': [
        {
          ...result('https://example.com/guide'),
          text: 'the full page text, much longer than the other copy',
          title: 'The full title',
        },
      ],
      'dental practice software': [
        { ...result('https://example.com/guide'), text: 'thin', title: 'Thin' },
      ],
    });

    const value = await runExa(
      makeContext(
        [
          keyword('kw-1', 'dental no-show reduction'),
          keyword('kw-2', 'dental practice software'),
        ],
        makeLogger()
      )
    );

    expect(value.sourceRecords).toHaveLength(1);
    const [record] = value.sourceRecords;
    expect(record?.contentText).toBe(
      'the full page text, much longer than the other copy'
    );
    expect(record?.title).toBe('The full title');
    expect(record?.metadata).toEqual({
      queries: ['dental no-show reduction', 'dental practice software'],
    });
  });

  it('prefers a copy with text over one carrying none', async () => {
    stubExa({
      'dental no-show reduction': [
        { ...result('https://example.com/guide'), text: null },
      ],
      'dental practice software': [
        { ...result('https://example.com/guide'), text: 'real page text' },
      ],
    });

    const value = await runExa(
      makeContext(
        [
          keyword('kw-1', 'dental no-show reduction'),
          keyword('kw-2', 'dental practice software'),
        ],
        makeLogger()
      )
    );

    expect(value.sourceRecords).toHaveLength(1);
    expect(value.sourceRecords[0]?.contentText).toBe('real page text');
  });

  it('does not merge results that carry no usable URL', async () => {
    stubExa({
      'dental practice software': [
        { ...result('https://example.com/a'), url: null },
        { ...result('https://example.com/b'), url: null },
      ],
    });

    const value = await runExa(
      makeContext([keyword('kw-1', 'dental practice software')], makeLogger())
    );

    expect(value.sourceRecords).toHaveLength(2);
  });
});
