import { Result } from '@swan-io/boxed';
import { randomUUID } from 'node:crypto';

import { createPublicResearchArchive } from '@/modules/intelligence/testing';
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
export async function seedNewsletterE2e() {
  const db = createDbClient({
    url: 'postgresql://postgres:postgres@127.0.0.1:54329/postgres',
    driver: 'node-pg',
  });
  const result = await db.$client.query<{ id: string; workspaceId: string }>(
    'select "id", "workspaceId" from "weeklyReport" where "status" = $1 order by "periodStart" desc, "publishedAt" desc limit 1',
    ['published']
  );
  const report = result.rows[0];
  if (!report) throw new Error('Expected seeded report');
  const sourceId = randomUUID();
  await db.$client.query(
    'insert into "sourceRecord" ("id", "workspaceId", "providerName", "sourceType", "externalUrl", "title", "contentText", "publishedAt", "metadata") values ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
    [
      sourceId,
      report.workspaceId,
      'exa',
      'web_page',
      sourceFixture.url,
      sourceFixture.title,
      sourceFixture.content,
      sourceFixture.publishedAt,
      JSON.stringify({ visibility: 'public' }),
    ]
  );
  const state = stateFixture();
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
    async close() {
      await db.$client.query(
        'delete from "newsletterJob" where "workspaceId"=$1',
        [report.workspaceId]
      );
      await db.$client.query(
        'delete from "newsletterWorkspace" where "workspaceId"=$1',
        [report.workspaceId]
      );
      await db.$client.query('delete from "sourceRecord" where "id"=$1', [
        sourceId,
      ]);
      await db.$close();
    },
  };
}
