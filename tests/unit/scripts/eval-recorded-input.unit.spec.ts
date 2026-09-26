import { describe, expect, it } from 'vitest';

import {
  buildReportPrompt,
  REPORT_PROMPT_BUDGETS,
} from '@/modules/intelligence';

import type { EvalCase } from '../../../scripts/eval/case';
import {
  buildCompareExample,
  type FixtureReport,
} from '../../../scripts/eval/fixtures';

const LONG_CONTENT = 'abcdefghij'.repeat(500); // 5000 chars, far over any budget

/**
 * Content whose 600th character is the first half of a surrogate pair, so a
 * plain slice at the budget leaves a lone high surrogate behind.
 */
const BUDGET = 600;
const SURROGATE_CONTENT = `${'x'.repeat(BUDGET - 1)}\u{1F1FA}\u{1F1F8} trailing`;

const source = {
  id: 'src-1',
  sourceType: 'web_page',
  providerName: 'exa',
  title: 'A source',
  contentText: LONG_CONTENT,
  relevanceLabel: null,
};

const report: FixtureReport = {
  id: 'report-1',
  reportData: { title: 'Reference' },
  periodStart: new Date('2026-06-15T00:00:00.000Z'),
  periodEnd: new Date('2026-06-22T00:00:00.000Z'),
  modelMetadata: null,
};

const evalCase = {
  manifest: { name: 'acme-2026-06-15', workspaceId: 'ws-1' },
} as unknown as EvalCase;

const renderPrompt = () =>
  buildReportPrompt({
    workspace: { id: 'ws-1', name: 'Acme' },
    keywords: [],
    competitors: [],
    socialAccounts: [],
    sources: [source],
    priorReports: [],
    periodStartLabel: 'June 15, 2026',
    periodEndLabel: 'June 22, 2026',
  } as unknown as Parameters<typeof buildReportPrompt>[0]);

/** The content string the example claims the model was shown. */
function recordedContent(contentText: string = LONG_CONTENT): string {
  const example = buildCompareExample(evalCase, report, [
    { ...source, contentText } as never,
  ]);
  const sources = example.input.sources as { contentText?: string }[];
  const first = sources[0];
  if (!first?.contentText)
    throw new Error('example recorded no source content');
  return first.contentText;
}

describe('recorded dataset input', () => {
  /**
   * The point of recording the input is that someone can read a Phoenix
   * example and know what the model was given. The example used to truncate
   * at a round 2000 while the prompt rendered 600, so it documented a
   * generation that never happened. Tying the two together in a test is the
   * only thing that keeps them from drifting apart again.
   */
  it('records source content exactly as the generation prompt renders it', () => {
    const recorded = recordedContent();

    expect(recorded.length).toBeLessThanOrEqual(
      REPORT_PROMPT_BUDGETS.sourceContent + 1 // the ellipsis truncate appends
    );
    // The assertion that matters: what we claim the model saw is in the
    // prompt the model was actually handed.
    expect(renderPrompt()).toContain(recorded);
  });

  it('does not record content the prompt never showed the model', () => {
    const recorded = recordedContent();

    expect(recorded.length).toBeLessThan(LONG_CONTENT.length);
    expect(renderPrompt()).not.toContain(LONG_CONTENT);
  });

  /**
   * Found by a live run, not by this suite's first version: the Phoenix
   * dataset upload answered a 96KB payload with a bare 500 and no reason.
   * One source in the committed case ends its 600th character mid-emoji, and
   * the lone high surrogate a plain slice left behind is invalid UTF-16.
   * Asserting the length alone passed straight through it.
   */
  it('never ends a recorded value on a lone surrogate', () => {
    const recorded = recordedContent(SURROGATE_CONTENT);

    const lastCode = recorded.charCodeAt(recorded.length - 1);
    expect(lastCode).not.toBeGreaterThanOrEqual(0xd800);

    // The real contract: it survives a UTF-8 round trip, which a lone
    // surrogate does not -- it becomes U+FFFD.
    expect(Buffer.from(recorded, 'utf8').toString('utf8')).toBe(recorded);
    expect(recorded).not.toContain('\uFFFD');
  });
});
