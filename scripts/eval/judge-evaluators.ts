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
import { z } from 'zod';

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
 * What a judge must return for its answer to count as a measurement.
 *
 * Anything else -- a missing score, a word where a number belongs, a 9 on a
 * 1-5 scale, a violations field that is not a list -- means the judge did not
 * do the task. Coercing those into numbers, whether by defaulting to zero or
 * by clamping into range, records "the report scored badly" when what
 * happened is "the evaluator failed", and the two are indistinguishable once
 * they are averaged together.
 */
const zJudgeVerdict = z.object({
  score: z.number().int().min(SCORE_MIN).max(SCORE_MAX),
  explanation: z.string().optional(),
  violations: z.array(z.record(z.string(), z.unknown())).optional(),
  missed_signals: z.array(z.record(z.string(), z.unknown())).optional(),
  noisy_items: z.array(z.record(z.string(), z.unknown())).optional(),
});

export type JudgeVerdictPayload = z.infer<typeof zJudgeVerdict>;

/**
 * Judges answer on a 1-5 scale, but every other evaluator on this experiment
 * reports 0-1. Normalising keeps a chart of averages meaningful; the raw score
 * survives in the label and metadata.
 */
export function normalizeScore(raw: number): number {
  return (raw - SCORE_MIN) / (SCORE_MAX - SCORE_MIN);
}

/** Validates a judge's reply, or says why it is not a measurement. */
export function parseJudgeVerdict(
  text: string
):
  | { ok: true; verdict: JudgeVerdictPayload }
  | { ok: false; reason: string; issues?: string[] } {
  const parsed = extractVerdict(text);
  if (!parsed) return { ok: false, reason: 'unparseable' };
  const result = zJudgeVerdict.safeParse(parsed);
  if (!result.success) {
    return {
      ok: false,
      reason: 'invalid-verdict',
      issues: result.error.issues.map(
        (issue) => `${issue.path.join('.') || 'verdict'}: ${issue.message}`
      ),
    };
  }
  return { ok: true, verdict: result.data };
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
  detailKey: 'violations' | 'missed_signals' | 'noisy_items',
  extra?: Record<string, unknown>
): JudgeVerdict {
  const parsed = parseJudgeVerdict(text);
  if (!parsed.ok) {
    return {
      score: null,
      label: parsed.reason,
      metadata: {
        ...extra,
        issues: parsed.issues,
        rawText: text.slice(0, 2000),
      },
    };
  }

  const { verdict } = parsed;
  const details = verdict[detailKey] ?? [];
  return {
    score: normalizeScore(verdict.score),
    label: `${verdict.score}/5`,
    explanation: verdict.explanation,
    metadata: {
      ...extra,
      rawScore: verdict.score,
      [detailKey]: details,
      [`${detailKey}Count`]: details.length,
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
