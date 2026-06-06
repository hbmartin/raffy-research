import { Result } from '@swan-io/boxed';

import { fetchJson, fetchText } from './http';
import type {
  ProviderAdapter,
  ProviderDailyContext,
} from '../../application/ports/provider-adapter';
import type { SourceRecordWriteInput } from '../../domain/source';

const competitorDomains = (ctx: ProviderDailyContext): string[] =>
  ctx.competitors
    .filter(
      (competitor) => competitor.state === 'accepted' && competitor.domain
    )
    .map((competitor) => competitor.domain as string);

/**
 * Ahrefs: domain rating / backlink momentum per tracked competitor domain.
 * Stores the raw API response as an SEO source record for the synthesizer.
 */
export const ahrefsAdapter: ProviderAdapter = {
  name: 'ahrefs',
  isConfigured: ({ credential }) => Boolean(credential),
  async runDailyIngest(ctx) {
    if (!ctx.credential)
      return Result.Ok({ sourceRecords: [], searchResults: [] });
    const sourceRecords: SourceRecordWriteInput[] = [];
    const date = ctx.now.toISOString().slice(0, 10);

    for (const domain of competitorDomains(ctx)) {
      const response = await fetchJson(
        'ahrefs',
        `https://api.ahrefs.com/v3/site-explorer/domain-rating?target=${encodeURIComponent(domain)}&date=${date}`,
        { headers: { Authorization: `Bearer ${ctx.credential}` } }
      );
      if (response.isError()) {
        ctx.logger.warn({
          event: 'intelligence.ingest.provider_error',
          details: { provider: 'ahrefs', domain },
        });
        continue;
      }
      sourceRecords.push({
        workspaceId: ctx.workspace.id,
        providerName: 'ahrefs',
        sourceType: 'seo_report',
        sourceSubtype: 'domain_rating',
        sourceName: `Ahrefs domain rating: ${domain}`,
        domain,
        externalUrl: `https://${domain}`,
        title: `Ahrefs domain rating for ${domain}`,
        contentText: JSON.stringify(response.get()),
        rawPayload: response.get(),
        metadata: { domain, date },
      });
    }
    return Result.Ok({ sourceRecords, searchResults: [] });
  },
};

/**
 * SEMrush: domain ranks / search visibility per tracked competitor domain.
 * SEMrush returns CSV text, stored verbatim as an SEO source record.
 */
export const semrushAdapter: ProviderAdapter = {
  name: 'semrush',
  isConfigured: ({ credential }) => Boolean(credential),
  async runDailyIngest(ctx) {
    if (!ctx.credential)
      return Result.Ok({ sourceRecords: [], searchResults: [] });
    const sourceRecords: SourceRecordWriteInput[] = [];

    for (const domain of competitorDomains(ctx)) {
      // SEMrush SEO API requires credentials as the `key` query parameter.
      // Keep provider HTTP helpers from logging full URLs for this adapter.
      const response = await fetchText(
        'semrush',
        `https://api.semrush.com/?type=domain_ranks&key=${encodeURIComponent(ctx.credential)}&domain=${encodeURIComponent(domain)}&database=us`
      );
      if (response.isError()) {
        ctx.logger.warn({
          event: 'intelligence.ingest.provider_error',
          details: { provider: 'semrush', domain },
        });
        continue;
      }
      const text = response.get();
      if (text.trimStart().startsWith('ERROR:')) {
        ctx.logger.warn({
          event: 'intelligence.ingest.provider_error',
          details: { provider: 'semrush', domain, error: text },
        });
        continue;
      }
      sourceRecords.push({
        workspaceId: ctx.workspace.id,
        providerName: 'semrush',
        sourceType: 'seo_report',
        sourceSubtype: 'domain_ranks',
        sourceName: `SEMrush domain ranks: ${domain}`,
        domain,
        externalUrl: `https://${domain}`,
        title: `SEMrush domain ranks for ${domain}`,
        contentText: text,
        rawPayload: text,
        metadata: { domain },
      });
    }
    return Result.Ok({ sourceRecords, searchResults: [] });
  },
};
