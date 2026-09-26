/**
 * The shapes the eval commands pass around, and the one dataset example they
 * share. buildCompareExample lives here because compare and evaluate must
 * produce byte-identical examples: the content hash decides whether a run
 * reuses the pinned dataset version or forks a new one.
 */
import type { JsonObject } from '@/modules/kernel/domain/json';

import type { CaseSource, EvalCase } from './case';
import { exampleId } from './case';

export type FixtureReport = {
  id: string;
  reportData: JsonObject | null;
  periodStart: Date;
  periodEnd: Date;
  modelMetadata?: JsonObject | null;
};

export type FixtureSource = CaseSource;

/** An eval case, shaped for the code paths that predate cases. */
export function caseAsFixture(evalCase: EvalCase): {
  report: FixtureReport;
  sources: FixtureSource[];
} {
  return {
    report: {
      id: evalCase.report.id,
      reportData: evalCase.report.reportData as JsonObject | null,
      periodStart: new Date(evalCase.report.periodStart),
      periodEnd: new Date(evalCase.report.periodEnd),
      modelMetadata: evalCase.report.modelMetadata as JsonObject | null,
    },
    sources: evalCase.sources,
  };
}

/**
 * Summarizes a case's sources and scores the result, as one Phoenix experiment.
 *
 * The dataset holds the *sources*, never the summaries: that keeps it stable
 * while prompts and models change, so every experiment on it is a like-for-like
 * comparison. Each run is a (prompt, provider, model) trial against those same
 * inputs — which is the loop that makes prompt iteration worth measuring.
 *
 * `--stored` scores the summaries already in the case instead of generating,
 * for a free baseline or a model-vs-model comparison over existing text.
 */

export function buildCompareExample(
  evalCase: EvalCase,
  report: FixtureReport,
  sources: FixtureSource[]
) {
  return {
    id: exampleId(evalCase),
    input: {
      workspaceId: evalCase.manifest.workspaceId,
      reportId: report.id,
      periodStart: report.periodStart.toISOString(),
      periodEnd: report.periodEnd.toISOString(),
      sourceCount: sources.length,
      sources: sources.map((s) => ({
        id: s.id,
        title: s.title,
        provider: s.providerName,
        contentText: s.contentText?.slice(0, 2000),
      })),
    },
    output: (report.reportData ?? {}) as Record<string, unknown>,
    metadata: {
      referenceModel: (report.modelMetadata as Record<string, unknown>)
        ?.modelName,
    },
  };
}

/**
 * Judges a case's published reference report with the same scoped judges that
 * score a generated one.
 *
 * This is the other half of the question compare answers: not "is a fresh
 * generation any good" but "was the report we actually shipped any good". It
 * runs on the case's own dataset, so the reference's scores sit beside every
 * generated run's and can be read against them directly.
 *
 * Only the judges run. The deterministic evaluators compare a report to the
 * reference, and here they are the same document, so they would report a
 * perfect score that means nothing.
 */
