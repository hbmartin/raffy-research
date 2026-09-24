/**
 * LLM-as-judge evaluators for a generated report.
 *
 * These run as Phoenix evaluators on the same experiment that generates the
 * report, so one command yields both the deterministic comparison against the
 * reference and a qualitative verdict on the report's own merits.
 *
 * Unlike the CODE evaluators, these are not reproducible: the same report can
 * score differently twice. Temperature is pinned to 0 to reduce that, but the
 * deterministic evaluators remain the backbone — a judge score is a signal, not
 * a measurement.
 */
import type { SourceRecord } from '@/modules/intelligence';
import {
  buildClaimSupportPrompt,
  buildCoveragePrompt,
  buildNoisePrompt,
  collectCitedSourceIds,
} from '@/modules/intelligence';

export type JudgeVerdict = {
  score: number | null;
  label?: string;
  explanation?: string;
  metadata?: Record<string, unknown>;
};

/** Just enough of a text generator to be swapped out in tests. */
export type JudgeGenerate = (input: {
  prompt: string;
  label: string;
}) => Promise<string>;

export type JudgeEvaluator = {
  name: string;
  evaluate: (args: {
    reportJson: string;
    reportData: unknown;
    sources: SourceRecord[];
  }) => Promise<JudgeVerdict>;
};

const SCORE_MIN = 1;
const SCORE_MAX = 5;

/**
 * A judge's 1-5 answer, or null when it did not give one.
 *
 * Models answer "high" or "N/A" often enough to matter, and Number() turns
 * those into NaN, which JSON serialises to null further downstream -- a score
 * that silently becomes nothing. Coercing to 0 instead would be worse: 0 is
 * off the 1-5 scale and reads as the worst possible verdict, so a parse
 * failure would look like a real, terrible score. Say null and let the caller
 * decide.
 */
export function parseFiveScale(raw: unknown): number | null {
  const value = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  return Math.min(SCORE_MAX, Math.max(SCORE_MIN, value));
}

/**
 * Judges answer on a 1-5 scale, but every other evaluator on this experiment
 * reports 0-1. Normalising keeps a chart of averages meaningful; the raw score
 * survives in the label and metadata.
 */
export function normalizeScore(raw: unknown): number | null {
  const clamped = parseFiveScale(raw);
  if (clamped === null) return null;
  return (clamped - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);
}

/** Models wrap JSON in prose or fences often enough to be worth tolerating. */
export function extractVerdict(text: string): Record<string, unknown> | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? trimmed;
  const attempts = [candidate];
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start !== -1 && end > start)
    attempts.push(candidate.slice(start, end + 1));

  for (const attempt of attempts) {
    try {
      const parsed: unknown = JSON.parse(attempt);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
    } catch {
      continue;
    }
  }
  return null;
}

function toVerdict(
  text: string,
  detailKey: string,
  extra?: Record<string, unknown>
): JudgeVerdict {
  const parsed = extractVerdict(text);
  if (!parsed) {
    return {
      score: null,
      label: 'unparseable',
      metadata: { ...extra, rawText: text.slice(0, 2000) },
    };
  }
  const score = normalizeScore(parsed.score);
  const details = Array.isArray(parsed[detailKey]) ? parsed[detailKey] : [];
  return {
    score,
    label: score === null ? 'no-score' : `${parsed.score}/5`,
    explanation:
      typeof parsed.explanation === 'string' ? parsed.explanation : undefined,
    metadata: {
      ...extra,
      rawScore: parsed.score,
      [detailKey]: details,
      [`${detailKey}Count`]: (details as unknown[]).length,
    },
  };
}

export function createJudgeEvaluators(
  generate: JudgeGenerate
): JudgeEvaluator[] {
  return [
    {
      name: 'judge_claim_support',
      evaluate: async ({ reportJson, reportData, sources }) => {
        // Only what the report actually cites: a claim resting on a source the
        // report never referenced is unsupported as written.
        const citedIds = new Set(collectCitedSourceIds(reportData));
        const cited = sources.filter((source) => citedIds.has(source.id));
        if (cited.length === 0) {
          return {
            score: 0,
            label: 'no-citations',
            explanation:
              'The report cites no source records, so no claim is supported.',
            metadata: { citedCount: 0, availableCount: sources.length },
          };
        }
        const text = await generate({
          prompt: buildClaimSupportPrompt({ reportJson, sources: cited }),
          label: 'judge-claim-support',
        });
        return toVerdict(text, 'violations', {
          citedCount: cited.length,
          availableCount: sources.length,
        });
      },
    },
    {
      name: 'judge_coverage',
      evaluate: async ({ reportJson, sources }) => {
        const text = await generate({
          prompt: buildCoveragePrompt({ reportJson, sources }),
          label: 'judge-coverage',
        });
        return toVerdict(text, 'missed_signals', {
          sourceCount: sources.length,
        });
      },
    },
    {
      name: 'judge_noise',
      evaluate: async ({ reportJson }) => {
        const text = await generate({
          prompt: buildNoisePrompt({ reportJson }),
          label: 'judge-noise',
        });
        return toVerdict(text, 'noisy_items');
      },
    },
  ];
}
