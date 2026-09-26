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
function recordedContent(): string {
  const example = buildCompareExample(evalCase, report, [source as never]);
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

    expect(recorded).toHaveLength(REPORT_PROMPT_BUDGETS.sourceContent);
    // The assertion that matters: what we claim the model saw is in the
    // prompt the model was actually handed.
    expect(renderPrompt()).toContain(recorded);
  });

  it('does not record content the prompt never showed the model', () => {
    const recorded = recordedContent();

    expect(recorded.length).toBeLessThan(LONG_CONTENT.length);
    expect(renderPrompt()).not.toContain(LONG_CONTENT);
  });
});
