import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { toWorkspaceId } from '@/modules/kernel/domain/ids';
import { workspace as workspaceTable } from '@/modules/intelligence/infrastructure/drizzle/schema';
import { createReportRepository } from '@/modules/intelligence/testing';
import { createPgliteTestDatabase } from '@tests/server/pglite';

describe('ReportRepositoryDrizzle integration', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;

  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });

  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(workspaceTable).values({
      id: 'ws-1',
      name: 'Workspace',
      companyName: 'Acme',
      companyDescription: 'Test workspace',
      subcategory: 'B2B SaaS',
      timezone: 'UTC',
    });
  });

  afterAll(async () => {
    await database?.close();
  });

  it('returns the latest published report across multiple rows per period', async () => {
    const repository = createReportRepository({ db: database.db });
    const workspaceId = toWorkspaceId('ws-1');
    const periodStart = new Date('2026-06-01T00:00:00.000Z');
    const periodEnd = new Date('2026-06-07T23:59:59.999Z');

    await repository.create({
      workspaceId,
      periodStart,
      periodEnd,
      timezone: 'UTC',
      status: 'failed',
      failureReason: 'first failed',
      generatedAt: new Date('2026-06-08T00:00:00.000Z'),
    });
    await repository.create({
      workspaceId,
      periodStart,
      periodEnd,
      timezone: 'UTC',
      status: 'generated',
      generatedAt: new Date('2026-06-08T01:00:00.000Z'),
    });
    await repository.create({
      workspaceId,
      periodStart,
      periodEnd,
      timezone: 'UTC',
      status: 'published',
      title: 'Older published',
      generatedAt: new Date('2026-06-08T02:00:00.000Z'),
      publishedAt: new Date('2026-06-08T02:00:00.000Z'),
    });
    const newer = await repository.create({
      workspaceId,
      periodStart,
      periodEnd,
      timezone: 'UTC',
      status: 'published',
      title: 'Newer published',
      generatedAt: new Date('2026-06-08T03:00:00.000Z'),
      publishedAt: new Date('2026-06-08T03:00:00.000Z'),
    });
    if (newer.isError()) throw newer.getError();

    const result = await repository.getLatestPublished(workspaceId);

    if (result.isError()) throw result.getError();
    expect(result.get()).toMatchObject({
      type: 'report_found',
      report: {
        id: newer.get().id,
        status: 'published',
        title: 'Newer published',
      },
    });
  });
});
