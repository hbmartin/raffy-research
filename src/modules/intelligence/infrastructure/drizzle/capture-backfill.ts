import { Result } from '@swan-io/boxed';
import { asc, eq, sql } from 'drizzle-orm';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { toWorkspaceId } from '@/modules/kernel/domain/ids';
import type { Database } from '@/modules/kernel/infrastructure/db/types';

import { captureFingerprints } from './capture-fingerprints';
import {
  captureObservation,
  captureVersion,
  evidenceEquivalenceReview,
  evidenceGroup,
  evidenceJudgment,
  sourceRecord,
} from './schema';
import { copyGroups } from '../../domain/evidence-equivalence';

/** Add derived indexes without rewriting capture payloads, dates or direct judgments. */
export async function backfillCaptureHistory(
  db: Database
): Promise<ApplicationResult<{ type: 'backfilled'; captures: number }>> {
  try {
    if (!db.$runInTransaction)
      throw new AppError({
        code: 'CAPTURE_BACKFILL_FAILED',
        category: 'system',
        status: 500,
        message: 'Transactional database required',
      });
    return Result.Ok(
      await db.$runInTransaction(async (tx) => {
        const captures = await tx
          .select()
          .from(sourceRecord)
          .orderBy(asc(sourceRecord.capturedAt), asc(sourceRecord.id));
        const relationships = await tx.select().from(evidenceEquivalenceReview);
        const indexed = captures.map((source) => ({
          source,
          hashes: captureFingerprints({
            ...source,
            workspaceId: toWorkspaceId(source.workspaceId),
          }),
        }));
        const groups = copyGroups(
          indexed.map(({ source, hashes }) => ({
            id: source.id,
            baseKey: `${source.workspaceId}:${hashes.equivalenceKey ?? `capture:${source.id}`}`,
          })),
          relationships
        );
        if (groups.conflicts.length)
          throw new AppError({
            code: 'EQUIVALENCE_MIGRATION_CONFLICT',
            category: 'system',
            status: 409,
            message:
              'Historical equivalence decisions conflict. Resolve the listed decisions before migration.',
            details: { conflicts: groups.conflicts },
          });
        await tx.delete(evidenceGroup);
        for (const source of captures) {
          const hashes = captureFingerprints({
            ...source,
            workspaceId: toWorkspaceId(source.workspaceId),
          });
          const identity = groups.memberships
            .get(source.id)!
            .slice(source.workspaceId.length + 1);
          await tx
            .update(sourceRecord)
            .set({
              canonicalUrl: hashes.canonicalUrl,
              contentFingerprint: hashes.contentFingerprint,
              contentLength: source.contentText?.length ?? 0,
              normalizedFingerprint: hashes.normalizedFingerprint,
              similarityBucket: hashes.similarityBucket,
              equivalenceKey: hashes.equivalenceKey ?? `capture:${source.id}`,
              evidenceIdentity: identity,
              updatedAt: source.updatedAt,
            })
            .where(eq(sourceRecord.id, source.id));
          if (hashes.versionKey)
            await tx
              .insert(captureVersion)
              .values({
                workspaceId: source.workspaceId,
                providerName: source.providerName,
                versionKey: hashes.versionKey,
                sourceRecordId: source.id,
              })
              .onConflictDoNothing();
          await tx
            .insert(captureObservation)
            .values({
              workspaceId: source.workspaceId,
              providerName: source.providerName,
              sourceRecordId: source.id,
              kind:
                source.metadata?.newsletterResearch === true
                  ? 'research'
                  : 'backfill',
              jobId:
                typeof source.metadata?.newsletterJobId === 'string'
                  ? source.metadata.newsletterJobId
                  : null,
              observationKey: `backfill:${source.id}`,
              observedAt: source.capturedAt,
              rawPayload: source.rawPayload,
              metadata: source.metadata ?? {},
            })
            .onConflictDoNothing();
          if (source.labeledAt || source.relevanceLabel)
            await tx
              .insert(evidenceJudgment)
              .values({
                id: `backfill:${source.id}`,
                workspaceId: source.workspaceId,
                sourceRecordId: source.id,
                label: source.relevanceLabel,
                judgedAt: source.labeledAt ?? source.updatedAt,
              })
              .onConflictDoNothing();
          await tx
            .insert(evidenceGroup)
            .values({
              id: `${source.workspaceId}:${identity}`,
              workspaceId: source.workspaceId,
              identity,
              representativeId: source.id,
              publicationDate: source.publishedAt ?? source.capturedAt,
            })
            .onConflictDoUpdate({
              target: evidenceGroup.id,
              set: {
                publicationDate: sql`least(${evidenceGroup.publicationDate}, ${(source.publishedAt ?? source.capturedAt).toISOString()}::timestamptz)`,
                representativeId: sql`case when length(coalesce((select "contentText" from "sourceRecord" where id = ${evidenceGroup.representativeId}), '')) < ${source.contentText?.length ?? 0} then ${source.id} else ${evidenceGroup.representativeId} end`,
              },
            });
        }
        return { type: 'backfilled' as const, captures: captures.length };
      })
    );
  } catch (cause) {
    if (cause instanceof AppError) return Result.Error(cause);
    return Result.Error(
      new AppError({
        code: 'CAPTURE_BACKFILL_FAILED',
        category: 'system',
        status: 500,
        message: 'Capture history backfill failed',
        cause,
      })
    );
  }
}
