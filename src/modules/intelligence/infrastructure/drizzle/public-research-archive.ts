import { Result } from '@swan-io/boxed';
import { and, asc, eq, sql } from 'drizzle-orm';
import { createHash } from 'node:crypto';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { Database } from '@/modules/kernel/infrastructure/db/types';

import {
  providerConfig,
  sourceRecord,
  weeklyReport,
  weeklyReportSource,
  workspace,
} from './schema';
import { getProviderCredential } from '../config/runtime';
import { collectCitedSourceIds } from '../../domain/report-data';
import { normalizeHttpUrl } from '../../domain/url';

const publicProviders = new Set([
  'exa',
  'apify',
  'awario',
  'trigify',
  'forumscout',
  'visualping',
  'distill',
  'semrush',
  'ahrefs',
]);
const isPublicEvidenceUrl = (value: string): boolean => {
  const normalized = normalizeHttpUrl(value);
  if (!normalized) return false;
  const url = new URL(normalized);
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  const parts = host.split('.').map(Number);
  const privateIpv4 =
    parts.length === 4 &&
    parts.every(Number.isInteger) &&
    (parts[0] === 0 ||
      parts[0] === 10 ||
      parts[0] === 127 ||
      (parts[0] === 169 && parts[1] === 254) ||
      (parts[0] === 192 && parts[1] === 168) ||
      (parts[0] === 172 && parts[1]! >= 16 && parts[1]! <= 31));
  return (
    !url.username &&
    !url.password &&
    host !== 'localhost' &&
    !host.endsWith('.local') &&
    !host.endsWith('.internal') &&
    !host.endsWith('.localhost') &&
    !privateIpv4 &&
    host !== '::1' &&
    !host.startsWith('::ffff:') &&
    !/^(?:f[cd][0-9a-f]{2}|fe[89ab][0-9a-f]):/i.test(host)
  );
};
const canonicalEvidenceUrl = (value: string): string => {
  const url = new URL(normalizeHttpUrl(value)!);
  url.hash = '';
  const trackingKeys = Array.from(url.searchParams.keys()).filter((key) =>
    /^utm_|^(?:fbclid|gclid|msclkid)$/i.test(key)
  );
  for (const key of trackingKeys) url.searchParams.delete(key);
  url.searchParams.sort();
  return url.toString();
};
type SourceRow = typeof sourceRecord.$inferSelect;
export function isPublicResearchSource(
  source: Pick<
    SourceRow,
    | 'providerName'
    | 'sourceType'
    | 'sourceSubtype'
    | 'metadata'
    | 'externalUrl'
    | 'contentText'
  >
): boolean {
  if (
    ['slack', 'notion'].includes(source.providerName) ||
    /internal|private|note/i.test(
      `${source.sourceType} ${source.sourceSubtype ?? ''}`
    ) ||
    source.metadata?.visibility === 'private'
  )
    return false;
  return Boolean(
    (publicProviders.has(source.providerName) ||
      source.metadata?.visibility === 'public') &&
    source.externalUrl &&
    isPublicEvidenceUrl(source.externalUrl) &&
    source.contentText?.trim()
  );
}
const evidenceIdentity = (url: string, content: string) =>
  `body:${createHash('sha256')
    .update(content.trim().toLowerCase().replace(/\s+/g, ' ') || url)
    .digest('hex')}`;
// Preserve raw captures; scoring shares an identity for one page or syndicated body.
export function deduplicatePublicCaptures<
  T extends {
    identity: string;
    url: string;
    content: string;
    publishedAt: string;
  },
>(captures: T[]): T[] {
  const parent = captures.map((_, i) => i);
  const root = (i: number): number =>
    parent[i] === i ? i : (parent[i] = root(parent[i]!));
  const urls = new Map<string, number>();
  const bodies = new Map<string, number>();
  const shingles = captures.map((s) => {
    const words = s.content
      .toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ')
      .split(/\s+/)
      .filter(Boolean);
    return words.length < 40
      ? new Set<string>()
      : new Set(
          words.slice(0, -4).map((_, i) => words.slice(i, i + 5).join(' '))
        );
  });
  captures.forEach((s, i) => {
    const canonicalUrl = canonicalEvidenceUrl(s.url);
    for (const old of [urls.get(canonicalUrl), bodies.get(s.identity)])
      if (old !== undefined) parent[root(i)] = root(old);
    urls.set(canonicalUrl, i);
    bodies.set(s.identity, i);
    if (shingles[i]!.size)
      for (let j = 0; j < i; j++) {
        if (!shingles[j]!.size || root(i) === root(j)) continue;
        const intersection = [...shingles[i]!].filter((word) =>
          shingles[j]!.has(word)
        ).length;
        const union = shingles[i]!.size + shingles[j]!.size - intersection;
        if (intersection / union >= 0.9) parent[root(i)] = root(j);
      }
  });
  const dates = new Map<number, string>();
  captures.forEach((s, i) => {
    const group = root(i);
    const date = dates.get(group);
    if (!date || s.publishedAt < date) dates.set(group, s.publishedAt);
  });
  return captures.map((s, i) => ({
    ...s,
    identity: `origin:${canonicalEvidenceUrl(captures[root(i)]!.url)}`,
    publishedAt: dates.get(root(i))!,
  }));
}
export function createPublicResearchArchive(db: Database) {
  const error = (cause: unknown) =>
    new AppError({
      code: 'PUBLIC_RESEARCH_FAILED',
      category: 'system',
      status: 502,
      message: 'Public research evidence could not be loaded',
      cause,
    });
  const mapSource = (s: SourceRow, reportIds: string[] = []) => ({
    id: s.id,
    identity: evidenceIdentity(s.externalUrl!, s.contentText!),
    url: normalizeHttpUrl(s.externalUrl)!,
    title: s.title ?? s.externalUrl!,
    content: s.contentText!,
    publishedAt: (s.publishedAt ?? s.capturedAt).toISOString(),
    capturedAt: s.capturedAt.toISOString(),
    reportIds,
    authority: 0.75,
    newsletterResearch: s.metadata?.newsletterResearch === true,
    researchJobId:
      typeof s.metadata?.newsletterJobId === 'string'
        ? s.metadata.newsletterJobId
        : undefined,
    junk: s.relevanceLabel === 'junk',
    retracted: s.metadata?.retracted === true,
  });
  type ArchiveData = {
    workspaceId: string;
    audienceSuggestion: string;
    reports: {
      id: string;
      publishedAt: string;
      periodStart: string;
      sourceIds: string[];
    }[];
    sources: ReturnType<typeof mapSource>[];
  };
  return {
    async read(
      workspaceId: string
    ): Promise<
      Result<ArchiveData | { type: 'workspace_not_found' }, AppError>
    > {
      try {
        const [workspaces, reports, captures, associations] = await Promise.all(
          [
            db.select().from(workspace).where(eq(workspace.id, workspaceId)),
            db
              .select()
              .from(weeklyReport)
              .where(
                and(
                  eq(weeklyReport.workspaceId, workspaceId),
                  eq(weeklyReport.status, 'published')
                )
              )
              .orderBy(
                asc(weeklyReport.periodStart),
                asc(weeklyReport.publishedAt)
              ),
            db
              .select()
              .from(sourceRecord)
              .where(eq(sourceRecord.workspaceId, workspaceId))
              .orderBy(asc(sourceRecord.capturedAt), asc(sourceRecord.id)),
            db
              .select()
              .from(weeklyReportSource)
              .where(eq(weeklyReportSource.workspaceId, workspaceId)),
          ]
        );
        const ws = workspaces[0];
        if (!ws) return Result.Ok({ type: 'workspace_not_found' as const });
        const records = reports.map((r) => ({
          id: r.id,
          publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
          periodStart: r.periodStart.toISOString(),
          sourceIds: [
            ...new Set([
              ...collectCitedSourceIds(r.reportData),
              ...(r.reportData?.source_library.map((s) => s.source_id) ?? []),
              ...associations
                .filter((a) => a.reportId === r.id)
                .map((a) => a.sourceRecordId),
            ]),
          ],
        }));
        return Result.Ok({
          workspaceId,
          audienceSuggestion: `Busy ${ws.subcategory} industry insiders${ws.icp ? `, including ${ws.icp}` : ''}, seeking useful synthesis of conversations, innovations, and their practical implications.`,
          reports: records,
          sources: deduplicatePublicCaptures(
            captures.filter(isPublicResearchSource).map((s) =>
              mapSource(
                s,
                records
                  .filter((r) => r.sourceIds.includes(s.id))
                  .map((r) => r.id)
              )
            )
          ),
        });
      } catch (cause) {
        return Result.Error(error(cause));
      }
    },
    async research(input: {
      workspaceId: string;
      jobId: string;
      queries: string[];
      pages: number;
      timeoutMs: number;
    }): Promise<Result<ReturnType<typeof mapSource>[], AppError>> {
      try {
        const configs = await db
          .select()
          .from(providerConfig)
          .where(
            and(
              eq(providerConfig.workspaceId, input.workspaceId),
              eq(providerConfig.providerName, 'exa'),
              eq(providerConfig.enabled, true)
            )
          );
        const credential = getProviderCredential(
          configs[0]?.credentialsRef ?? null
        );
        if (!credential)
          return Result.Error(
            new AppError({
              code: 'NEWSLETTER_RESEARCH_NOT_CONFIGURED',
              category: 'system',
              status: 503,
              message:
                'Enable and configure Exa public research for this Workspace',
            })
          );
        const signal = AbortSignal.timeout(Math.max(1, input.timeoutMs));
        const prior = await db
          .select()
          .from(sourceRecord)
          .where(
            and(
              eq(sourceRecord.workspaceId, input.workspaceId),
              sql`${sourceRecord.metadata}->>'newsletterJobId' = ${input.jobId}`
            )
          );
        const sources: ReturnType<typeof mapSource>[] = prior
          .filter(isPublicResearchSource)
          .map((s) => mapSource(s));
        const identities = new Set(sources.map((s) => s.identity));
        for (const query of input.queries.slice(0, 3)) {
          if (sources.length >= input.pages) break;
          const response = await fetch('https://api.exa.ai/search', {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': credential,
            },
            body: JSON.stringify({
              query,
              numResults: Math.min(10, input.pages - sources.length),
              contents: { text: true },
            }),
            signal,
          });
          if (!response.ok)
            return Result.Error(
              error(`Research provider returned ${response.status}`)
            );
          const payload = (await response.json()) as {
            results?: {
              id?: string;
              url?: string;
              title?: string;
              text?: string;
              publishedDate?: string;
            }[];
          };
          for (const result of payload.results ?? []) {
            if (
              !result.url ||
              !isPublicEvidenceUrl(result.url) ||
              !result.text?.trim() ||
              sources.length >= input.pages
            )
              continue;
            const identity = evidenceIdentity(result.url, result.text);
            if (identities.has(identity)) continue;
            identities.add(identity);
            const rows = await db
              .insert(sourceRecord)
              .values({
                workspaceId: input.workspaceId,
                providerName: 'exa',
                providerSourceId: result.id ?? null,
                sourceType: 'web_page',
                sourceUrl: normalizeHttpUrl(result.url),
                externalUrl: normalizeHttpUrl(result.url),
                title: result.title ?? result.url,
                contentText: result.text,
                publishedAt:
                  result.publishedDate &&
                  !Number.isNaN(Date.parse(result.publishedDate))
                    ? new Date(result.publishedDate)
                    : null,
                metadata: {
                  visibility: 'public',
                  newsletterResearch: true,
                  newsletterJobId: input.jobId,
                  query,
                },
                rawPayload: result,
              })
              .returning();
            if (rows[0]) sources.push(mapSource(rows[0]));
          }
        }
        return Result.Ok(deduplicatePublicCaptures(sources));
      } catch (cause) {
        return Result.Error(error(cause));
      }
    },
  };
}
