import { Result } from '@swan-io/boxed';
import { and, asc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';

import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { toWorkspaceId } from '@/modules/kernel/domain/ids';
import type { Database } from '@/modules/kernel/infrastructure/db/types';

import { createAgentResearch } from './agent-research';
import { captureFingerprints, fingerprint } from './capture-fingerprints';
import { effectiveEvidenceLabel } from './effective-evidence';
import {
  captureObservation,
  evidenceEquivalenceDecision,
  evidenceEquivalenceReview,
  evidenceGroup,
  providerConfig,
  sourceRecord,
  weeklyReport,
  weeklyReportSource,
  workspace,
} from './schema';
import { SourceRepositoryDrizzle } from './source-repository-drizzle';
import { getProviderCredential } from '../config/runtime';
import {
  copyGroups,
  type EquivalenceConflict,
} from '../../domain/evidence-equivalence';
import type { SourceRecord } from '../../domain/source';
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
/** Compatibility helper for fixtures; production identities are persisted on insert. */
export function deduplicatePublicCaptures<
  T extends {
    identity: string;
    url: string;
    content: string;
    publishedAt: string;
  },
>(captures: T[]): T[] {
  const dates = new Map<string, string>();
  for (const source of captures) {
    const old = dates.get(source.identity);
    if (!old || source.publishedAt < old)
      dates.set(source.identity, source.publishedAt);
  }
  return captures.map((source) => ({
    ...source,
    publishedAt: dates.get(source.identity)!,
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
  const repository = new SourceRepositoryDrizzle(db);
  const mapSource = (
    s:
      | Pick<
          SourceRow,
          | 'id'
          | 'evidenceIdentity'
          | 'contentFingerprint'
          | 'externalUrl'
          | 'contentText'
          | 'title'
          | 'publishedAt'
          | 'capturedAt'
          | 'metadata'
          | 'relevanceLabel'
        >
      | SourceRecord,
    reportIds: string[] = []
  ) => ({
    id: s.id,
    identity: s.evidenceIdentity ?? `capture:${s.id}`,
    contentFingerprint: s.contentFingerprint ?? undefined,
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
      periodEnd: string;
      sourceIds: string[];
    }[];
    sources: (ReturnType<typeof mapSource> & {
      contentLength?: number;
      originPublishedAt?: string;
    })[];
  };
  return {
    async read(
      workspaceId: string,
      options: {
        sourceIds?: string[];
        reportIds?: string[];
        content?: boolean;
        now?: Date;
        jobId?: string;
        onlySourceIds?: boolean;
      } = {}
    ): Promise<
      Result<ArchiveData | { type: 'workspace_not_found' }, AppError>
    > {
      try {
        const cutoff = new Date(
          (options.now ?? new Date()).getTime() - 180 * 86_400_000
        );
        const [workspaces, reports] = await Promise.all([
          db
            .select({
              id: workspace.id,
              subcategory: workspace.subcategory,
              icp: workspace.icp,
            })
            .from(workspace)
            .where(eq(workspace.id, workspaceId)),
          db
            .select({
              id: weeklyReport.id,
              publishedAt: weeklyReport.publishedAt,
              createdAt: weeklyReport.createdAt,
              periodStart: weeklyReport.periodStart,
              periodEnd: weeklyReport.periodEnd,
              sourceIds: sql<
                string[]
              >`coalesce(jsonb_path_query_array(${weeklyReport.reportData}, '$.**.source_id'), '[]'::jsonb) || coalesce(jsonb_path_query_array(${weeklyReport.reportData}, '$.**.source_ids[*]'), '[]'::jsonb)`,
            })
            .from(weeklyReport)
            .where(
              and(
                eq(weeklyReport.workspaceId, workspaceId),
                eq(weeklyReport.status, 'published'),
                or(
                  and(
                    gte(weeklyReport.periodEnd, cutoff),
                    lte(weeklyReport.periodStart, options.now ?? new Date())
                  ),
                  inArray(
                    weeklyReport.id,
                    options.reportIds?.length ? options.reportIds : ['']
                  )
                )
              )
            )
            .orderBy(
              asc(weeklyReport.periodStart),
              asc(weeklyReport.publishedAt)
            ),
        ]);
        const ws = workspaces[0];
        if (!ws) return Result.Ok({ type: 'workspace_not_found' as const });
        const associations = reports.length
          ? await db
              .select({
                reportId: weeklyReportSource.reportId,
                sourceRecordId: weeklyReportSource.sourceRecordId,
              })
              .from(weeklyReportSource)
              .where(
                and(
                  eq(weeklyReportSource.workspaceId, workspaceId),
                  inArray(
                    weeklyReportSource.reportId,
                    reports.map((r) => r.id)
                  )
                )
              )
          : [];
        const records = reports.map((r) => ({
          id: r.id,
          publishedAt: (r.publishedAt ?? r.createdAt).toISOString(),
          periodStart: r.periodStart.toISOString(),
          periodEnd: r.periodEnd.toISOString(),
          sourceIds: [
            ...new Set([
              ...r.sourceIds.filter(
                (id): id is string => typeof id === 'string'
              ),
              ...associations
                .filter((a) => a.reportId === r.id)
                .map((a) => a.sourceRecordId),
            ]),
          ],
        }));
        const ids = options.onlySourceIds
          ? (options.sourceIds ?? [])
          : [
              ...new Set([
                ...records.flatMap((r) => r.sourceIds),
                ...(options.sourceIds ?? []),
              ]),
            ];
        const captures = await db
          .select({
            id: sourceRecord.id,
            evidenceIdentity: sourceRecord.evidenceIdentity,
            contentFingerprint: sourceRecord.contentFingerprint,
            externalUrl: sourceRecord.externalUrl,
            contentText:
              options.content === false
                ? sql<string>`''`
                : sourceRecord.contentText,
            hasContent: sql<boolean>`"sourceRecord"."normalizedFingerprint" is not null or ("sourceRecord"."contentLength" is null and length(trim(coalesce("sourceRecord"."contentText", ''))) > 0)`,
            title: sourceRecord.title,
            publishedAt: sourceRecord.publishedAt,
            contentLength: sql<number>`coalesce("sourceRecord"."contentLength", length(coalesce("sourceRecord"."contentText", '')))`,
            originPublishedAt: sql<string>`(select g."publicationDate" from "evidenceGroup" g where g."workspaceId" = "sourceRecord"."workspaceId" and g.identity = "sourceRecord"."evidenceIdentity")`,
            capturedAt: sourceRecord.capturedAt,
            metadata: sql<
              SourceRow['metadata']
            >`${sourceRecord.metadata} || jsonb_build_object('newsletterResearch', exists (select 1 from "captureObservation" o where o."sourceRecordId" = "sourceRecord".id and o.kind = 'research'), 'newsletterJobId', case when exists (select 1 from "captureObservation" o where o."sourceRecordId" = "sourceRecord".id and o."jobId" = ${options.jobId ?? null}) then ${options.jobId ?? null} else "sourceRecord".metadata->>'newsletterJobId' end)`,
            relevanceLabel: effectiveEvidenceLabel,
            providerName: sourceRecord.providerName,
            sourceType: sourceRecord.sourceType,
            sourceSubtype: sourceRecord.sourceSubtype,
          })
          .from(sourceRecord)
          .where(
            and(
              eq(sourceRecord.workspaceId, workspaceId),
              or(
                options.onlySourceIds
                  ? undefined
                  : gte(sourceRecord.capturedAt, cutoff),
                inArray(sourceRecord.id, ids.length ? ids : ['']),
                options.onlySourceIds
                  ? undefined
                  : sql`exists (select 1 from "captureObservation" o where o."sourceRecordId" = ${sourceRecord.id} and o."observedAt" >= ${cutoff.toISOString()}::timestamptz and o."kind" = 'research')`,
                options.jobId
                  ? sql`exists (select 1 from "captureObservation" o where o."sourceRecordId" = ${sourceRecord.id} and o."jobId" = ${options.jobId})`
                  : undefined
              )
            )
          )
          .orderBy(asc(sourceRecord.capturedAt), asc(sourceRecord.id));
        return Result.Ok({
          workspaceId,
          audienceSuggestion: `Busy ${ws.subcategory} industry insiders${ws.icp ? `, including ${ws.icp}` : ''}, seeking useful synthesis of conversations, innovations, and their practical implications.`,
          reports: records,
          sources: captures
            .filter((s) =>
              isPublicResearchSource({
                ...s,
                contentText: s.hasContent ? 'present' : '',
              })
            )
            .map((s) => ({
              ...mapSource(
                options.content === false ? { ...s, contentText: '' } : s,
                records
                  .filter((r) => r.sourceIds.includes(s.id))
                  .map((r) => r.id)
              ),
              contentLength: s.contentLength,
              originPublishedAt: s.originPublishedAt
                ? new Date(s.originPublishedAt).toISOString()
                : undefined,
            })),
        });
      } catch (cause) {
        return Result.Error(error(cause));
      }
    },
    async equivalenceReviews(workspaceId: string, before?: string, limit = 20) {
      try {
        const rows = await db
          .select({
            id: evidenceEquivalenceReview.id,
            leftSourceId: evidenceEquivalenceReview.leftSourceId,
            rightSourceId: evidenceEquivalenceReview.rightSourceId,
            status: evidenceEquivalenceReview.status,
            provenance: sql<
              import('../../domain/judgment').JudgmentProvenance | null
            >`(select provenance from "judgmentRecord" where "targetId" = ${evidenceEquivalenceReview.id} and "workspaceId" = ${evidenceEquivalenceReview.workspaceId} and kind = 'editorial' order by "createdAt" desc, id desc limit 1)`,
            leftTitle: sql<string>`coalesce((select title from "sourceRecord" where id = ${evidenceEquivalenceReview.leftSourceId}), 'Source')`,
            rightTitle: sql<string>`coalesce((select title from "sourceRecord" where id = ${evidenceEquivalenceReview.rightSourceId}), 'Source')`,
          })
          .from(evidenceEquivalenceReview)
          .where(
            and(
              eq(evidenceEquivalenceReview.workspaceId, workspaceId),
              before
                ? sql`${evidenceEquivalenceReview.id} > ${before}`
                : undefined
            )
          )
          .orderBy(asc(evidenceEquivalenceReview.id))
          .limit(limit + 1);
        return Result.Ok({
          type: 'reviews_found' as const,
          reviews: rows.slice(0, limit),
          nextCursor: rows.length > limit ? rows[limit - 1]!.id : null,
        });
      } catch (cause) {
        return Result.Error(error(cause));
      }
    },
    async decideEquivalence(input: {
      workspaceId: string;
      reviewId: string;
      actorId: string;
      provenance?: import('../../domain/judgment').JudgmentProvenance;
      action: 'confirm' | 'separate' | 'reverse';
    }): Promise<
      Result<
        | { type: 'saved' | 'not_found' | 'no_active_decision' }
        | EquivalenceConflict,
        AppError
      >
    > {
      try {
        if (!db.$runInTransaction)
          return Result.Error(error('Transactional database required'));
        return Result.Ok(
          await db.$runInTransaction(async (tx) => {
            await tx
              .select({ id: workspace.id })
              .from(workspace)
              .where(eq(workspace.id, input.workspaceId))
              .for('update');
            const [review] = await tx
              .select()
              .from(evidenceEquivalenceReview)
              .where(
                and(
                  eq(evidenceEquivalenceReview.workspaceId, input.workspaceId),
                  eq(evidenceEquivalenceReview.id, input.reviewId)
                )
              )
              .for('update');
            if (!review) return { type: 'not_found' as const };
            if (input.action === 'reverse' && review.status === 'suggested')
              return { type: 'no_active_decision' as const };
            const members = await tx
              .select()
              .from(sourceRecord)
              .where(
                and(
                  eq(sourceRecord.workspaceId, input.workspaceId),
                  inArray(sourceRecord.id, [
                    review.leftSourceId,
                    review.rightSourceId,
                  ])
                )
              );
            const left = members.find((s) => s.id === review.leftSourceId),
              right = members.find((s) => s.id === review.rightSourceId);
            if (!left || !right) return { type: 'not_found' as const };
            const affected = await tx
              .select({
                id: sourceRecord.id,
                baseKey: sourceRecord.equivalenceKey,
                identity: sourceRecord.evidenceIdentity,
              })
              .from(sourceRecord)
              .where(
                and(
                  eq(sourceRecord.workspaceId, input.workspaceId),
                  inArray(sourceRecord.evidenceIdentity, [
                    left.evidenceIdentity!,
                    right.evidenceIdentity!,
                  ])
                )
              );
            const ids = affected.map((member) => member.id);
            const relationships = await tx
              .select()
              .from(evidenceEquivalenceReview)
              .where(
                and(
                  eq(evidenceEquivalenceReview.workspaceId, input.workspaceId),
                  inArray(evidenceEquivalenceReview.leftSourceId, ids),
                  inArray(evidenceEquivalenceReview.rightSourceId, ids)
                )
              );
            if (input.action === 'confirm' && review.status === 'separate')
              return {
                type: 'equivalence_conflict' as const,
                message:
                  'Reverse the active separation before confirming this relationship.',
                blockingReviews: [review],
              };
            const status =
              input.action === 'confirm'
                ? ('confirmed' as const)
                : input.action === 'separate'
                  ? ('separate' as const)
                  : ('suggested' as const);
            const graph = copyGroups(
              affected.map((member) => ({
                id: member.id,
                baseKey: member.baseKey ?? `capture:${member.id}`,
              })),
              relationships.map((edge) =>
                edge.id === review.id ? { ...edge, status } : edge
              )
            );
            if (graph.conflicts.length)
              return {
                type: 'equivalence_conflict' as const,
                message:
                  input.action === 'separate'
                    ? 'These groups remain connected. Reverse the connecting confirmations first. Clear automatic copies cannot be split.'
                    : 'This confirmation contradicts an active separation. Reverse that decision first.',
                blockingReviews: [
                  ...new Map(
                    graph.conflicts
                      .flatMap((conflict) =>
                        input.action === 'separate'
                          ? conflict.confirmations
                          : [conflict.separation]
                      )
                      .map((edge) => [edge.id, edge])
                  ).values(),
                ],
              };
            const groups = new Map<string, string[]>();
            for (const [id, identity] of graph.memberships)
              groups.set(identity, [...(groups.get(identity) ?? []), id]);
            for (const [identity, memberIds] of groups)
              await tx
                .update(sourceRecord)
                .set({
                  evidenceIdentity: identity,
                  updatedAt: sql`${sourceRecord.updatedAt}`,
                })
                .where(
                  and(
                    eq(sourceRecord.workspaceId, input.workspaceId),
                    inArray(sourceRecord.id, memberIds)
                  )
                );
            const affectedIdentities = new Set([
              ...groups.keys(),
              left.evidenceIdentity,
              right.evidenceIdentity,
            ]);
            for (const groupIdentity of affectedIdentities) {
              if (!groupIdentity) continue;
              const grouped = await tx
                .select({
                  id: sourceRecord.id,
                  contentLength: sql<number>`length(coalesce(${sourceRecord.contentText}, ''))`,
                  date: sql<Date>`coalesce(${sourceRecord.publishedAt}, ${sourceRecord.capturedAt}) at time zone 'UTC'`,
                })
                .from(sourceRecord)
                .where(
                  and(
                    eq(sourceRecord.workspaceId, input.workspaceId),
                    eq(sourceRecord.evidenceIdentity, groupIdentity)
                  )
                );
              if (!grouped.length) {
                await tx
                  .delete(evidenceGroup)
                  .where(
                    and(
                      eq(evidenceGroup.workspaceId, input.workspaceId),
                      eq(evidenceGroup.identity, groupIdentity)
                    )
                  );
                continue;
              }
              const representative = grouped.sort(
                (a, b) =>
                  b.contentLength - a.contentLength || a.id.localeCompare(b.id)
              )[0]!;
              const date = grouped
                .map((s) => new Date(s.date))
                .sort((a, b) => a.getTime() - b.getTime())[0]!;
              await tx
                .insert(evidenceGroup)
                .values({
                  id: `${input.workspaceId}:${groupIdentity}`,
                  workspaceId: input.workspaceId,
                  identity: groupIdentity,
                  representativeId: representative.id,
                  publicationDate: date,
                })
                .onConflictDoUpdate({
                  target: evidenceGroup.id,
                  set: {
                    representativeId: representative.id,
                    publicationDate: date,
                  },
                });
            }
            await tx
              .update(evidenceEquivalenceReview)
              .set({
                status,
                actorId: input.actorId,
                decidedAt: new Date(),
              })
              .where(eq(evidenceEquivalenceReview.id, review.id));
            await tx.insert(evidenceEquivalenceDecision).values({
              workspaceId: input.workspaceId,
              reviewId: review.id,
              actorId: input.actorId,
              action: input.action,
            });
            const judgment = await createAgentResearch(tx).recordJudgment({
              workspaceId: input.workspaceId,
              targetId: review.id,
              kind: 'editorial',
              provenance: input.provenance ?? {
                origin: 'human',
                actorId: input.actorId,
              },
              payload: {
                action: input.action,
                leftSourceId: review.leftSourceId,
                rightSourceId: review.rightSourceId,
              },
            });
            if (judgment.isError()) throw judgment.getError();
            return { type: 'saved' as const };
          })
        );
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
      signal?: AbortSignal;
      deadline?: Date;
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
        const timeout = AbortSignal.timeout(Math.max(1, input.timeoutMs));
        const signal = input.signal
          ? AbortSignal.any([input.signal, timeout])
          : timeout;
        const prior = await db
          .select({ source: sourceRecord })
          .from(captureObservation)
          .innerJoin(
            sourceRecord,
            eq(captureObservation.sourceRecordId, sourceRecord.id)
          )
          .where(
            and(
              eq(sourceRecord.workspaceId, input.workspaceId),
              eq(captureObservation.jobId, input.jobId)
            )
          );
        const priorSources = prior
          .map((row) => row.source)
          .filter(isPublicResearchSource)
          .map((source) => mapSource(source));
        const sources: ReturnType<typeof mapSource>[] = [
          ...new Map(
            priorSources
              .sort((a, b) => a.content.length - b.content.length)
              .map((source) => [source.identity, source])
          ).values(),
        ];
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
            const hashes = captureFingerprints({
              workspaceId: toWorkspaceId(input.workspaceId),
              providerName: 'exa',
              sourceType: 'web_page',
              externalUrl: result.url,
              contentText: result.text,
            });
            const captured = await repository.captureSourceRecord({
              record: {
                workspaceId: toWorkspaceId(input.workspaceId),
                providerName: 'exa',
                providerSourceId: result.id,
                sourceType: 'web_page',
                sourceUrl: result.url,
                externalUrl: result.url,
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
              },
              observation: {
                kind: 'research',
                jobId: input.jobId,
                observationKey: fingerprint(
                  JSON.stringify([input.jobId, query, hashes.versionKey])
                ),
                metadata: { query, newsletterResearch: true },
              },
            });
            if (captured.isError()) return Result.Error(captured.getError());
            const mapped = {
              ...mapSource(captured.get().sourceRecord),
              newsletterResearch: true,
              researchJobId: input.jobId,
            };
            if (!identities.has(mapped.identity)) {
              identities.add(mapped.identity);
              sources.push(mapped);
            }
          }
        }
        return Result.Ok(sources.sort((a, b) => a.id.localeCompare(b.id)));
      } catch (cause) {
        if (input.signal?.aborted && input.signal.reason instanceof AppError)
          return Result.Error(input.signal.reason);
        return Result.Error(error(cause));
      }
    },
  };
}
