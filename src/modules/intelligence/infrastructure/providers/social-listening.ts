import { asArray, asObject, asString, pick, toDate } from './json-access';
import type {
  CallbackNormalization,
  ProviderAdapter,
  ProviderCallbackContext,
} from '../../application/ports/provider-adapter';
import type { SourceRecordWriteInput } from '../../domain/source';

/**
 * Mention/lead-signal providers (Awario, Trigify, ForumScout) deliver one or
 * more items per callback. We normalize each into a source record, defensively
 * reading the common fields each exposes.
 */
function normalizeMentions(
  provider: 'awario' | 'trigify' | 'forumscout',
  sourceType: string,
  ctx: ProviderCallbackContext
): CallbackNormalization {
  const root = asObject(ctx.payload);
  const items =
    asArray(root.mentions ?? root.results ?? root.items ?? root.data).length > 0
      ? asArray(root.mentions ?? root.results ?? root.items ?? root.data)
      : [ctx.payload];

  const sourceRecords: SourceRecordWriteInput[] = items
    .map((raw) => {
      const item = asObject(raw);
      const url =
        asString(item.url) ?? asString(item.link) ?? asString(item.postUrl);
      const text =
        asString(item.text) ??
        asString(item.snippet) ??
        asString(item.content) ??
        asString(item.message);
      if (!url && !text) return null;
      const record: SourceRecordWriteInput = {
        workspaceId: ctx.workspaceId,
        providerName: provider,
        providerSourceId: asString(item.id),
        sourceType,
        sourceSubtype: asString(item.source) ?? asString(item.platform) ?? null,
        sourceName:
          asString(item.forum) ??
          asString(item.source) ??
          asString(item.company),
        externalUrl: url,
        sourceUrl: url,
        title: asString(item.title),
        authorOrAccount:
          asString(item.author) ??
          asString(item.person) ??
          asString(item.username),
        publishedAt: toDate(item.date ?? item.publishedAt ?? item.createdAt),
        contentText: text,
        rawPayload: raw,
      };
      return record;
    })
    .filter((record): record is SourceRecordWriteInput => record !== null);

  if (sourceRecords.length === 0) return { type: 'unsupported' };
  return { type: 'normalized', sourceRecords };
}

export const awarioAdapter: ProviderAdapter = {
  name: 'awario',
  isConfigured: ({ config }) => Boolean(config?.enabled),
  normalizeCallback: (ctx) =>
    normalizeMentions('awario', 'social_mention', ctx),
};

export const trigifyAdapter: ProviderAdapter = {
  name: 'trigify',
  isConfigured: ({ config }) => Boolean(config?.enabled),
  normalizeCallback: (ctx) => normalizeMentions('trigify', 'lead_signal', ctx),
};

export const forumscoutAdapter: ProviderAdapter = {
  name: 'forumscout',
  isConfigured: ({ config }) => Boolean(config?.enabled),
  normalizeCallback: (ctx) =>
    normalizeMentions('forumscout', 'forum_post', ctx),
};

// re-exported helper for potential reuse/testing
export { pick };
