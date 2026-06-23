import { UNTRUSTED_SOURCE_GUIDANCE } from './build-report-prompt';
import type { WeeklyReport } from '../../domain/report';
import type { SourceRecord } from '../../domain/source';

export const EVAL_PROMPT_VERSION = 'report-eval-v1';

const renderSourceForEval = (source: SourceRecord) =>
  [
    `id: ${source.id}`,
    `provider: ${source.providerName}`,
    `type: ${source.sourceType}`,
    source.title ? `title: ${source.title}` : null,
    source.authorOrAccount ? `author: ${source.authorOrAccount}` : null,
    source.externalUrl ? `url: ${source.externalUrl}` : null,
    source.relevanceLabel ? `analyst_label: ${source.relevanceLabel}` : null,
    source.contentText ? `content: ${source.contentText.slice(0, 4000)}` : null,
    source.diffAddedText
      ? `added: ${source.diffAddedText.slice(0, 1500)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

export type BuildEvalPromptInput = {
  report: WeeklyReport;
  sources: SourceRecord[];
};

/**
 * LLM-judge prompt: verify a published report's claims against the period's
 * source records. Quality-lab only; the verdict is streamed back to the dev
 * console and never persisted.
 */
export function buildEvalPrompt(input: BuildEvalPromptInput): string {
  const { report, sources } = input;
  return [
    `Evaluator prompt version: ${EVAL_PROMPT_VERSION}`,
    'You are an adversarial evaluator for a weekly market-intelligence report.',
    'Judge ONLY what is verifiable from the source records below. Do not reward fluent writing.',
    UNTRUSTED_SOURCE_GUIDANCE,
    '',
    'Evaluate the report on three dimensions (integer 1-5):',
    '- claim_support: every factual claim in the report is traceable to at least one source record.',
    '- coverage: important signals present in the sources made it into the report.',
    '- noise: the report avoids padding with irrelevant or trivial items (5 = no noise).',
    '',
    'Return ONLY compact JSON with this shape:',
    '{"scores": {"claim_support": number, "coverage": number, "noise": number},',
    ' "violations": [{"section": string, "claim": string, "problem": "unsupported" | "misattributed" | "contradicted" | "irrelevant", "source_ids": string[]}],',
    ' "missed_signals": [{"source_id": string, "why_it_matters": string}],',
    ' "summary": string}',
    '',
    `=== REPORT (id: ${report.id}, period ${report.periodStart.toISOString()} to ${report.periodEnd.toISOString()}) ===`,
    JSON.stringify(report.reportData ?? {}, null, 1),
    '',
    `=== SOURCE RECORDS (${sources.length}) ===`,
    ...sources.map((source) => `---\n${renderSourceForEval(source)}`),
  ].join('\n');
}
