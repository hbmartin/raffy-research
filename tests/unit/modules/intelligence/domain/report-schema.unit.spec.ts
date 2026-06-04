import { describe, expect, it } from 'vitest';

import {
  parseReportData,
  reportDataSchema,
} from '@/modules/intelligence/domain/report-schema';

const validReport = {
  workspace_id: 'workspace_1',
  report_id: 'report_1',
  period_start: '2026-06-01T00:00:00.000Z',
  period_end: '2026-06-08T00:00:00.000Z',
  generated_at: '2026-06-08T15:00:00.000Z',
  timezone: 'America/Los_Angeles',
  title: 'Weekly market intelligence digest',
  executive_summary: {
    bullets: [
      'Developer forums discussed onboarding friction in agent tools.',
      'A tracked competitor updated pricing copy for enterprise customers.',
      'Social product feedback concentrated around setup documentation.',
    ],
  },
  what_looks_most_interesting: [
    {
      id: 'interesting_1',
      title: 'Agent setup friction',
      evidence: [
        {
          id: 'evidence_1',
          source_ids: ['source_1'],
          excerpt: 'Setup took longer than expected for a small team.',
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
};

describe('reportDataSchema', () => {
  it('accepts a PRD-shaped report with exactly three executive bullets', () => {
    const parsed = parseReportData(validReport);

    expect(parsed.executive_summary.bullets).toHaveLength(3);
    expect(
      parsed.what_looks_most_interesting[0]?.evidence[0]?.source_ids
    ).toEqual(['source_1']);
  });

  it('rejects executive summaries that do not have exactly three bullets', () => {
    const result = reportDataSchema.safeParse({
      ...validReport,
      executive_summary: { bullets: ['Only one bullet'] },
    });

    expect(result.success).toBe(false);
  });

  it('requires every evidence item to reference at least one source id', () => {
    const result = reportDataSchema.safeParse({
      ...validReport,
      what_looks_most_interesting: [
        {
          id: 'interesting_1',
          title: 'Agent setup friction',
          evidence: [
            {
              id: 'evidence_1',
              source_ids: [],
            },
          ],
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects confidence and recommendation fields anywhere in the report', () => {
    const result = reportDataSchema.safeParse({
      ...validReport,
      what_looks_most_interesting: [
        {
          id: 'interesting_1',
          title: 'Agent setup friction',
          confidence: 'high',
        },
      ],
    });

    expect(result.success).toBe(false);
  });

  it('rejects prescriptive advice phrases', () => {
    const result = reportDataSchema.safeParse({
      ...validReport,
      competitor_watch: [
        {
          id: 'competitor_1',
          title: 'Enterprise page update',
          summary: 'We recommend changing positioning after this update.',
        },
      ],
    });

    expect(result.success).toBe(false);
  });
});
