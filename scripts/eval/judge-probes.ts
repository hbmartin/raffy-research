/**
 * Sanity checks for the LLM judges.
 *
 * A judge that returns the same score whatever it is shown looks exactly like
 * a judge that is working: the numbers are plausible and stable. The only way
 * to tell the difference is to show it reports whose right score is known
 * relative to the reference, and see whether it agrees.
 *
 * Three kinds of probe, each built from the case's reference report:
 *
 * - degrade: one targeted defect; the judge must score it below the reference,
 *   or -- for probes that name a detail count -- hold the score but itemise
 *   more problems than it found in the reference.
 * - ladder: the same defect at rising severity; scores must not climb, and the
 *   worst rung must land below the reference. A judge that only notices
 *   absurd errors passes a degrade probe and fails here.
 * - invariant: a change that leaves the content untouched (order, layout); the
 *   score must stay within one raw point. A judge that moves here is reacting
 *   to presentation, not quality.
 *
 * Degradations keep every citation unless the citations are the defect, so the
 * judge has to read the claims rather than notice missing evidence.
 */
import type { JudgeEvaluator } from './judge-evaluators';

type Report = Record<string, unknown>;

export type ProbeKind = 'degrade' | 'ladder' | 'invariant';
export type ProbeStatus = 'pass' | 'fail' | 'skip';

export type ProbeResult = {
  probe: string;
  kind: ProbeKind;
  judge: string;
  referenceScore: number | null;
  /** One score per variant: a single one, or one per ladder rung. */
  variantScores: (number | null)[];
  /** Problems the judge itemised, when the probe reads a detail count. */
  referenceDetailCount?: number | null;
  variantDetailCounts?: (number | null)[];
  status: ProbeStatus;
  reason: string;
};

type ProbeBase = {
  name: string;
  judges: readonly string[];
  expectation: string;
  /** How the variant is shown to the judge; the reference always uses the default. */
  serialize?: (report: Report) => string;
};

/** A degradation returns null when the report has nothing it could degrade. */
type Degradation = (report: Report) => Report | null;

export type JudgeProbe =
  | (ProbeBase & {
      kind: 'degrade';
      degrade: Degradation;
      /**
       * Verdict metadata key counting the problems the judge itemised (e.g.
       * `missed_signalsCount`). When set, an unchanged score still passes if
       * the count rose: on a reference already near the bottom of the 1-5
       * scale, the score has nowhere to go, but the list of problems does.
       */
      detailCount?: string;
    })
  | (ProbeBase & { kind: 'ladder'; rungs: Degradation[] })
  | (ProbeBase & { kind: 'invariant'; transform: (report: Report) => Report });

/**
 * One raw point on the judges' 1-5 scale, after normalisation to 0-1. A judge
 * at temperature 0 still drifts a little run to run; a move larger than this
 * is not drift.
 */
export const INVARIANCE_TOLERANCE = 0.25;
const EPSILON = 1e-9;

const ALL_JUDGES = [
  'judge_claim_support',
  'judge_coverage',
  'judge_noise',
] as const;

export const serializeForJudge = (report: Report): string =>
  JSON.stringify(report, null, 1);

const clone = (report: Report): Report =>
  JSON.parse(JSON.stringify(report)) as Report;

const records = (value: unknown): Record<string, unknown>[] =>
  Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === 'object' && !Array.isArray(item)
      )
    : [];

/** Every evidence item in the report: any object carrying a source_ids list. */
function collectEvidence(report: Report): Record<string, unknown>[] {
  const found: Record<string, unknown>[] = [];
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach(walk);
      return;
    }
    const record = value as Record<string, unknown>;
    if (Array.isArray(record.source_ids)) found.push(record);
    Object.values(record).forEach(walk);
  };
  walk(report);
  return found;
}

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
export function fabricateClaims(report: Report): Report {
  const copy = clone(report);
  const summary = copy.executive_summary as Record<string, unknown> | undefined;
  if (summary) summary.bullets = [...FABRICATIONS];
  records(copy.topic_clusters).forEach((cluster, index) => {
    cluster.observation = FABRICATIONS[index % FABRICATIONS.length];
    cluster.why_this_may_matter =
      'This confirms the market has consolidated entirely.';
  });
  return copy;
}

/** Repeats every topic cluster, which is padding by construction. */
export function padWithDuplicates(report: Report, times = 4): Report {
  const copy = clone(report);
  const clusters = (copy.topic_clusters ?? []) as unknown[];
  copy.topic_clusters = Array.from({ length: times }, () => clusters).flat();
  return copy;
}

/**
 * Points every evidence item at another item's sources.
 *
 * The set of cited sources is unchanged, so the claim_support judge is shown
 * exactly the same source records -- only the pairing of claim to source is
 * wrong. A judge that checks "is something cited" passes this report; one
 * that checks "does this source say this" cannot.
 *
 * Rotates over distinct citation sets rather than over items, so two items
 * that already shared a set cannot be handed each other's (identical) ids.
 */
export function swapCitations(report: Report): Report | null {
  const copy = clone(report);
  const evidence = collectEvidence(copy);
  const keyOf = (ids: unknown) => JSON.stringify(ids);
  const distinct = [
    ...new Map(
      evidence.map((item) => [keyOf(item.source_ids), item.source_ids])
    ),
  ];
  if (distinct.length < 2) return null;

  const next = new Map(
    distinct.map(([key], index) => [
      key,
      distinct[(index + 1) % distinct.length]![1],
    ])
  );
  for (const item of evidence) {
    item.source_ids = [...(next.get(keyOf(item.source_ids)) as unknown[])];
  }
  return copy;
}

/**
 * Specific, plausible details that no source in any case supports. Unlike
 * FABRICATIONS they do not announce themselves: the claim around them is real.
 */
export const FALSE_DETAILS = [
  ', cutting no-show rates by 63% within two weeks.',
  ', according to a survey of 4,200 practices published on June 17.',
  ', backed by a $38 million Series B led by Accel.',
];

/** The claims a ladder rung may append to, in order; each is applied only if present. */
const CLAIM_SLOTS: ((report: Report) => {
  get: () => unknown;
  set: (value: string) => void;
} | null)[] = [
  (report) => {
    const bullets = (report.executive_summary as Record<string, unknown>)
      ?.bullets;
    if (!Array.isArray(bullets) || typeof bullets[0] !== 'string') return null;
    return { get: () => bullets[0], set: (value) => (bullets[0] = value) };
  },
  (report) => {
    const cluster = records(report.topic_clusters)[0];
    if (!cluster || typeof cluster.observation !== 'string') return null;
    return {
      get: () => cluster.observation,
      set: (value) => (cluster.observation = value),
    };
  },
  (report) => {
    const item = records(report.what_looks_most_interesting)[0];
    if (!item || typeof item.summary !== 'string') return null;
    return { get: () => item.summary, set: (value) => (item.summary = value) };
  },
];

const withDetail = (claim: string, detail: string) =>
  `${claim.trim().replace(/[.!]+$/, '')}${detail}`;

/**
 * Appends a false detail to the first `count` claims the report has. Returns
 * null when the report has fewer claims than the rung asks for, so a ladder
 * never repeats a rung that changed nothing.
 */
export function fabricateDetails(report: Report, count: number): Report | null {
  const copy = clone(report);
  const slots = CLAIM_SLOTS.map((slot) => slot(copy)).filter(
    (slot) => slot !== null
  );
  if (slots.length < count) return null;
  slots.slice(0, count).forEach((slot, index) => {
    slot.set(withDetail(String(slot.get()), FALSE_DETAILS[index]!));
  });
  return copy;
}

/** Fields that quote a source or identify a record, and so must not be rewritten. */
const VERBATIM_KEYS = new Set([
  'id',
  'excerpt',
  'source_excerpt',
  'source_ids',
  'source_id',
  'source_title',
  'external_url',
  'domain',
]);

/**
 * Swaps two named actors throughout the report's own prose: a competitor and
 * a lead, or two competitors. Quoted excerpts are left alone, so the evidence
 * still names the right actor and the report's attribution contradicts it.
 */
export function misattribute(report: Report): Report | null {
  const copy = clone(report);
  const names = [
    ...records(copy.competitor_watch).map((item) => item.competitor_name),
    ...records(copy.possible_leads).map((item) => item.person_or_company),
  ].filter(
    (name): name is string => typeof name === 'string' && name.trim() !== ''
  );
  const [first, second] = [...new Set(names)];
  if (!first || !second) return null;

  const placeholder = '\u0000ACTOR\u0000';
  const swap = (text: string) =>
    text
      .replaceAll(first, placeholder)
      .replaceAll(second, first)
      .replaceAll(placeholder, second);

  const walk = (value: unknown): unknown => {
    if (typeof value === 'string') return swap(value);
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        VERBATIM_KEYS.has(key) ? inner : walk(inner),
      ])
    );
  };
  return walk(copy) as Report;
}

const keepHalf = (value: unknown) =>
  Array.isArray(value) ? value.slice(0, Math.ceil(value.length / 2)) : value;

/**
 * Removes about half of what the report says while keeping it well-formed:
 * half the clusters and highlights survive, the smaller sections go. The
 * period's sources are unchanged, so everything dropped is still visible to
 * the coverage judge as a signal the report missed.
 */
export function dropContent(report: Report): Report | null {
  const copy = clone(report);
  const before = JSON.stringify(copy);

  copy.topic_clusters = keepHalf(copy.topic_clusters);
  copy.what_looks_most_interesting = keepHalf(copy.what_looks_most_interesting);
  for (const key of [
    'competitor_watch',
    'possible_leads',
    'social_product_feedback',
  ]) {
    if (Array.isArray(copy[key])) copy[key] = [];
  }
  const keptClusters = new Set(
    records(copy.topic_clusters).map((cluster) => cluster.id)
  );
  if (Array.isArray(copy.source_library)) {
    copy.source_library = records(copy.source_library).filter(
      (entry) =>
        entry.topic_cluster_id == null ||
        keptClusters.has(entry.topic_cluster_id)
    );
  }
  return JSON.stringify(copy) === before ? null : copy;
}

/**
 * Reverses the order of every section and of each cluster's evidence. Nothing
 * is added or removed, so a judge whose score moves is weighting position.
 *
 * The executive summary bullets keep their order: they are three fixed items,
 * and reordering them is a different edit from reordering a list of findings.
 */
export function reorderSections(report: Report): Report {
  const copy = clone(report);
  for (const [key, value] of Object.entries(copy)) {
    if (Array.isArray(value)) copy[key] = [...value].reverse();
  }
  for (const cluster of records(copy.topic_clusters)) {
    for (const key of ['all_evidence', 'representative_evidence']) {
      if (Array.isArray(cluster[key]))
        cluster[key] = [...cluster[key]].reverse();
    }
  }
  return copy;
}

/** Same values, keys in reverse order at every level. */
export function reverseKeyOrder(report: Report): Report {
  const walk = (value: unknown): unknown => {
    if (Array.isArray(value)) return value.map(walk);
    if (!value || typeof value !== 'object') return value;
    return Object.fromEntries(
      Object.entries(value)
        .reverse()
        .map(([key, inner]) => [key, walk(inner)])
    );
  };
  return walk(report) as Report;
}

export const JUDGE_PROBES: readonly JudgeProbe[] = [
  {
    name: 'fabricated-claims',
    kind: 'degrade',
    judges: ['judge_claim_support'],
    degrade: fabricateClaims,
    expectation: 'claims no source supports should score below the reference',
  },
  {
    name: 'swapped-citations',
    kind: 'degrade',
    judges: ['judge_claim_support'],
    degrade: swapCitations,
    expectation:
      'claims cited to sources that do not say them should score below the reference',
  },
  {
    name: 'subtle-fabrication-ladder',
    kind: 'ladder',
    judges: ['judge_claim_support'],
    rungs: [1, 2, 3].map(
      (count) => (report: Report) => fabricateDetails(report, count)
    ),
    expectation:
      'each added false detail should score no higher, and the worst below the reference',
  },
  {
    name: 'misattribution',
    kind: 'degrade',
    judges: ['judge_claim_support'],
    degrade: misattribute,
    expectation:
      'claims attributed to the wrong actor should score below the reference',
  },
  {
    name: 'dropped-content',
    kind: 'degrade',
    judges: ['judge_coverage'],
    degrade: dropContent,
    detailCount: 'missed_signalsCount',
    expectation:
      'a report missing half its findings should score below the reference',
  },
  {
    name: 'padded-clusters',
    kind: 'degrade',
    judges: ['judge_noise'],
    degrade: padWithDuplicates,
    expectation: 'every cluster repeated should score below the reference',
  },
  {
    name: 'reordered-sections',
    kind: 'invariant',
    judges: ALL_JUDGES,
    transform: reorderSections,
    expectation: 'the same content in a different order should score the same',
  },
  {
    name: 'reformatted-json',
    kind: 'invariant',
    judges: ALL_JUDGES,
    transform: reverseKeyOrder,
    serialize: (report) => JSON.stringify(report),
    expectation: 'the same content laid out differently should score the same',
  },
];

export const PROBE_NAMES = JUDGE_PROBES.map((probe) => probe.name);

/** Probes to run: all of them, or the named subset. Throws on an unknown name. */
export function selectProbes(only?: readonly string[]): readonly JudgeProbe[] {
  if (!only || only.length === 0) return JUDGE_PROBES;
  const unknown = only.filter((name) => !PROBE_NAMES.includes(name));
  if (unknown.length > 0) {
    throw new Error(
      `Unknown probe: ${unknown.join(', ')}. Known probes: ${PROBE_NAMES.join(', ')}`
    );
  }
  return JUDGE_PROBES.filter((probe) => only.includes(probe.name));
}

/**
 * Upper bound on judge calls: one reference per judge involved, plus one per
 * variant per judge. Skipped probes and missing ladder rungs make it lower.
 */
export function estimateJudgeCalls(probes: readonly JudgeProbe[]): number {
  const judges = new Set(probes.flatMap((probe) => probe.judges));
  const variants = probes.reduce(
    (sum, probe) =>
      sum +
      probe.judges.length * (probe.kind === 'ladder' ? probe.rungs.length : 1),
    0
  );
  return judges.size + variants;
}

const fmt = (score: number | null) =>
  score === null ? 'null' : score.toFixed(2);

type Observation = {
  score: number | null;
  metadata?: Record<string, unknown>;
};

/** The probe's detail count from a verdict, or null when it was not reported. */
const detailCountOf = (observation: Observation, key: string) => {
  const value = observation.metadata?.[key];
  return typeof value === 'number' ? value : null;
};

function judgeOutcome(
  probe: JudgeProbe,
  reference: Observation,
  variants: Observation[]
): { status: ProbeStatus; reason: string } {
  const referenceScore = reference.score;
  const variantScores = variants.map((v) => v.score);
  if (referenceScore === null || variantScores.some((s) => s === null)) {
    return {
      status: 'fail',
      reason: `no usable score (reference ${fmt(referenceScore)}, variants ${variantScores.map(fmt).join(', ')})`,
    };
  }
  const scores = variantScores as number[];

  if (probe.kind === 'invariant') {
    const delta = Math.abs(scores[0]! - referenceScore);
    return delta <= INVARIANCE_TOLERANCE + EPSILON
      ? { status: 'pass', reason: `moved ${delta.toFixed(2)}` }
      : {
          status: 'fail',
          reason: `moved ${fmt(referenceScore)} → ${fmt(scores[0]!)} on a change that should not matter`,
        };
  }

  if (probe.kind === 'ladder') {
    const path = [referenceScore, ...scores];
    const trail = path.map(fmt).join(' → ');
    const climbs = path.some((score, i) => i > 0 && score > path[i - 1]!);
    if (climbs) return { status: 'fail', reason: `not monotonic: ${trail}` };
    if (scores.at(-1)! >= referenceScore) {
      return { status: 'fail', reason: `never dropped: ${trail}` };
    }
    return { status: 'pass', reason: trail };
  }

  const moved = `${fmt(referenceScore)} → ${fmt(scores[0]!)}`;
  if (scores[0]! < referenceScore) return { status: 'pass', reason: moved };

  if (probe.detailCount && Math.abs(scores[0]! - referenceScore) < EPSILON) {
    const before = detailCountOf(reference, probe.detailCount);
    const after = detailCountOf(variants[0]!, probe.detailCount);
    const counted = `${probe.detailCount} ${before ?? 'null'} → ${after ?? 'null'}`;
    if (before !== null && after !== null && after > before) {
      return { status: 'pass', reason: `${moved}, but ${counted}` };
    }
    return { status: 'fail', reason: `did not notice: ${moved}, ${counted}` };
  }

  return { status: 'fail', reason: `did not notice: ${moved}` };
}

export async function runJudgeProbes(input: {
  judges: JudgeEvaluator[];
  reference: Report;
  sources: unknown[];
  log: (message: string, data?: Record<string, unknown>) => void;
  only?: readonly string[];
}): Promise<ProbeResult[]> {
  const probes = selectProbes(input.only);
  const results: ProbeResult[] = [];

  const observe = async (
    judge: JudgeEvaluator,
    report: Report,
    probe?: JudgeProbe
  ): Promise<Observation> => {
    const verdict = await judge.evaluate({
      reportJson: (probe?.serialize ?? serializeForJudge)(report),
      reportData: report,
      sources: input.sources as Parameters<typeof judge.evaluate>[0]['sources'],
    });
    return { score: verdict.score, metadata: verdict.metadata };
  };

  // Every probe compares against the same reference, so each judge reads it
  // once. Re-scoring it per probe doubled the cost of a run for no signal.
  const referenceVerdicts = new Map<string, Promise<Observation>>();
  const referenceVerdict = (judge: JudgeEvaluator) => {
    let cached = referenceVerdicts.get(judge.name);
    if (!cached) {
      cached = observe(judge, input.reference);
      referenceVerdicts.set(judge.name, cached);
    }
    return cached;
  };

  for (const probe of probes) {
    const variants =
      probe.kind === 'invariant'
        ? [probe.transform(input.reference)]
        : probe.kind === 'ladder'
          ? probe.rungs
              .map((rung) => rung(input.reference))
              .filter((variant) => variant !== null)
          : [probe.degrade(input.reference)].filter(
              (variant) => variant !== null
            );
    const minimum = probe.kind === 'ladder' ? 2 : 1;

    for (const judgeName of probe.judges) {
      const judge = input.judges.find((j) => j.name === judgeName);
      if (!judge) continue;

      if (variants.length < minimum) {
        const result: ProbeResult = {
          probe: probe.name,
          kind: probe.kind,
          judge: judgeName,
          referenceScore: null,
          variantScores: [],
          status: 'skip',
          reason: 'the reference report has nothing this probe can change',
        };
        input.log(`${probe.name}: skipped — ${result.reason}`, {
          judge: judgeName,
        });
        results.push(result);
        continue;
      }

      const reference = await referenceVerdict(judge);
      const observed: Observation[] = [];
      for (const variant of variants) {
        observed.push(await observe(judge, variant, probe));
      }
      const outcome = judgeOutcome(probe, reference, observed);
      const countKey = probe.kind === 'degrade' ? probe.detailCount : undefined;
      const counts = countKey
        ? {
            referenceDetailCount: detailCountOf(reference, countKey),
            variantDetailCounts: observed.map((o) =>
              detailCountOf(o, countKey)
            ),
          }
        : {};

      input.log(
        outcome.status === 'pass'
          ? `${probe.name}: PASS — ${outcome.reason}`
          : `${probe.name}: FAIL — ${outcome.reason} (${probe.expectation})`,
        { judge: judgeName, kind: probe.kind }
      );
      results.push({
        probe: probe.name,
        kind: probe.kind,
        judge: judgeName,
        referenceScore: reference.score,
        variantScores: observed.map((o) => o.score),
        ...counts,
        ...outcome,
      });
    }
  }

  return results;
}
