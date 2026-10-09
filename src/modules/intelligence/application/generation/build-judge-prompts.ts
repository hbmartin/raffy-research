/**
 * LLM-judge prompts, one per quality dimension.
 *
 * The single monolithic eval prompt carries the report plus every source at
 * 4000 chars, which reaches ~115k tokens on a hundred-source period — far past
 * a local model's window, and mostly irrelevant text for any one question.
 *
 * Each dimension here gets only the evidence it actually needs, which makes two
 * of the three cheap and all three sharper: a judge checking whether a claim is
 * supported should be reading the cited sources, not hunting for them among a
 * hundred others.
 */
import {
  REPORT_PROMPT_BUDGETS,
  truncateForPrompt,
  UNTRUSTED_SOURCE_GUIDANCE,
} from './build-report-prompt';
import type { SourceRecord } from '../../domain/source';

export const JUDGE_PROMPT_VERSION = 'report-judge-v3';

/** Cited sources are read closely, so they keep a generous budget. */
export const CLAIM_SUPPORT_CONTENT_LIMIT = 4000;

/**
 * Exactly what the generator saw, by construction.
 *
 * Coverage asks whether a signal worth reporting was left out. Answering that
 * on less of each source than the report's author read is incoherent: a signal
 * sitting past the judge's budget but inside the generator's is invisible to
 * the grader and visible to the graded. This sat at 400 against the
 * generator's 600 because each prompt picked a budget that fit the window on
 * its own, and nobody compared them.
 *
 * Deriving it removes the question. Measured on the committed 101-source case,
 * coverage at 600 is ~22.5k tokens against qwen3:14b's 40,960 -- the same 55%
 * the generator already occupies, so matching it costs nothing.
 *
 * claim_support keeps its own larger budget: it reads only the handful of
 * cited sources, and reads them closely.
 */
export const COVERAGE_CONTENT_LIMIT = REPORT_PROMPT_BUDGETS.sourceContent;

/** Titles are short; this only guards against a pathological one. */
export const JUDGE_TITLE_LIMIT = 200;

const JSON_ONLY = 'Return ONLY compact JSON. No prose outside the JSON.';

/** Diffs are signal the generator reads; claim_support reads them closely. */
export const CLAIM_SUPPORT_DIFF_LIMIT = 1500;

/**
 * Exactly the generator's diff budget, for the same reason coverage matches
 * its content budget: a change visible only in a diff was evidence the report
 * could use, so a coverage judge that cannot see it cannot score its absence.
 */
export const COVERAGE_DIFF_LIMIT = REPORT_PROMPT_BUDGETS.sourceDiff;

type JudgeSourceLimits = { content: number; diff: number };

const renderSource = (source: SourceRecord, limits: JudgeSourceLimits) =>
  [
    `id: ${source.id}`,
    `provider: ${source.providerName}`,
    source.title
      ? `title: ${truncateForPrompt(source.title, JUDGE_TITLE_LIMIT)}`
      : null,
    source.relevanceLabel ? `analyst_label: ${source.relevanceLabel}` : null,
    source.contentText
      ? `content: ${truncateForPrompt(source.contentText, limits.content)}`
      : null,
    source.diffAddedText
      ? `added: ${truncateForPrompt(source.diffAddedText, limits.diff)}`
      : null,
    source.diffRemovedText
      ? `removed: ${truncateForPrompt(source.diffRemovedText, limits.diff)}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');

export type JudgeReportInput = {
  reportJson: string;
  sources: SourceRecord[];
};

/**
 * Is every factual claim traceable to a source the report cites?
 *
 * Uncited sources are deliberately withheld: a claim supported only by a source
 * the report never referenced is still unsupported *as written*.
 */
export function buildClaimSupportPrompt(input: JudgeReportInput): string {
  return [
    'You are an adversarial evaluator checking a market-intelligence report for unsupported claims.',
    'Judge ONLY what is verifiable from the source records below. Do not reward fluent writing.',
    UNTRUSTED_SOURCE_GUIDANCE,
    '',
    'Score claim_support from 1 to 5 (integer):',
    '5 = every factual claim is directly supported by a cited source.',
    '3 = most claims are supported, but some overstate or blur what the sources say.',
    '1 = central claims are fabricated, contradicted, or attributed to the wrong actor.',
    '',
    'A claim citing no source at all counts as unsupported.',
    '',
    JSON_ONLY,
    '{"score": number,',
    ' "violations": [{"section": string, "claim": string, "problem": "unsupported" | "misattributed" | "contradicted" | "irrelevant", "source_ids": string[]}],',
    ' "explanation": string}',
    '',
    '=== REPORT ===',
    input.reportJson,
    '',
    `=== SOURCES CITED BY THIS REPORT (${input.sources.length}) ===`,
    ...input.sources.map(
      (source) =>
        `---\n${renderSource(source, {
          content: CLAIM_SUPPORT_CONTENT_LIMIT,
          diff: CLAIM_SUPPORT_DIFF_LIMIT,
        })}`
    ),
  ].join('\n');
}

/** Did signals present in the period's sources make it into the report? */
export function buildCoveragePrompt(input: JudgeReportInput): string {
  return [
    'You are an adversarial evaluator checking whether a market-intelligence report missed important signals.',
    'Judge ONLY what is verifiable from the source records below.',
    UNTRUSTED_SOURCE_GUIDANCE,
    '',
    'Score coverage from 1 to 5 (integer):',
    '5 = every signal a CEO would want to know about is represented.',
    '3 = the main themes are present but notable items are missing.',
    '1 = the report ignores most of what the sources contain.',
    '',
    'Sources are truncated: judge by what is visible, not by what might follow.',
    'Sources labelled junk by an analyst are excluded on purpose; do not penalise their absence.',
    '',
    JSON_ONLY,
    '{"score": number,',
    ' "missed_signals": [{"source_id": string, "why_it_matters": string}],',
    ' "explanation": string}',
    '',
    '=== REPORT ===',
    input.reportJson,
    '',
    `=== ALL SOURCES FOR THE PERIOD (${input.sources.length}) ===`,
    ...input.sources.map(
      (source) =>
        `---\n${renderSource(source, {
          content: COVERAGE_CONTENT_LIMIT,
          diff: COVERAGE_DIFF_LIMIT,
        })}`
    ),
  ].join('\n');
}

/**
 * Is the report padded? Needs no sources at all — triviality and repetition are
 * visible in the report itself, which is what makes this judge nearly free.
 */
export function buildNoisePrompt(input: { reportJson: string }): string {
  return [
    'You are an adversarial evaluator checking a market-intelligence report for padding.',
    'The reader is the CEO of an early-stage company with very little time.',
    '',
    'Score noise from 1 to 5 (integer), where 5 means NO noise:',
    '5 = every item earns its place; nothing is filler, duplicated, or generic.',
    '3 = several items restate each other or state the obvious.',
    '1 = the report is mostly padding around a couple of real observations.',
    '',
    'Treat as noise: duplicated observations, vendor marketing copy repeated as insight,',
    'industry truisms with no new evidence, and items too vague to act on.',
    '',
    JSON_ONLY,
    '{"score": number,',
    ' "noisy_items": [{"section": string, "item": string, "why": string}],',
    ' "explanation": string}',
    '',
    '=== REPORT ===',
    input.reportJson,
  ].join('\n');
}
