import { sql } from 'drizzle-orm';

import { getDefaultDbClient } from '@/modules/kernel/infrastructure/db/client';
import {
  providerConfig,
  sourceRecord,
  weeklyReport,
  weeklyReportSource,
  workspace,
  workspaceCompetitor,
  workspaceKeyword,
  workspaceSocialAccount,
} from '@/modules/kernel/infrastructure/db/schema';

const workspaceId = 'workspace-raffy-demo';
const sourceId = 'source-raffy-demo-1';
const reportId = 'report-raffy-demo-week-1';

export async function createIntelligenceFixtures() {
  console.log(`⏳ Seeding intelligence fixtures`);
  const db = getDefaultDbClient();

  await db
    .insert(workspace)
    .values({
      id: workspaceId,
      name: 'Raffy Research',
      companyName: 'Raffy Research',
      companyDescription:
        'A market intelligence workspace for CEO-facing weekly digests.',
      subcategory: 'AI market intelligence',
      timezone: 'America/Los_Angeles',
      companyWebsite: 'https://example.com',
      currentPositioning: 'Operator-assisted market monitoring.',
      knownIcp: 'Founders and executive teams at software companies.',
      knownMarketAssumptions:
        'Executives want compressed market signals with inspectable sources.',
      gtmFocusNotes:
        'Track competitors, developer communities, and social feedback.',
    })
    .onConflictDoNothing();

  await db
    .insert(workspaceKeyword)
    .values([
      {
        id: 'keyword-raffy-agent-research',
        workspaceId,
        keywordString: 'AI research agents',
      },
      {
        id: 'keyword-raffy-market-monitoring',
        workspaceId,
        keywordString: 'market monitoring',
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(workspaceSocialAccount)
    .values({
      id: 'social-raffy-x',
      workspaceId,
      platform: 'x',
      username: 'raffyresearch',
      profileUrl: 'https://x.com/raffyresearch',
    })
    .onConflictDoNothing();

  await db
    .insert(workspaceCompetitor)
    .values([
      {
        id: 'competitor-raffy-alpha',
        workspaceId,
        name: 'Signal Alpha',
        domain: 'signalalpha.example',
        state: 'accepted',
      },
      {
        id: 'competitor-raffy-suggested',
        workspaceId,
        name: 'Market Lens',
        domain: 'marketlens.example',
        state: 'suggested',
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(providerConfig)
    .values([
      {
        id: 'provider-raffy-exa',
        workspaceId,
        providerName: 'exa',
        enabled: false,
        credentialsRef: 'EXA_API_KEY',
        config: { queries: ['AI research agents', 'market monitoring'] },
      },
      {
        id: 'provider-raffy-slack',
        workspaceId,
        providerName: 'slack',
        enabled: false,
        credentialsRef: 'SLACK_BOT_TOKEN',
        config: { channelIds: [] },
      },
    ])
    .onConflictDoNothing();

  await db
    .insert(sourceRecord)
    .values({
      id: sourceId,
      workspaceId,
      providerName: 'exa',
      providerSourceId: 'exa-demo-1',
      sourceType: 'web',
      sourceName: 'Example Research Blog',
      sourceUrl: 'https://example.com/research/weekly-agent-monitoring',
      externalUrl: 'https://example.com/research/weekly-agent-monitoring',
      title: 'Teams compare agent research workflows',
      authorOrAccount: 'Example Research',
      domain: 'example.com',
      publishedAt: new Date('2026-06-01T12:00:00.000Z'),
      contentText:
        'Teams described shorter research review cycles after consolidating sources.',
      rawPayload: { fixture: true, provider: 'exa' },
    })
    .onConflictDoNothing();

  await db
    .insert(weeklyReport)
    .values({
      id: reportId,
      workspaceId,
      periodStart: new Date('2026-06-01T00:00:00.000Z'),
      periodEnd: new Date('2026-06-08T00:00:00.000Z'),
      timezone: 'America/Los_Angeles',
      status: 'published',
      generatedAt: new Date('2026-06-08T15:00:00.000Z'),
      publishedAt: new Date('2026-06-08T15:01:00.000Z'),
      title: 'Weekly market intelligence digest',
      reportData: {
        workspace_id: workspaceId,
        report_id: reportId,
        period_start: '2026-06-01T00:00:00.000Z',
        period_end: '2026-06-08T00:00:00.000Z',
        generated_at: '2026-06-08T15:00:00.000Z',
        timezone: 'America/Los_Angeles',
        title: 'Weekly market intelligence digest',
        executive_summary: {
          bullets: [
            'Research workflow comparisons appeared in developer-facing content.',
            'Tracked competitor language stayed focused on enterprise outcomes.',
            'Social feedback centered on setup clarity and source traceability.',
          ],
        },
        what_looks_most_interesting: [
          {
            id: 'interesting-1',
            title: 'Research workflow comparison',
            summary:
              'Teams discussed shorter review cycles after consolidating sources.',
            evidence: [
              {
                id: 'evidence-1',
                source_ids: [sourceId],
                excerpt:
                  'Teams described shorter research review cycles after consolidating sources.',
                source_title: 'Teams compare agent research workflows',
                source_type: 'web',
                provider_name: 'exa',
                external_url:
                  'https://example.com/research/weekly-agent-monitoring',
                internal_source_url: `/app/sources/${sourceId}`,
              },
            ],
          },
        ],
        contradictions: [],
        topic_clusters: [],
        competitor_watch: [],
        suggested_competitors: [],
        market_questions: [],
        possible_leads: [],
        social_product_feedback: [],
        source_library: [],
      },
      modelMetadata: { fixture: true },
    })
    .onConflictDoNothing();

  await db
    .insert(weeklyReportSource)
    .values({
      id: 'report-source-raffy-demo-1',
      workspaceId,
      reportId,
      sourceRecordId: sourceId,
      relationType: 'cited',
      sectionKey: 'what_looks_most_interesting',
    })
    .onConflictDoNothing();

  const [countRow] = await db
    .select({ count: sql<number>`cast(count(*) as integer)` })
    .from(workspace);

  console.log(`✅ ${countRow?.count ?? 0} intelligence workspaces available`);
}
