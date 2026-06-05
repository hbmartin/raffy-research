import { fetchJson } from './http';
import { asArray, asObject, asString, pick, toDate } from './json-access';
import type {
  CallbackNormalization,
  ProviderAdapter,
} from '../../application/ports/provider-adapter';
import type { SourceRecordWriteInput } from '../../domain/source';

/**
 * Apify: LinkedIn / custom scraping. Actor-run-completed webhooks reference a
 * dataset whose items are normalized into source records.
 */
export const apifyAdapter: ProviderAdapter = {
  name: 'apify',
  isConfigured: ({ credential }) => Boolean(credential),
  async normalizeCallback(ctx): Promise<CallbackNormalization> {
    if (!ctx.credential) {
      return { type: 'invalid', reason: 'APIFY_TOKEN is not configured' };
    }
    const resource = asObject(pick(ctx.payload, 'resource'));
    const datasetId = asString(resource.defaultDatasetId);
    if (!datasetId) return { type: 'unsupported' };

    const items = await fetchJson(
      'apify',
      `https://api.apify.com/v2/datasets/${datasetId}/items?clean=true&format=json&token=${ctx.credential}`
    );
    if (items.isError()) {
      return { type: 'invalid', reason: items.getError().message };
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

    return { type: 'normalized', sourceRecords };
  },
};
