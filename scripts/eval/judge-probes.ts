/**
 * Sanity checks for the LLM judges.
 *
 * A judge that returns the same score whatever it is shown looks exactly like
 * a judge that is working: the numbers are plausible and stable. The only way
 * to tell the difference is to hand it a report it must mark down and see
 * whether it does.
 *
 * Each probe degrades the case's reference report in a way that targets one
 * judge, leaving everything else intact. Citations in particular are kept, so
 * the judge has to read the claims rather than notice missing evidence.
 */
import type { JudgeEvaluator } from './judge-evaluators';

export type ProbeResult = {
  probe: string;
  judge: string;
  referenceScore: number | null;
  degradedScore: number | null;
  /** True when the judge scored the degraded report below the reference. */
  discriminated: boolean;
};

const clone = (report: Record<string, unknown>): Record<string, unknown> =>
  JSON.parse(JSON.stringify(report)) as Record<string, unknown>;

const FABRICATIONS = [
  'ClinicFlow was acquired by Google for $4.2 billion this week.',
  'Dental no-show rates across the category fell 97% after a new FDA mandate.',
  'Every competitor has now shut down its patient-scheduling product.',
];

/**
 * Replaces the report's assertions with claims no source supports, while
 * leaving every source_id in place. A judge that reads has to mark this down;
 * one that anchors on the scale will not notice.
 */
export function fabricateClaims(
  report: Record<string, unknown>
): Record<string, unknown> {
  const copy = clone(report);
  const summary = copy.executive_summary as Record<string, unknown> | undefined;
  if (summary) summary.bullets = [...FABRICATIONS];
  const clusters = (copy.topic_clusters ?? []) as Record<string, unknown>[];
  clusters.forEach((cluster, index) => {
    cluster.observation = FABRICATIONS[index % FABRICATIONS.length];
    cluster.why_this_may_matter =
      'This confirms the market has consolidated entirely.';
  });
  return copy;
}

/** Repeats every topic cluster, which is padding by construction. */
export function padWithDuplicates(
  report: Record<string, unknown>,
  times = 4
): Record<string, unknown> {
  const copy = clone(report);
  const clusters = (copy.topic_clusters ?? []) as unknown[];
  copy.topic_clusters = Array.from({ length: times }, () => clusters).flat();
  return copy;
}

export const JUDGE_PROBES = [
  {
    name: 'fabricated-claims',
    judge: 'judge_claim_support',
    degrade: fabricateClaims,
    expectation: 'claims no source supports should score below the reference',
  },
  {
    name: 'padded-clusters',
    judge: 'judge_noise',
    degrade: padWithDuplicates,
    expectation: 'every cluster repeated should score below the reference',
  },
] as const;

export async function runJudgeProbes(input: {
  judges: JudgeEvaluator[];
  reference: Record<string, unknown>;
  sources: unknown[];
  log: (message: string, data?: Record<string, unknown>) => void;
}): Promise<ProbeResult[]> {
  const results: ProbeResult[] = [];

  for (const probe of JUDGE_PROBES) {
    const judge = input.judges.find((j) => j.name === probe.judge);
    if (!judge) continue;

    const score = async (report: Record<string, unknown>) =>
      (
        await judge.evaluate({
          reportJson: JSON.stringify(report, null, 1),
          reportData: report,
          sources: input.sources as Parameters<
            typeof judge.evaluate
          >[0]['sources'],
        })
      ).score;

    const referenceScore = await score(input.reference);
    const degradedScore = await score(probe.degrade(input.reference));
    const discriminated =
      referenceScore !== null &&
      degradedScore !== null &&
      degradedScore < referenceScore;

    input.log(
      discriminated
        ? `${probe.name}: judge marked the degraded report down`
        : `${probe.name}: judge did NOT notice — ${probe.expectation}`,
      { judge: probe.judge, referenceScore, degradedScore }
    );
    results.push({
      probe: probe.name,
      judge: probe.judge,
      referenceScore,
      degradedScore,
      discriminated,
    });
  }

  return results;
}
