import { describe, expect, it } from 'vitest';

import type { WeeklyReport } from '@/modules/intelligence/domain/report';
import { validateReportData } from '@/modules/intelligence/domain/report-data';
import { formatReportAsMarkdown } from '@/modules/intelligence/presentation/report-markdown';
import { toWeeklyReportId, toWorkspaceId } from '@/modules/kernel';

const reportData = {
  workspace_id: 'workspace-1',
  report_id: 'report-1',
  period_start: '2026-09-07',
  period_end: '2026-09-13',
  generated_at: '2026-09-14T10:00:00.000Z',
  timezone: 'America/Los_Angeles',
  title: 'Weekly Market Digest',
  executive_summary: {
    bullets: ['First point', 'Second point', 'Third point'],
  },
};

const createReport = (input: Record<string, unknown> = {}): WeeklyReport => {
  const result = validateReportData({ ...reportData, ...input });
  if (result.type !== 'report_data_valid') {
    throw new Error(result.issues.join('\n'));
  }
  const now = new Date('2026-09-14T10:00:00.000Z');
  return {
    id: toWeeklyReportId('report-1'),
    workspaceId: toWorkspaceId('workspace-1'),
    periodStart: now,
    periodEnd: now,
    timezone: 'America/Los_Angeles',
    status: 'published',
    generatedAt: now,
    publishedAt: now,
    title: null,
    reportData: result.data,
    modelMetadata: null,
    failureReason: null,
    createdAt: now,
    updatedAt: now,
  };
};

describe('report Markdown formatting', () => {
  it('copies every section in reading order and keeps empty states readable', () => {
    const markdown = formatReportAsMarkdown(createReport());
    const headings = markdown.match(/^## .+$/gm);

    expect(markdown).toContain('# Weekly Market Digest\n');
    expect(markdown).toContain(
      'Coverage window: 2026-09-07 – 2026-09-13 (America/Los\\_Angeles)'
    );
    expect(markdown).toContain(
      '1. First point\n2. Second point\n3. Third point'
    );
    expect(headings).toEqual([
      '## Executive Summary',
      '## What Looks Most Interesting',
      '## Contradictions / Assumptions to Revisit',
      '## Topic Clusters',
      '## Competitor Watch',
      '## Market Questions',
      '## Possible Leads',
      '## Social / Product Feedback',
      '## Source Library',
    ]);
    expect(markdown).toContain('_No sources are linked to this report._');
    expect(markdown).not.toContain('Score this report');
  });

  it('includes narrative, all cluster evidence once, and available source links', () => {
    const sharedEvidence = {
      id: 'shared',
      source_ids: ['source-1'],
      excerpt: 'Shared evidence',
      source_title: 'External [source]',
      external_url: 'https://example.com/evidence',
      internal_source_url: 'https://app.example.com/sources/1',
    };
    const markdown = formatReportAsMarkdown(
      createReport({
        title: 'Digest #1',
        what_looks_most_interesting: [
          {
            id: 'interesting-1',
            title: 'Market *shift*',
            summary: 'Demand grew.',
            evidence: [],
          },
        ],
        contradictions: [
          {
            id: 'contradiction-1',
            title: 'Assumption changed',
            internal_assumption: 'Internal view',
            external_signal: 'External view',
            observation: 'The views differ.',
          },
        ],
        topic_clusters: [
          {
            id: 'cluster-1',
            title: 'Cluster',
            summary: 'Summary',
            observation: 'Observation',
            labels: { newness: 'new_this_week', trend: 'rising' },
            representative_evidence: [sharedEvidence],
            all_evidence: [
              sharedEvidence,
              {
                id: 'extra',
                source_ids: ['source-2'],
                excerpt: 'Additional evidence',
                source_title: 'Internal only',
                internal_source_url: 'https://app.example.com/sources/2',
              },
            ],
          },
        ],
        competitor_watch: [
          {
            id: 'competitor-1',
            competitor_name: 'Competitor One',
            change_type: 'product_launch',
            observation: 'A launch occurred.',
          },
        ],
        suggested_competitors: [
          {
            id: 'suggested-1',
            name: 'Competitor Two',
            why_suggested: 'Similar audience.',
          },
        ],
        market_questions: [{ id: 'question-1', question: 'What changed?' }],
        possible_leads: [
          {
            id: 'lead-1',
            person_or_company: 'Lead One',
            source_excerpt: 'Interested in a demo',
            why_relevant: 'Potential buyer.',
          },
        ],
        social_product_feedback: [
          {
            id: 'feedback-1',
            label: 'pain_point',
            summary: 'Setup is slow.',
          },
        ],
        source_library: [
          {
            source_id: 'source-1',
            relation_type: 'cited',
            source_title: 'External source',
            external_url: 'https://example.com/source',
          },
          {
            source_id: 'source-2',
            relation_type: 'relevant_unused',
            source_title: 'Unlinked source',
          },
        ],
      })
    );

    expect(markdown).toContain('# Digest \\#1');
    expect(markdown).toContain('### Market \\*shift\\*');
    expect(markdown).toContain('**Internal assumption:** Internal view');
    expect(markdown).toContain('**External signal:** External view');
    expect(markdown).toContain('### Competitor One');
    expect(markdown).toContain('#### Competitor Two');
    expect(markdown).toContain('### What changed?');
    expect(markdown).toContain('### Lead One');
    expect(markdown).toContain('### pain point');
    expect(markdown.match(/Shared evidence/g)).toHaveLength(1);
    expect(markdown).toContain('Additional evidence');
    expect(markdown).toContain(
      '[External \\[source\\]](<https://example.com/evidence>) · [Internal source](<https://app.example.com/sources/1>)'
    );
    expect(markdown).toContain(
      '[Internal only](<https://app.example.com/sources/2>)'
    );
    expect(markdown).toContain(
      '- [External source](<https://example.com/source>) · Cited'
    );
    expect(markdown).toContain('- Unlinked source · Relevant');
  });

  it('returns an empty string for a report without published content', () => {
    expect(
      formatReportAsMarkdown({ ...createReport(), reportData: null })
    ).toBe('');
  });
});
