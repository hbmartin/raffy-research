import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { ProviderConfig } from '@/modules/kernel/infrastructure/db/schema';

import type {
  NormalizedSearchResultInput,
  NormalizedSourceInput,
  ProviderAdapter,
  ProviderAdapterContext,
  ProviderCallbackContext,
  ProviderIngestionResult,
} from '../../application/ports/provider-adapter';
import type { ProviderName } from '../../domain/intelligence';

const providerSourceTypes = {
  ahrefs: 'seo',
  apify: 'web',
  awario: 'social',
  distill: 'web_monitor',
  exa: 'web',
  forumscout: 'forum',
  notion: 'internal_note',
  semrush: 'seo',
  slack: 'internal_note',
  trigify: 'social',
  visualping: 'web_monitor',
} satisfies Record<ProviderName, string>;

const callbackArrayKeys = ['items', 'results', 'records', 'data'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const getString = (
  record: Record<string, unknown>,
  keys: readonly string[]
): string | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return undefined;
};

const getNumber = (
  record: Record<string, unknown>,
  keys: readonly string[]
): number | undefined => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (
      typeof value === 'string' &&
      value.trim() &&
      Number.isFinite(Number(value))
    ) {
      return Number(value);
    }
  }
  return undefined;
};

const parseDate = (value: string | undefined): Date | null => {
  if (!value) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
};

const externalUrlFromRecord = (record: Record<string, unknown>) =>
  getString(record, [
    'url',
    'external_url',
    'externalUrl',
    'link',
    'permalink',
    'href',
  ]);

const domainFromUrl = (url: string | undefined): string | null => {
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
};

const payloadItems = (payload: unknown): Record<string, unknown>[] => {
  if (Array.isArray(payload)) return payload.filter(isRecord);
  if (!isRecord(payload)) return [];

  for (const key of callbackArrayKeys) {
    const value = payload[key];
    if (Array.isArray(value)) return value.filter(isRecord);
  }

  return [payload];
};

const readConfigString = (config: ProviderConfig, key: string) => {
  const value = config.config[key];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

const readConfigStringArray = (config: ProviderConfig, key: string) => {
  const value = config.config[key];
  return isStringArray(value) ? value : [];
};

function normalizeSources(input: {
  now: Date;
  payload: unknown;
  providerName: ProviderName;
}): NormalizedSourceInput[] {
  return payloadItems(input.payload).flatMap((item) => {
    const externalUrl = externalUrlFromRecord(item);
    const contentText = getString(item, [
      'content',
      'contentText',
      'text',
      'body',
      'snippet',
      'summary',
      'description',
    ]);

    if (!externalUrl && !contentText) return [];

    return [
      {
        providerSourceId:
          getString(item, [
            'id',
            'source_id',
            'sourceId',
            'providerSourceId',
          ]) ??
          externalUrl ??
          null,
        sourceType:
          getString(item, ['sourceType', 'source_type', 'type']) ??
          providerSourceTypes[input.providerName],
        sourceSubtype:
          getString(item, ['sourceSubtype', 'source_subtype', 'subtype']) ??
          null,
        sourceName:
          getString(item, [
            'sourceName',
            'source_name',
            'siteName',
            'source',
          ]) ?? null,
        sourceUrl:
          getString(item, ['sourceUrl', 'source_url', 'canonicalUrl']) ??
          externalUrl ??
          null,
        externalUrl: externalUrl ?? null,
        title: getString(item, ['title', 'name', 'headline']) ?? null,
        authorOrAccount:
          getString(item, [
            'author',
            'authorOrAccount',
            'account',
            'username',
          ]) ?? null,
        domain: domainFromUrl(externalUrl),
        publishedAt: parseDate(
          getString(item, [
            'publishedAt',
            'published_at',
            'createdAt',
            'created_at',
            'date',
          ])
        ),
        contentText: contentText ?? null,
        diffAddedText:
          getString(item, ['diffAddedText', 'diff_added_text', 'added']) ??
          null,
        diffRemovedText:
          getString(item, [
            'diffRemovedText',
            'diff_removed_text',
            'removed',
          ]) ?? null,
        rawPayload: item,
        metadata: { normalizedAt: input.now.toISOString() },
      },
    ];
  });
}

function normalizeSearchResults(input: {
  now: Date;
  payload: unknown;
  providerName: ProviderName;
  query: string;
}): NormalizedSearchResultInput[] {
  return payloadItems(input.payload).flatMap((item, index) => {
    const url = externalUrlFromRecord(item);
    if (!url) return [];

    return [
      {
        providerName: input.providerName,
        query: getString(item, ['query', 'searchQuery']) ?? input.query,
        resultRank: getNumber(item, ['rank', 'position']) ?? index + 1,
        title: getString(item, ['title', 'name', 'headline']) ?? null,
        snippet:
          getString(item, ['snippet', 'summary', 'description', 'text']) ??
          null,
        url,
        returnedAt: input.now,
        rawPayload: item,
        metadata: { normalizedAt: input.now.toISOString() },
      },
    ];
  });
}

export function normalizeProviderPayload(input: {
  now: Date;
  payload: unknown;
  providerName: ProviderName;
  query?: string;
}): Pick<ProviderIngestionResult, 'sourceRecords' | 'searchResults'> {
  const query = input.query ?? `${input.providerName} callback`;
  return {
    sourceRecords: normalizeSources(input),
    searchResults: normalizeSearchResults({ ...input, query }),
  };
}

export function createGenericProviderAdapter(
  providerName: ProviderName
): ProviderAdapter {
  return {
    providerName,
    async ingest(input: ProviderAdapterContext) {
      if (!input.providerConfig.enabled) {
        return {
          status: 'skipped',
          reason: 'provider_config_disabled',
          sourceRecords: [],
          searchResults: [],
        };
      }

      if (!input.credential) {
        return {
          status: 'skipped',
          reason: 'missing_provider_credentials',
          sourceRecords: [],
          searchResults: [],
        };
      }

      const fixturePayloads = readConfigStringArray(
        input.providerConfig,
        'fixturePayloads'
      );
      if (fixturePayloads.length > 0) {
        const normalized = fixturePayloads.flatMap(
          (payload) =>
            normalizeProviderPayload({
              now: input.now,
              payload: JSON.parse(payload) as unknown,
              providerName,
            }).sourceRecords
        );
        return {
          status: 'completed',
          sourceRecords: normalized,
          searchResults: [],
          metadata: { fixturePayloadCount: fixturePayloads.length },
        };
      }

      const endpointUrl = readConfigString(input.providerConfig, 'endpointUrl');
      if (!endpointUrl) {
        return {
          status: 'skipped',
          reason: 'missing_provider_endpoint',
          sourceRecords: [],
          searchResults: [],
        };
      }

      const query =
        readConfigStringArray(input.providerConfig, 'queries')[0] ??
        input.workspace.companyName;
      const response = await input.fetch(endpointUrl, {
        headers: {
          authorization: `Bearer ${input.credential}`,
          'content-type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new AppError({
          category: 'system',
          code: 'INTELLIGENCE_PROVIDER_INGEST_FAILED',
          message: `${providerName} ingestion failed with HTTP ${response.status}`,
          status: 502,
          details: { providerName, status: response.status },
        });
      }

      const payload = (await response.json()) as unknown;
      const normalized = normalizeProviderPayload({
        now: input.now,
        payload,
        providerName,
        query,
      });

      return { status: 'completed', ...normalized };
    },
    normalizeCallback(input: ProviderCallbackContext) {
      return {
        status: 'completed',
        ...normalizeProviderPayload({
          now: input.now,
          payload: input.payload,
          providerName: input.providerName,
        }),
      };
    },
  };
}
