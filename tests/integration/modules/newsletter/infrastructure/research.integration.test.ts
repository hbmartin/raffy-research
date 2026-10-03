import { createPgliteTestDatabase } from '@tests/server/pglite';
import { requireOk, sourceFixture } from '@tests/support/newsletter';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import {
  createPublicResearchArchive,
  intelligenceDrizzleSchema,
} from '@/modules/intelligence/testing';

const {
  workspace,
  sourceRecord,
  providerConfig,
  weeklyReport,
  weeklyReportSource,
} = intelligenceDrizzleSchema;
describe('Newsletter public research acquisition', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;
  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(workspace).values({
      id: 'ws-1',
      name: 'Test',
      companyName: 'Insider',
      companyDescription: 'Workflows',
      subcategory: 'Dental',
      timezone: 'UTC',
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });
  afterAll(async () => {
    await database.close();
  });
  it('excludes private captures while preserving public Junk and retraction flags for history', async () => {
    await database.db.insert(sourceRecord).values([
      {
        id: 'private',
        workspaceId: 'ws-1',
        providerName: 'exa',
        sourceType: 'web_page',
        metadata: { visibility: 'private' },
        externalUrl: 'https://example.org/private',
        contentText: 'Internal secret should never enter a prompt.',
      },
      {
        id: 'public',
        workspaceId: 'ws-1',
        providerName: 'exa',
        sourceType: 'web_page',
        externalUrl: sourceFixture.url,
        contentText: sourceFixture.content,
        relevanceLabel: 'junk',
        metadata: { retracted: true },
      },
    ]);
    const archive = requireOk(
      await createPublicResearchArchive(database.db).read('ws-1')
    );
    expect(archive).toMatchObject({
      sources: [{ id: 'public', junk: true, retracted: true }],
    });
  });
  it('caps capture count, retains publication dates, and resumes acquisition without duplicate pages', async () => {
    vi.stubEnv('NEWSLETTER_TEST_EXA', 'fixture-credential');
    await database.db.insert(providerConfig).values({
      workspaceId: 'ws-1',
      providerName: 'exa',
      enabled: true,
      credentialsRef: 'NEWSLETTER_TEST_EXA',
    });
    const fetch = vi.fn().mockResolvedValue(
      Response.json({
        results: Array.from({ length: 20 }, (_, i) => ({
          url: `https://example.org/page-${i}`,
          text: `Distinct study ${i}: ` + sourceFixture.content,
          publishedDate: '2025-01-01T00:00:00Z',
        })),
      })
    );
    vi.stubGlobal('fetch', fetch);
    const archive = createPublicResearchArchive(database.db);
    const input = {
      workspaceId: 'ws-1',
      jobId: 'research-job',
      queries: ['primary research', 'counterevidence'],
      pages: 3,
      timeoutMs: 300000,
    };
    const first = requireOk(await archive.research(input));
    const resumed = requireOk(await archive.research(input));
    expect(first).toHaveLength(3);
    expect(resumed.map((s) => s.id)).toEqual(first.map((s) => s.id));
    expect(first[0]!.publishedAt).toBe('2025-01-01T00:00:00.000Z');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(await database.db.select().from(sourceRecord)).toHaveLength(3);
  });
  it('retains report provenance for relevant evidence absent from the report prose', async () => {
    await database.db.insert(sourceRecord).values({
      id: 'uncited-public',
      workspaceId: 'ws-1',
      providerName: 'exa',
      sourceType: 'web_page',
      externalUrl: sourceFixture.url,
      contentText: sourceFixture.content,
    });
    await database.db.insert(weeklyReport).values({
      id: 'published',
      workspaceId: 'ws-1',
      periodStart: new Date('2026-09-21'),
      periodEnd: new Date('2026-09-28'),
      timezone: 'UTC',
      status: 'published',
    });
    await database.db.insert(weeklyReportSource).values({
      workspaceId: 'ws-1',
      reportId: 'published',
      sourceRecordId: 'uncited-public',
      relationType: 'relevant_unused',
    });
    const archive = requireOk(
      await createPublicResearchArchive(database.db).read('ws-1')
    );
    expect(archive).toMatchObject({
      reports: [{ sourceIds: ['uncited-public'] }],
      sources: [{ reportIds: ['published'] }],
    });
  });
});
