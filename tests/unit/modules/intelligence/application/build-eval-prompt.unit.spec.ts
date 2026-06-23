import { describe, expect, it } from 'vitest';

import {
  buildEvalPrompt,
  EVAL_PROMPT_VERSION,
  UNTRUSTED_SOURCE_GUIDANCE,
  type WeeklyReport,
} from '@/modules/intelligence';
import {
  toSourceRecordId,
  toWeeklyReportId,
  toWorkspaceId,
} from '@/modules/kernel';

const now = new Date('2026-06-01T00:00:00.000Z');
const workspaceId = toWorkspaceId('ws-1');

const report = {
  id: toWeeklyReportId('report-1'),
  workspaceId,
  periodStart: new Date('2026-05-25T00:00:00.000Z'),
  periodEnd: new Date('2026-05-31T00:00:00.000Z'),
  timezone: 'UTC',
  status: 'published',
  generatedAt: now,
  publishedAt: now,
  title: 'Weekly report',
  reportData: null,
  modelMetadata: null,
  failureReason: null,
  createdAt: now,
  updatedAt: now,
} satisfies WeeklyReport;

const source = {
  id: toSourceRecordId('src-42'),
  workspaceId,
  providerName: 'exa',
  providerSourceId: null,
  sourceType: 'forum_post',
  sourceSubtype: null,
  sourceName: null,
  sourceUrl: null,
  externalUrl: 'https://example.com/post',
  title: 'No-show pain',
  authorOrAccount: null,
  domain: null,
  publishedAt: null,
  capturedAt: now,
  contentText: 'We keep losing chairs to no-shows',
  diffAddedText: null,
  diffRemovedText: null,
  rawPayload: null,
  metadata: null,
  relevanceLabel: 'junk' as const,
  labeledAt: now,
  createdAt: now,
  updatedAt: now,
};

describe('buildEvalPrompt', () => {
  const prompt = buildEvalPrompt({ report, sources: [source] });

  it('stamps the prompt version so raw outputs are attributable', () => {
    expect(prompt).toContain(EVAL_PROMPT_VERSION);
  });

  it('marks source records as untrusted evidence', () => {
    expect(prompt).toContain(UNTRUSTED_SOURCE_GUIDANCE);
  });

  it('exposes source ids and analyst labels to the judge', () => {
    expect(prompt).toContain('src-42');
    expect(prompt).toContain('analyst_label: junk');
  });

  it('asks for the three judge dimensions', () => {
    expect(prompt).toContain('claim_support');
    expect(prompt).toContain('coverage');
    expect(prompt).toContain('noise');
  });
});
