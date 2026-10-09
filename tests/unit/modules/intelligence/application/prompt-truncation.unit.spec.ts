import { describe, expect, it } from 'vitest';

import {
  buildClaimSupportPrompt,
  buildCoveragePrompt,
  buildEvalPrompt,
  buildReportPrompt,
  buildSourceSummaryPrompt,
  CLAIM_SUPPORT_CONTENT_LIMIT,
  CLAIM_SUPPORT_DIFF_LIMIT,
  COVERAGE_CONTENT_LIMIT,
  COVERAGE_DIFF_LIMIT,
  EVAL_CONTENT_LIMIT,
  measureReportPromptTruncation,
  REPORT_PROMPT_BUDGETS,
  SOURCE_SUMMARY_CONTENT_LIMIT,
  type SourceRecord,
  type SourceSummary,
  truncateForPrompt,
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

const summaryFor = (
  source: SourceRecord,
  fields: Pick<SourceSummary, 'summaryText' | 'evidenceCandidateText'>
) =>
  ({
    id: 'summary-1',
    workspaceId,
    sourceRecordId: source.id,
    modelName: 'qwen3:14b',
    modelProvider: 'ollama',
    promptVersion: null,
    inputMetadata: null,
    outputPayload: null,
    createdAt: now,
    ...fields,
  }) as unknown as SourceSummary;

const reportPromptWith = (
  source: SourceRecord,
  sourceSummaries: SourceSummary[] = []
) =>
  buildReportPrompt({
    workspace: { id: workspaceId, name: 'Acme' },
    keywords: [],
    competitors: [],
    socialAccounts: [],
    sources: [source],
    sourceSummaries,
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
  [
    'buildReportPrompt',
    REPORT_PROMPT_BUDGETS.sourceContent,
    (source) => reportPromptWith(source),
  ],
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

describe('judge and generator budgets', () => {
  /**
   * The coverage judge is asked whether the report missed a signal. If it
   * reads less of each source than the generator did, a signal between the
   * two budgets is visible to the author and invisible to its grader -- the
   * judge cannot see what it is grading. Deriving one from the other makes
   * that unrepresentable; this pins it so a future edit has to be deliberate.
   */
  it('shows the coverage judge exactly what the generator saw', () => {
    expect(COVERAGE_CONTENT_LIMIT).toBe(REPORT_PROMPT_BUDGETS.sourceContent);
  });

  /**
   * claim_support is deliberately the exception: it reads only cited sources,
   * so it can afford to read them closely.
   */
  it('lets claim_support read cited sources more closely', () => {
    expect(CLAIM_SUPPORT_CONTENT_LIMIT).toBeGreaterThan(
      REPORT_PROMPT_BUDGETS.sourceContent
    );
  });
});

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

describe('truncateForPrompt', () => {
  it('returns short values untouched and null as empty', () => {
    expect(truncateForPrompt('short', 10)).toBe('short');
    expect(truncateForPrompt(null, 10)).toBe('');
  });

  it('backs off to the last sentence end near the limit', () => {
    const text = `${'a'.repeat(85)}. Second sentence runs past the limit`;

    expect(truncateForPrompt(text, 100)).toBe(`${'a'.repeat(85)}.…`);
  });

  it('falls back to the last word break when no sentence ends nearby', () => {
    const text = `${'word '.repeat(19)}unfinishedword continues`;

    expect(truncateForPrompt(text, 100)).toBe(
      `${'word '.repeat(19).trimEnd()}…`
    );
  });

  it('keeps a word that ends exactly at the limit', () => {
    const text = `${'a'.repeat(95)} bcde fgh`;

    expect(truncateForPrompt(text, 100)).toBe(`${'a'.repeat(95)} bcde…`);
  });

  it('hard-cuts when the window holds no boundary', () => {
    expect(truncateForPrompt('x'.repeat(150), 100)).toBe(`${'x'.repeat(100)}…`);
  });

  it('never retreats further than its window', () => {
    // The only space sits outside the last 20% of a 100-char budget.
    const text = `${'a'.repeat(50)} ${'b'.repeat(100)}`;

    expect(truncateForPrompt(text, 100)).toBe(`${text.slice(0, 100)}…`);
  });

  it('never exceeds its budget plus the ellipsis', () => {
    const text = 'The quick brown fox. Jumps over! The lazy dog? '.repeat(40);
    for (const max of [10, 37, 100, 600, 1000]) {
      expect(truncateForPrompt(text, max).length).toBeLessThanOrEqual(max + 1);
    }
  });
});

describe('report prompt source summaries', () => {
  const source = {
    ...sourceWith('RAW_CONTENT_MARKER'),
    diffAddedText: 'RAW_DIFF_MARKER',
  } as SourceRecord;

  it('shows raw source text alongside a separate summaries section', () => {
    const prompt = reportPromptWith(source, [
      summaryFor(source, {
        summaryText: 'SUMMARY_MARKER',
        evidenceCandidateText: 'EVIDENCE_MARKER',
      }),
    ]);

    expect(prompt).toContain('content: RAW_CONTENT_MARKER');
    expect(prompt).toContain('added: RAW_DIFF_MARKER');
    expect(prompt).toContain('# Latest source summaries');
    expect(prompt).toContain('- source_id: src-1');
    expect(prompt).toContain('summary: SUMMARY_MARKER');
    expect(prompt).toContain('evidence_candidate: EVIDENCE_MARKER');
  });

  it('says so when no summaries are supplied', () => {
    expect(reportPromptWith(source)).toContain(
      '(no source summaries supplied)'
    );
  });
});

describe('judge diffs', () => {
  const source = {
    ...sourceWith('content'),
    diffAddedText: `ADDED ${'a'.repeat(5000)}`,
    diffRemovedText: `REMOVED ${'r'.repeat(5000)}`,
  } as SourceRecord;

  /** A change visible only in a diff is evidence the generator could use. */
  it('shows the coverage judge diffs at the generator budget', () => {
    expect(COVERAGE_DIFF_LIMIT).toBe(REPORT_PROMPT_BUDGETS.sourceDiff);
    const prompt = buildCoveragePrompt({ reportJson: '{}', sources: [source] });

    expect(prompt).toContain('added: ADDED');
    expect(prompt).toContain('removed: REMOVED');
  });

  it('shows claim_support diffs', () => {
    expect(CLAIM_SUPPORT_DIFF_LIMIT).toBeGreaterThan(
      REPORT_PROMPT_BUDGETS.sourceDiff
    );
    const prompt = buildClaimSupportPrompt({
      reportJson: '{}',
      sources: [source],
    });

    expect(prompt).toContain('added: ADDED');
    expect(prompt).toContain('removed: REMOVED');
  });
});

describe('measureReportPromptTruncation', () => {
  it('counts truncated fields and the characters they lost', () => {
    const long = { ...sourceWith('x'.repeat(1000)) } as SourceRecord;
    const short = {
      ...sourceWith('fits'),
      id: 'src-2',
    } as unknown as SourceRecord;

    expect(measureReportPromptTruncation({ sources: [long, short] })).toEqual({
      sourcesRendered: 2,
      summariesRendered: 0,
      fieldsTruncated: 1,
      charsDropped: 1000 - REPORT_PROMPT_BUDGETS.sourceContent,
    });
  });

  it('counts truncated summary fields alongside source fields', () => {
    const source = sourceWith('x'.repeat(1000));

    expect(
      measureReportPromptTruncation({
        sources: [source],
        sourceSummaries: [
          summaryFor(source, {
            summaryText: 's'.repeat(800),
            evidenceCandidateText: 'brief',
          }),
        ],
      })
    ).toEqual({
      sourcesRendered: 1,
      summariesRendered: 1,
      fieldsTruncated: 2,
      charsDropped:
        1000 -
        REPORT_PROMPT_BUDGETS.sourceContent +
        800 -
        REPORT_PROMPT_BUDGETS.summaryText,
    });
  });
});
