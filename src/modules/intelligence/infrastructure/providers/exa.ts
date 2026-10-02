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

const contentLength = (record: SourceRecordWriteInput): number =>
  record.contentText?.length ?? 0;

/** Tolerates an unexpected metadata shape rather than throwing. */
const queriesOf = (record: SourceRecordWriteInput): string[] => {
  const queries = (record.metadata as { queries?: unknown } | null)?.queries;
  if (!Array.isArray(queries)) return [];
  return queries.filter((query): query is string => typeof query === 'string');
};

/**
 * Fold a second capture of one page, matched by another keyword, into the first.
 *
 * Whichever copy carries more page text wins outright, rather than whichever
 * happened to be requested first: exa returns `text` per result, so one query
 * can return a page without text or with less of it than another, and keeping
 * the first arrival would silently prefer the weaker copy.
 *
 * The winning record replaces the other whole, so `title`, `publishedAt` and
 * `rawPayload` keep describing the same response as the `contentText` beside
 * them — a record stitched from two responses would have a `rawPayload` that no
 * longer explains its own fields, which is what makes it auditable.
 *
 * There is deliberately no newest-wins tiebreak, unlike `collapseDuplicateSources`
 * at report time: these requests are seconds apart within one run and
 * `capturedAt` is not assigned until insert, so recency carries no information
 * here. Page text does.
 */
function mergeDuplicateCapture(
  records: SourceRecordWriteInput[],
  index: number,
  candidate: SourceRecordWriteInput
): void {
  const incumbent = records[index];
  if (!incumbent) return;

  const queries = [
    ...new Set([...queriesOf(incumbent), ...queriesOf(candidate)]),
  ];
  const winner =
    contentLength(candidate) > contentLength(incumbent) ? candidate : incumbent;
  records[index] = {
    ...winner,
    metadata: { ...winner.metadata, queries },
  };
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
        const record: SourceRecordWriteInput = {
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
        };

        const canonicalUrl = canonicalizeSourceUrl(url);
        const seenAt =
          canonicalUrl === null
            ? undefined
            : sourceIndexByCanonicalUrl.get(canonicalUrl);
        if (seenAt !== undefined) {
          mergeDuplicateCapture(sourceRecords, seenAt, record);
          return;
        }
        if (canonicalUrl !== null) {
          sourceIndexByCanonicalUrl.set(canonicalUrl, sourceRecords.length);
        }
        sourceRecords.push(record);
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
