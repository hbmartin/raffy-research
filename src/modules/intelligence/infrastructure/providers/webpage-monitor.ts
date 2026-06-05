import { asObject, asString, pick } from './json-access';
import type {
  CallbackNormalization,
  ProviderAdapter,
  ProviderCallbackContext,
} from '../../application/ports/provider-adapter';
import type { SourceRecordWriteInput } from '../../domain/source';

/**
 * Generic webpage-monitor normalization for Visualping and Distill.io change
 * events. Both deliver an added/removed text diff which the report renders.
 */
function normalizeWebpageChange(
  provider: 'visualping' | 'distill',
  ctx: ProviderCallbackContext
): CallbackNormalization {
  const payload = asObject(ctx.payload);
  const url =
    asString(payload.url) ??
    asString(payload.uri) ??
    asString(pick(ctx.payload, 'link'));
  const added =
    asString(payload.added) ??
    asString(pick(asObject(payload.text), 'added')) ??
    asString(pick(asObject(payload.diff), 'added'));
  const removed =
    asString(payload.removed) ??
    asString(pick(asObject(payload.text), 'removed')) ??
    asString(pick(asObject(payload.diff), 'removed'));

  if (!url && !added && !removed) return { type: 'unsupported' };

  const record: SourceRecordWriteInput = {
    workspaceId: ctx.workspaceId,
    providerName: provider,
    providerSourceId: asString(payload.id) ?? asString(payload.jobId),
    sourceType: 'webpage_change',
    sourceName: asString(payload.name) ?? url,
    externalUrl: url,
    sourceUrl: url,
    domain: url ? safeHost(url) : null,
    title: asString(payload.name) ?? 'Webpage change detected',
    diffAddedText: added,
    diffRemovedText: removed,
    contentText: asString(payload.text) ?? asString(payload.summary),
    rawPayload: ctx.payload,
  };
  return { type: 'normalized', sourceRecords: [record] };
}

function safeHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

export const visualpingAdapter: ProviderAdapter = {
  name: 'visualping',
  isConfigured: ({ config }) => Boolean(config?.enabled),
  normalizeCallback: (ctx) => normalizeWebpageChange('visualping', ctx),
};

export const distillAdapter: ProviderAdapter = {
  name: 'distill',
  isConfigured: ({ config }) => Boolean(config?.enabled),
  normalizeCallback: (ctx) => normalizeWebpageChange('distill', ctx),
};
