import { validateReportData } from '@/modules/intelligence';
import { getDefaultDbClient } from '@/modules/kernel/infrastructure/db/client';
import {
  feedbackEvent,
  providerConfig,
  searchResult,
  sourceRecord,
  weeklyReport,
  weeklyReportSource,
  workspace,
  workspaceCompetitor,
  workspaceKeyword,
  workspaceSocialAccount,
} from '@/modules/kernel/infrastructure/db/schema';

const PERIOD_START = new Date('2026-05-25T07:00:00.000Z'); // Mon 00:00 PT
const PERIOD_END = new Date('2026-06-01T06:59:59.999Z'); // Sun 23:59 PT
const GENERATED_AT = new Date('2026-06-01T15:00:00.000Z');

export async function createWorkspaces() {
  const db = getDefaultDbClient();

  const existing = await db.select().from(workspace).limit(1);
  if (existing.length > 0) {
    console.log(`✅ workspace already seeded 👉 skipping`);
    return;
  }

  console.log(`⏳ Seeding intelligence workspace`);

  const [ws] = await db
    .insert(workspace)
    .values({
      name: 'Aperture Dental Cloud',
      companyName: 'Aperture Dental Cloud',
      companyDescription:
        'Pre-seed vertical SaaS providing patient-intake and recall automation for independent dental clinics.',
      subcategory: 'Dental practice management software',
      timezone: 'America/Los_Angeles',
      website: 'https://aperturedental.example',
      positioning: 'The fastest way for solo dentists to fill empty chairs.',
      icp: 'Independent dental practices with 1-3 chairs and no front-office software.',
      marketAssumptions:
        'Buyers care most about speed of setup and price, not deep analytics.',
      gtmFocus: 'Founder-led outbound on LinkedIn plus dental subreddits.',
    })
    .returning();

  if (!ws) throw new Error('Failed to seed workspace');

  await db.insert(workspaceKeyword).values([
    { workspaceId: ws.id, keywordString: 'dental practice software' },
    { workspaceId: ws.id, keywordString: 'patient recall automation' },
    { workspaceId: ws.id, keywordString: 'dental no-show reduction' },
  ]);

  const competitors = await db
    .insert(workspaceCompetitor)
    .values([
      {
        workspaceId: ws.id,
        name: 'ToothPilot',
        domain: 'toothpilot.example',
        state: 'accepted',
      },
      {
        workspaceId: ws.id,
        name: 'ClinicFlow',
        domain: 'clinicflow.example',
        state: 'accepted',
      },
      {
        workspaceId: ws.id,
        name: 'RecallRabbit',
        domain: 'recallrabbit.example',
        state: 'suggested',
      },
    ])
    .returning();

  const suggestedCompetitor = competitors.find((c) => c.state === 'suggested');

  await db.insert(workspaceSocialAccount).values({
    workspaceId: ws.id,
    platform: 'linkedin',
    username: 'aperture-dental',
    profileUrl: 'https://www.linkedin.com/company/aperture-dental',
  });

  await db.insert(providerConfig).values([
    {
      workspaceId: ws.id,
      providerName: 'exa',
      enabled: true,
      credentialsRef: 'EXA_API_KEY',
    },
    {
      workspaceId: ws.id,
      providerName: 'apify',
      enabled: true,
      credentialsRef: 'APIFY_TOKEN',
    },
    {
      workspaceId: ws.id,
      providerName: 'slack',
      enabled: false,
      credentialsRef: 'SLACK_BOT_TOKEN',
    },
  ]);

  // Source records the report will cite.
  const sources = await db
    .insert(sourceRecord)
    .values([
      {
        workspaceId: ws.id,
        providerName: 'exa',
        sourceType: 'forum_post',
        sourceName: 'r/Dentistry',
        externalUrl: 'https://www.reddit.com/r/Dentistry/example1',
        title: 'How are you all handling no-shows in 2026?',
        authorOrAccount: 'u/molarbear',
        domain: 'reddit.com',
        contentText:
          'We are losing two chairs a day to no-shows. Tried SMS reminders but patients ignore them. What actually works?',
        capturedAt: GENERATED_AT,
      },
      {
        workspaceId: ws.id,
        providerName: 'apify',
        sourceType: 'linkedin_post',
        sourceName: 'ToothPilot',
        externalUrl: 'https://www.linkedin.com/posts/toothpilot-example',
        title: 'ToothPilot launches AI recall assistant',
        authorOrAccount: 'ToothPilot',
        domain: 'linkedin.com',
        contentText:
          'Excited to announce our new AI recall assistant that books patients automatically. Compliance-first, HIPAA aligned.',
        capturedAt: GENERATED_AT,
      },
      {
        workspaceId: ws.id,
        providerName: 'visualping',
        sourceType: 'webpage_change',
        sourceName: 'ClinicFlow pricing page',
        externalUrl: 'https://clinicflow.example/pricing',
        title: 'ClinicFlow pricing page changed',
        domain: 'clinicflow.example',
        diffRemovedText: 'Starter plan $99/mo',
        diffAddedText: 'Starter plan $79/mo — now includes recall automation',
        capturedAt: GENERATED_AT,
      },
    ])
    .returning();

  const [redditSource, linkedinSource, diffSource] = sources;
  if (!redditSource || !linkedinSource || !diffSource) {
    throw new Error('Failed to seed source records');
  }

  await db.insert(searchResult).values({
    workspaceId: ws.id,
    providerName: 'exa',
    query: 'dental no-show reduction',
    resultRank: 1,
    title: 'How are you all handling no-shows in 2026?',
    snippet: 'We are losing two chairs a day to no-shows...',
    url: redditSource.externalUrl,
    sourceRecordId: redditSource.id,
  });

  const reportData = {
    workspace_id: ws.id,
    report_id: 'seed-report',
    period_start: '2026-05-25',
    period_end: '2026-05-31',
    generated_at: GENERATED_AT.toISOString(),
    timezone: 'America/Los_Angeles',
    title: 'Weekly Market Digest — May 25–31',
    executive_summary: {
      bullets: [
        'No-show reduction is the dominant pain in dental operator conversations this week.',
        'ToothPilot is leaning hard into a compliance-first AI recall narrative.',
        'ClinicFlow cut its starter price and bundled recall automation, raising a pricing question.',
      ],
    },
    what_looks_most_interesting: [
      {
        id: 'interesting_1',
        title:
          'Compliance is showing up in competitor messaging, not just speed',
        summary:
          'ToothPilot framed its launch around HIPAA compliance rather than setup speed.',
        why_this_may_matter:
          'Internal positioning assumes buyers care about speed and price over compliance.',
        evidence: [
          {
            id: 'ev_1',
            source_ids: [linkedinSource.id],
            excerpt:
              'our new AI recall assistant that books patients automatically. Compliance-first, HIPAA aligned.',
            source_title: 'ToothPilot launches AI recall assistant',
            source_type: 'linkedin_post',
            provider_name: 'apify',
            external_url: linkedinSource.externalUrl ?? undefined,
          },
        ],
      },
    ],
    contradictions: [
      {
        id: 'contradiction_1',
        title: 'Speed-first assumption vs compliance-led market signals',
        internal_assumption:
          'Buyers care most about speed of setup and price, not compliance.',
        external_signal:
          'A leading competitor is leading with compliance in its launch messaging.',
        observation:
          'External competitor messaging emphasizes compliance while internal positioning emphasizes speed.',
        evidence: [
          {
            id: 'ev_2',
            source_ids: [linkedinSource.id],
            excerpt: 'Compliance-first, HIPAA aligned.',
            provider_name: 'apify',
          },
        ],
      },
    ],
    topic_clusters: [
      {
        id: 'topic_1',
        title: 'No-show reduction demand',
        summary: 'Operators are actively asking what reduces no-shows.',
        observation:
          'Multiple operators describe losing chairs to no-shows and distrust of SMS reminders.',
        why_this_may_matter:
          'This maps directly to the recall automation value proposition.',
        labels: { newness: 'new_this_week', trend: 'rising' },
        representative_evidence: [
          {
            id: 'ev_3',
            source_ids: [redditSource.id],
            excerpt:
              'We are losing two chairs a day to no-shows. Tried SMS reminders but patients ignore them.',
            source_title: 'How are you all handling no-shows in 2026?',
            source_type: 'forum_post',
            provider_name: 'exa',
            external_url: redditSource.externalUrl ?? undefined,
          },
        ],
        all_evidence: [
          {
            id: 'ev_3',
            source_ids: [redditSource.id],
            excerpt:
              'We are losing two chairs a day to no-shows. Tried SMS reminders but patients ignore them.',
            provider_name: 'exa',
          },
        ],
        related_competitors: ['ToothPilot'],
        related_keywords: ['dental no-show reduction'],
        related_internal_sources: [],
      },
    ],
    competitor_watch: [
      {
        id: 'cw_1',
        competitor_name: 'ClinicFlow',
        domain: 'clinicflow.example',
        change_type: 'pricing_change',
        observation:
          'ClinicFlow dropped its starter plan from $99 to $79 and bundled recall automation.',
        evidence: [
          {
            id: 'ev_4',
            source_ids: [diffSource.id],
            excerpt:
              'Starter plan $79/mo — now includes recall automation (was $99/mo).',
            source_type: 'webpage_change',
            provider_name: 'visualping',
            external_url: diffSource.externalUrl ?? undefined,
          },
        ],
      },
    ],
    suggested_competitors: suggestedCompetitor
      ? [
          {
            id: 'sc_1',
            competitor_id: suggestedCompetitor.id,
            name: suggestedCompetitor.name,
            domain: suggestedCompetitor.domain ?? undefined,
            why_suggested:
              'Mentioned alongside tracked competitors in two independent operator threads.',
            similarity: 'Targets the same independent-dental-clinic ICP.',
            related_keywords: ['patient recall automation'],
            evidence: [
              {
                id: 'ev_5',
                source_ids: [redditSource.id],
                excerpt: 'A few folks recommended RecallRabbit for reminders.',
                provider_name: 'exa',
              },
            ],
          },
        ]
      : [],
    market_questions: [
      {
        id: 'mq_1',
        question: 'What actually reduces dental no-shows beyond SMS reminders?',
        source_type: 'forum_post',
        evidence: [
          {
            id: 'ev_6',
            source_ids: [redditSource.id],
            excerpt: 'What actually works?',
            provider_name: 'exa',
          },
        ],
      },
    ],
    possible_leads: [
      {
        id: 'lead_1',
        person_or_company: 'u/molarbear',
        source_excerpt:
          'We are losing two chairs a day to no-shows. What actually works?',
        why_relevant:
          'Expresses an active pain that maps to the recall automation product.',
        matched_keyword: 'dental no-show reduction',
        evidence: [
          {
            id: 'ev_7',
            source_ids: [redditSource.id],
            excerpt: 'We are losing two chairs a day to no-shows.',
            provider_name: 'exa',
          },
        ],
      },
    ],
    social_product_feedback: [
      {
        id: 'spf_1',
        label: 'category',
        summary:
          'Operators distrust SMS reminders as a no-show solution category-wide.',
        evidence: [
          {
            id: 'ev_8',
            source_ids: [redditSource.id],
            excerpt: 'Tried SMS reminders but patients ignore them.',
            provider_name: 'exa',
          },
        ],
      },
    ],
    source_library: [
      {
        source_id: redditSource.id,
        relation_type: 'cited',
        topic_cluster_id: 'topic_1',
        source_title: 'How are you all handling no-shows in 2026?',
        source_type: 'forum_post',
        provider_name: 'exa',
        external_url: redditSource.externalUrl ?? undefined,
      },
      {
        source_id: linkedinSource.id,
        relation_type: 'cited',
        source_title: 'ToothPilot launches AI recall assistant',
        source_type: 'linkedin_post',
        provider_name: 'apify',
        external_url: linkedinSource.externalUrl ?? undefined,
      },
      {
        source_id: diffSource.id,
        relation_type: 'cited',
        source_title: 'ClinicFlow pricing page changed',
        source_type: 'webpage_change',
        provider_name: 'visualping',
        external_url: diffSource.externalUrl ?? undefined,
      },
    ],
  };

  const validation = validateReportData(reportData);
  if (validation.type === 'report_data_invalid') {
    throw new Error(
      `Seed report data is invalid: ${validation.issues.join('; ')}`
    );
  }

  const [report] = await db
    .insert(weeklyReport)
    .values({
      workspaceId: ws.id,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      timezone: 'America/Los_Angeles',
      status: 'published',
      generatedAt: GENERATED_AT,
      publishedAt: GENERATED_AT,
      title: reportData.title,
      reportData: validation.data,
      modelMetadata: {
        modelProvider: 'openai',
        modelName: 'seed-fixture',
        promptVersion: 'seed',
      },
    })
    .returning();

  if (!report) throw new Error('Failed to seed weekly report');

  await db.insert(weeklyReportSource).values(
    sources.map((source) => ({
      workspaceId: ws.id,
      reportId: report.id,
      sourceRecordId: source.id,
      relationType: 'cited' as const,
      topicClusterId: source.id === redditSource.id ? 'topic_1' : null,
    }))
  );

  await db.insert(feedbackEvent).values({
    workspaceId: ws.id,
    reportId: report.id,
    eventType: 'useful',
    targetType: 'topic_cluster',
    targetId: 'topic_1',
  });

  console.log(`✅ Seeded workspace "${ws.name}" with a published report`);
}
