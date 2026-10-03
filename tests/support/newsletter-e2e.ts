import { Result } from '@swan-io/boxed';
import { randomUUID } from 'node:crypto';

import {
  createPublicResearchArchive,
  createSourceRepository,
} from '@/modules/intelligence/testing';
import { toWorkspaceId } from '@/modules/kernel';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { GeneratedId } from '@/modules/kernel/domain/ids';
import { createDbClient } from '@/modules/kernel/infrastructure/db/client';
import {
  createNewsletterRepository,
  createNewsletterWorker,
} from '@/modules/newsletter/testing';

import {
  articleFixture,
  auditFixture,
  finishNewsletter,
  newsletterProfile,
  requireOk,
  sourceFixture,
  stateFixture,
} from './newsletter';

// Only the disposable database started by the E2E fixture is touched.
export async function seedNewsletterE2e(
  configuration: { databaseUrl?: string } = {}
) {
  const databaseUrl = configuration.databaseUrl ?? process.env.E2E_DATABASE_URL;
  if (!databaseUrl)
    throw new Error('The disposable E2E fixture must provide E2E_DATABASE_URL');
  const url = new URL(databaseUrl);
  if (!['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))
    throw new Error('Newsletter E2E seeding requires a local fixture database');
  const db = createDbClient({
    url: databaseUrl,
    driver: 'node-pg',
  });
  const result = await db.$client.query<{ id: string; workspaceId: string }>(
    'select "id", "workspaceId" from "weeklyReport" where "status" = $1 order by "periodStart" desc, "publishedAt" desc limit 1',
    ['published']
  );
  const report = result.rows[0];
  if (!report) throw new Error('Expected seeded report');
  const capture = requireOk(
    await createSourceRepository({ db }).captureSourceRecord({
      record: {
        workspaceId: toWorkspaceId(report.workspaceId),
        providerName: 'exa',
        sourceType: 'web_page',
        externalUrl: sourceFixture.url,
        title: sourceFixture.title,
        contentText: sourceFixture.content,
        publishedAt: new Date(sourceFixture.publishedAt),
        capturedAt: new Date(),
        metadata: { visibility: 'public' },
      },
      observation: { kind: 'direct' },
    })
  );
  const sourceId = capture.sourceRecord.id;
  const sourceIds = [sourceId];
  const reader = await db.$client.query<{ id: string }>(
    'select id from "user" where email = $1',
    ['user@user.com']
  );
  const operatorId = reader.rows[0]?.id;
  if (!operatorId) throw new Error('Expected seeded app reader');
  const state = stateFixture();
  state.profile!.runtime.localOperatorId = operatorId;
  state.latestReportId = report.id;
  state.processedReports = [report.id];
  state.sources[0]!.id = sourceId;
  state.sources[0]!.publishedAt = sourceFixture.publishedAt;
  state.sources[0]!.reportIds = [report.id];
  state.angles[0]!.sourceIds = [sourceId];
  state.topics[0]!.sourceIds = [sourceId];
  const article = structuredClone(articleFixture);
  article.claims[0]!.sourceIds = [sourceId];
  article.claims[0]!.excerpts[0]!.sourceId = sourceId;
  state.angles[0]!.claims = article.claims;
  const repository = createNewsletterRepository(db);
  requireOk(
    await repository.mutate(report.workspaceId, (current) => {
      Object.assign(current, state);
      return Result.Ok({ value: { type: 'seeded' as const } });
    })
  );
  const worker = createNewsletterWorker({
    localOperatorId: operatorId,
    repository,
    archive: createPublicResearchArchive(db),
    clock: { now: () => new Date() },
    idGenerator: { createId: () => randomUUID() as GeneratedId },
    model: {
      async generate({ stage }) {
        if (stage.includes('audit'))
          return Result.Ok(JSON.stringify(auditFixture));
        if (stage === 'tracking')
          return Result.Ok(
            JSON.stringify({
              topics: state.topics,
              angles: state.angles,
              sourceAssessments: [
                {
                  sourceId,
                  authority: 1,
                  explanation: 'Captured primary study.',
                },
              ],
            })
          );
        return Result.Ok(JSON.stringify(article));
      },
    },
  });
  return {
    db,
    report,
    sourceId,
    state,
    profile: newsletterProfile,
    repository,
    finish: () => finishNewsletter(worker),
    async seedPossibleDuplicate() {
      const changed = requireOk(
        await createSourceRepository({ db }).captureSourceRecord({
          record: {
            workspaceId: toWorkspaceId(report.workspaceId),
            providerName: 'exa',
            sourceType: 'web_page',
            externalUrl: 'https://example.org/study-revision',
            title: 'Study revision for comparison',
            contentText: `${sourceFixture.content}\nA material revision needs an editorial decision.`,
            publishedAt: new Date(sourceFixture.publishedAt),
            capturedAt: new Date(),
            metadata: { visibility: 'public' },
          },
          observation: { kind: 'direct' },
        })
      );
      const changedId = changed.sourceRecord.id;
      sourceIds.push(changedId);
      await db.$client.query(
        'insert into "evidenceEquivalenceReview" (id, "workspaceId", "leftSourceId", "rightSourceId", status) values ($1, $2, $3, $4, $5)',
        [randomUUID(), report.workspaceId, sourceId, changedId, 'suggested']
      );
      return changedId;
    },
    async failNext() {
      const failing = createNewsletterWorker({
        localOperatorId: operatorId,
        repository,
        archive: createPublicResearchArchive(db),
        clock: { now: () => new Date() },
        idGenerator: { createId: () => randomUUID() as GeneratedId },
        model: {
          async generate() {
            return Result.Error(
              new AppError({
                code: 'NEWSLETTER_GENERATION_FAILED',
                category: 'system',
                status: 502,
                message: 'Deterministic generation outage',
              })
            );
          },
        },
      });
      return requireOk(await failing.runNext('local'));
    },
    async close() {
      await db.$client.query(
        'delete from "newsletterHistory" where "workspaceId"=$1',
        [report.workspaceId]
      );
      await db.$client.query(
        'delete from "newsletterEvidence" where "workspaceId"=$1',
        [report.workspaceId]
      );
      await db.$client.query(
        'delete from "newsletterJob" where "workspaceId"=$1',
        [report.workspaceId]
      );
      await db.$client.query(
        'delete from "newsletterWorkspace" where "workspaceId"=$1',
        [report.workspaceId]
      );
      for (const id of sourceIds) {
        await db.$client.query(
          'delete from "evidenceEquivalenceDecision" where "reviewId" in (select id from "evidenceEquivalenceReview" where "leftSourceId"=$1 or "rightSourceId"=$1)',
          [id]
        );
        await db.$client.query(
          'delete from "captureObservation" where "sourceRecordId"=$1',
          [id]
        );
        await db.$client.query(
          'delete from "captureVersion" where "sourceRecordId"=$1',
          [id]
        );
        await db.$client.query(
          'delete from "evidenceJudgment" where "sourceRecordId"=$1',
          [id]
        );
        await db.$client.query(
          'delete from "evidenceEquivalenceReview" where "leftSourceId"=$1 or "rightSourceId"=$1',
          [id]
        );
        await db.$client.query(
          'delete from "evidenceGroup" where "representativeId"=$1',
          [id]
        );
      }
      await db.$client.query(
        'delete from "sourceRecord" where "id"=any($1::text[])',
        [sourceIds]
      );
      await db.$close();
    },
  };
}
