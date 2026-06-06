import { Result } from '@swan-io/boxed';

import { fetchJson } from './http';
import { asArray, asObject, asString, pick, toDate } from './json-access';
import type { ProviderAdapter } from '../../application/ports/provider-adapter';
import type { SourceRecordWriteInput } from '../../domain/source';

// Apify dataset URLs may use opaque IDs or safe named datasets.
const APIFY_DATASET_ID_PATTERN = /^[A-Za-z0-9_.-]+$/;

/**
 * Apify: LinkedIn / custom scraping. Actor-run-completed webhooks reference a
 * dataset whose items are normalized into source records.
 */
export const apifyAdapter: ProviderAdapter = {
  name: 'apify',
  isConfigured: ({ credential }) => Boolean(credential),
  async normalizeCallback(ctx) {
    if (!ctx.credential) {
      return Result.Ok({
        type: 'invalid',
        reason: 'APIFY_TOKEN is not configured',
      });
    }
    const resource = asObject(pick(ctx.payload, 'resource'));
    const datasetId = asString(resource.defaultDatasetId);
    if (!datasetId) return Result.Ok({ type: 'unsupported' });
    if (!APIFY_DATASET_ID_PATTERN.test(datasetId)) {
      return Result.Ok({
        type: 'invalid',
        reason: 'Apify callback referenced an invalid dataset id',
      });
    }

    const items = await fetchJson(
      'apify',
      `https://api.apify.com/v2/datasets/${encodeURIComponent(datasetId)}/items?clean=true&format=json`,
      { headers: { Authorization: `Bearer ${ctx.credential}` } }
    );
    if (items.isError()) {
      return Result.Ok({ type: 'invalid', reason: items.getError().message });
    }

    const sourceRecords: SourceRecordWriteInput[] = asArray(items.get()).map(
      (rawItem) => {
        const item = asObject(rawItem);
        const url = asString(item.url) ?? asString(item.postUrl);
        return {
          workspaceId: ctx.workspaceId,
          providerName: 'apify',
          providerSourceId: asString(item.id) ?? asString(item.urn),
          sourceType: 'linkedin_post',
          sourceName: asString(item.authorName) ?? 'LinkedIn',
          externalUrl: url,
          sourceUrl: url,
          title: asString(item.title),
          authorOrAccount: asString(item.authorName) ?? asString(item.author),
          publishedAt: toDate(item.publishedAt ?? item.date),
          contentText: asString(item.text) ?? asString(item.content),
          rawPayload: rawItem,
        };
      }
    );

    return Result.Ok({ type: 'normalized', sourceRecords });
  },
};
