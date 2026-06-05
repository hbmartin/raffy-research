import { Result } from '@swan-io/boxed';

import { fetchJson } from './http';
import { asArray, asObject, asString, pick, toDate } from './json-access';
import type {
  NormalizedIngest,
  ProviderAdapter,
} from '../../application/ports/provider-adapter';
import type {
  SearchResultWriteInput,
  SourceRecordWriteInput,
} from '../../domain/source';

const EXA_SEARCH_URL = 'https://api.exa.ai/search';

/**
 * Exa: daily time-bounded web search over configured keyword strings.
 * Stores search results and the linked page content as source records.
 */
export const exaAdapter: ProviderAdapter = {
  name: 'exa',
  isConfigured: ({ credential }) => Boolean(credential),
  async runDailyIngest(ctx) {
    if (!ctx.credential) {
      return Result.Ok({ sourceRecords: [], searchResults: [] });
    }
    const sourceRecords: SourceRecordWriteInput[] = [];
    const searchResults: SearchResultWriteInput[] = [];

    for (const keyword of ctx.keywords) {
      const response = await fetchJson('exa', EXA_SEARCH_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': ctx.credential,
        },
        body: JSON.stringify({
          query: keyword.keywordString,
          numResults: 10,
          startPublishedDate: ctx.periodStart.toISOString(),
          contents: { text: true },
        }),
      });
      if (response.isError()) {
        ctx.logger.warn({
          event: 'intelligence.ingest.provider_error',
          details: { provider: 'exa', keyword: keyword.keywordString },
        });
        continue;
      }

      const results = asArray(pick(response.get(), 'results'));
      results.forEach((rawResult, index) => {
        const result = asObject(rawResult);
        const url = asString(result.url);
        const title = asString(result.title);
        const text = asString(result.text);
        searchResults.push({
          workspaceId: ctx.workspace.id,
          providerName: 'exa',
          query: keyword.keywordString,
          resultRank: index + 1,
          title,
          snippet: text ? text.slice(0, 280) : null,
          url,
          rawPayload: rawResult,
          metadata: { keywordId: keyword.id },
        });
        sourceRecords.push({
          workspaceId: ctx.workspace.id,
          providerName: 'exa',
          providerSourceId: asString(result.id),
          sourceType: 'web_page',
          sourceName: url,
          externalUrl: url,
          sourceUrl: url,
          title,
          authorOrAccount: asString(result.author),
          publishedAt: toDate(result.publishedDate),
          contentText: text,
          rawPayload: rawResult,
          metadata: { query: keyword.keywordString },
        });
      });
    }

    return Result.Ok({
      sourceRecords,
      searchResults,
    } satisfies NormalizedIngest);
  },
};
