import { Result } from '@swan-io/boxed';

import type { JsonValue } from '@/modules/kernel/domain/json';

import { asArray, asObject, asString, toDate } from './json-access';
import type {
  CallbackNormalization,
  ProviderAdapter,
  ProviderCallbackContext,
} from '../../application/ports/provider-adapter';
import type { SourceRecordWriteInput } from '../../domain/source';

const getMentionItems = (
  normalizedItems: JsonValue[],
  hasKnownKeys: boolean,
  payload: JsonValue
): JsonValue[] => {
  if (normalizedItems.length > 0) return normalizedItems;
  if (hasKnownKeys) return [];
  return [payload];
};

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
  const hasKnownKeys =
    Object.hasOwn(root, 'mentions') ||
    Object.hasOwn(root, 'results') ||
    Object.hasOwn(root, 'items') ||
    Object.hasOwn(root, 'data');
  const normalizedItems = asArray(
    root.mentions ?? root.results ?? root.items ?? root.data
  );
  const items = getMentionItems(normalizedItems, hasKnownKeys, ctx.payload);

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

  if (sourceRecords.length === 0) {
    return hasKnownKeys
      ? { type: 'normalized', sourceRecords: [] }
      : { type: 'unsupported' };
  }
  return { type: 'normalized', sourceRecords };
}

export const awarioAdapter: ProviderAdapter = {
  name: 'awario',
  isConfigured: ({ config }) => Boolean(config?.enabled),
  normalizeCallback: (ctx) =>
    Result.Ok(normalizeMentions('awario', 'social_mention', ctx)),
};

export const trigifyAdapter: ProviderAdapter = {
  name: 'trigify',
  isConfigured: ({ config }) => Boolean(config?.enabled),
  normalizeCallback: (ctx) =>
    Result.Ok(normalizeMentions('trigify', 'lead_signal', ctx)),
};

export const forumscoutAdapter: ProviderAdapter = {
  name: 'forumscout',
  isConfigured: ({ config }) => Boolean(config?.enabled),
  normalizeCallback: (ctx) =>
    Result.Ok(normalizeMentions('forumscout', 'forum_post', ctx)),
};
