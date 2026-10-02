import { Result } from '@swan-io/boxed';

import { fetchJson } from './http';
import { asArray, asObject, asString, pick, toDate } from './json-access';
import type {
  NormalizedIngest,
  ProviderAdapter,
} from '../../application/ports/provider-adapter';
import { safeAppErrorDetails } from '../../application/safe-diagnostics';
import type {
  SearchResultWriteInput,
  SourceRecordWriteInput,
} from '../../domain/source';
import { canonicalizeSourceUrl } from '../../domain/url';

const EXA_SEARCH_URL = 'https://api.exa.ai/search';

/**
 * Append a keyword to an already-captured record's query list.
 *
 * Tolerates a missing record and an unexpected metadata shape rather than
 * throwing: an ingest run losing one keyword attribution is a far better
 * outcome than it losing the whole provider's captures.
 */
function addQuery(
  record: SourceRecordWriteInput | undefined,
  keywordString: string
): void {
  if (!record) return;
  const queries = (record.metadata as { queries?: unknown } | null)?.queries;
  if (!Array.isArray(queries)) return;
  if (!queries.includes(keywordString)) queries.push(keywordString);
}

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
    // One page can rank for several of the workspace's keywords, which used to
    // store it once per keyword. Matching several keywords is a property of the
    // page, not a reason to capture it twice, so the queries accumulate onto a
    // single record. Search results stay one per result per query: they record
    // what each query returned, which is a different question.
    const sourceIndexByCanonicalUrl = new Map<string, number>();
    let requestsSucceeded = 0;
    let requestsFailed = 0;

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
        requestsFailed += 1;
        ctx.logger.warn({
          event: 'intelligence.ingest.provider_error',
          details: safeAppErrorDetails(response.getError()),
        });
        continue;
      }
      requestsSucceeded += 1;

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
        const canonicalUrl = canonicalizeSourceUrl(url);
        const seenAt =
          canonicalUrl === null
            ? undefined
            : sourceIndexByCanonicalUrl.get(canonicalUrl);
        if (seenAt !== undefined) {
          addQuery(sourceRecords[seenAt], keyword.keywordString);
          return;
        }
        if (canonicalUrl !== null) {
          sourceIndexByCanonicalUrl.set(canonicalUrl, sourceRecords.length);
        }
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
          // The keyword strings as sent to the provider, not keyword ids: a
          // source record is an account of what happened, and a later rename
          // must not change what a stored record says was searched for.
          metadata: { queries: [keyword.keywordString] },
        });
      });
    }

    return Result.Ok({
      sourceRecords,
      searchResults,
      requestsSucceeded,
      requestsFailed,
    } satisfies NormalizedIngest);
  },
};
