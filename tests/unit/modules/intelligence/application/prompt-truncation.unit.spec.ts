import { describe, expect, it } from 'vitest';

import {
  buildClaimSupportPrompt,
  buildCoveragePrompt,
  buildEvalPrompt,
  buildReportPrompt,
  buildSourceSummaryPrompt,
  CLAIM_SUPPORT_CONTENT_LIMIT,
  COVERAGE_CONTENT_LIMIT,
  EVAL_CONTENT_LIMIT,
  REPORT_PROMPT_BUDGETS,
  SOURCE_SUMMARY_CONTENT_LIMIT,
  type SourceRecord,
  type WeeklyReport,
} from '@/modules/intelligence';
import {
  toSourceRecordId,
  toWeeklyReportId,
  toWorkspaceId,
} from '@/modules/kernel';

const now = new Date('2026-06-01T00:00:00.000Z');
const workspaceId = toWorkspaceId('ws-1');

/**
 * Content whose character at `limit - 1` is the leading half of a surrogate
 * pair, so a plain slice at that limit leaves a lone high surrogate behind.
 */
const BEYOND = 'ZZ_PAST_THE_BUDGET_ZZ';
const straddling = (limit: number) =>
  `${'x'.repeat(limit - 1)}\u{1F600}${BEYOND}`;

const sourceWith = (contentText: string) =>
  ({
    id: toSourceRecordId('src-1'),
    workspaceId,
    providerName: 'exa',
    providerSourceId: null,
    sourceType: 'web_page',
    sourceSubtype: null,
    sourceName: null,
    sourceUrl: null,
    externalUrl: 'https://example.com/a',
    title: 'A source',
    authorOrAccount: null,
    domain: null,
    publishedAt: null,
    capturedAt: now,
    contentText,
    diffAddedText: null,
    diffRemovedText: null,
    rawPayload: null,
    metadata: null,
    relevanceLabel: null,
    labeledAt: null,
    createdAt: now,
    updatedAt: now,
  }) as unknown as SourceRecord;

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

const reportPromptWith = (source: SourceRecord) =>
  buildReportPrompt({
    workspace: { id: workspaceId, name: 'Acme' },
    keywords: [],
    competitors: [],
    socialAccounts: [],
    sources: [source],
    priorReports: [],
    periodStartLabel: 'May 25, 2026',
    periodEndLabel: 'May 31, 2026',
  } as unknown as Parameters<typeof buildReportPrompt>[0]);

/**
 * Every prompt builder that shows a model part of a source, with the budget it
 * cuts at. A lone surrogate survives in a JS string but not over the wire: it
 * becomes U+FFFD in UTF-8, and Phoenix's dataset upload answers it with a bare
 * 500. One source in the committed eval case ends its 600th code unit
 * mid-emoji, so this is a real boundary, not a contrived one.
 */
const builders: [string, number, (source: SourceRecord) => string][] = [
  ['buildReportPrompt', REPORT_PROMPT_BUDGETS.sourceContent, reportPromptWith],
  [
    'buildClaimSupportPrompt',
    CLAIM_SUPPORT_CONTENT_LIMIT,
    (source) =>
      buildClaimSupportPrompt({ reportJson: '{}', sources: [source] }),
  ],
  [
    'buildCoveragePrompt',
    COVERAGE_CONTENT_LIMIT,
    (source) => buildCoveragePrompt({ reportJson: '{}', sources: [source] }),
  ],
  [
    'buildSourceSummaryPrompt',
    SOURCE_SUMMARY_CONTENT_LIMIT,
    (source) => buildSourceSummaryPrompt(source),
  ],
  [
    'buildEvalPrompt',
    EVAL_CONTENT_LIMIT,
    (source) => buildEvalPrompt({ report, sources: [source] }),
  ],
];

describe('prompt truncation', () => {
  it.each(builders)(
    '%s survives a UTF-8 round trip when its budget splits a surrogate pair',
    (_name, limit, build) => {
      const prompt = build(sourceWith(straddling(limit)));

      // A lone surrogate cannot be encoded, so the round trip replaces it.
      expect(Buffer.from(prompt, 'utf8').toString('utf8')).toBe(prompt);
      expect(prompt).not.toContain('\uFFFD');
    }
  );

  it.each(builders)(
    '%s actually truncates at its budget',
    (_name, limit, build) => {
      const prompt = build(sourceWith(straddling(limit)));

      // Guards the test itself: a builder that stopped truncating would pass
      // the surrogate check trivially.
      expect(prompt).not.toContain(BEYOND);
    }
  );
});
