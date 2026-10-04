import { describe, expect, it, vi } from 'vitest';

import {
  dropContent,
  estimateJudgeCalls,
  fabricateClaims,
  fabricateDetails,
  FALSE_DETAILS,
  JUDGE_PROBES,
  misattribute,
  padWithDuplicates,
  PROBE_NAMES,
  reorderSections,
  reverseKeyOrder,
  runJudgeProbes,
  selectProbes,
  swapCitations,
} from '../../../scripts/eval/judge-probes';

const reference = {
  executive_summary: {
    bullets: ['Scheduling AI is spreading.', 'b', 'c'],
  },
  topic_clusters: [
    {
      id: 'c1',
      observation: 'Acme rolled out reminders.',
      why_this_may_matter: 'Because of evidence',
      representative_evidence: [{ id: 'e1', source_ids: ['s1'] }],
      all_evidence: [
        { id: 'e1', source_ids: ['s1'] },
        { id: 'e2', source_ids: ['s2'], excerpt: 'Acme said so' },
      ],
    },
    {
      id: 'c2',
      observation: 'Second cluster',
      all_evidence: [{ id: 'e3', source_ids: ['s3'] }],
    },
  ],
  what_looks_most_interesting: [
    { id: 'w1', summary: 'Beta Dental adopts analytics.', evidence: [] },
    { id: 'w2', summary: 'Other', evidence: [] },
  ],
  competitor_watch: [
    { id: 'cw1', competitor_name: 'Acme', observation: 'Acme ships X' },
  ],
  possible_leads: [{ id: 'l1', person_or_company: 'Beta Dental' }],
  social_product_feedback: [{ id: 'sp1', summary: 'Users like it' }],
  source_library: [
    { source_id: 's1', topic_cluster_id: 'c1' },
    { source_id: 's3', topic_cluster_id: 'c2' },
    { source_id: 's9' },
  ],
};

type Report = Record<string, unknown>;
/** Content regardless of array order and key order. */
const canonical = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value
      .map(canonical)
      .map((item) => JSON.stringify(item))
      .sort();
  }
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, inner]) => [key, canonical(inner)])
  );
};

const clusters = (report: Report) =>
  report.topic_clusters as Record<string, unknown>[];

describe('degradations', () => {
  it('replaces the claims but keeps every citation', () => {
    const bad = fabricateClaims(reference);
    const cluster = clusters(bad)[0]!;
    expect(cluster.observation).not.toBe('Acme rolled out reminders.');
    // The citation must survive, or the judge marks it down for the wrong
    // reason and the probe proves nothing.
    expect(cluster.representative_evidence).toEqual([
      { id: 'e1', source_ids: ['s1'] },
    ]);
  });

  it('never mutates the report it is given', () => {
    const before = JSON.stringify(reference);
    fabricateClaims(reference);
    padWithDuplicates(reference);
    swapCitations(reference);
    fabricateDetails(reference, 3);
    misattribute(reference);
    dropContent(reference);
    reorderSections(reference);
    reverseKeyOrder(reference);
    expect(JSON.stringify(reference)).toBe(before);
  });

  it('repeats every cluster when padding', () => {
    const padded = padWithDuplicates(reference, 3);
    expect(clusters(padded)).toHaveLength(6);
  });

  describe('swapCitations', () => {
    const idsOf = (report: Report) =>
      clusters(report).flatMap((cluster) =>
        ((cluster.all_evidence ?? []) as { source_ids: string[] }[]).map(
          (item) => item.source_ids.join()
        )
      );

    it('gives every evidence item a different citation set', () => {
      const swapped = swapCitations(reference)!;
      const before = idsOf(reference);
      const after = idsOf(swapped);
      after.forEach((ids, index) => expect(ids).not.toBe(before[index]));
    });

    it('keeps the set of cited sources unchanged', () => {
      const swapped = swapCitations(reference)!;
      expect(new Set(idsOf(swapped))).toEqual(new Set(idsOf(reference)));
    });

    it('does not hand an item a set identical to its own', () => {
      // e1 appears twice with the same ids; rotating items would pair them.
      const swapped = swapCitations(reference)!;
      const representative = clusters(swapped)[0]!.representative_evidence as {
        source_ids: string[];
      }[];
      expect(representative[0]!.source_ids).not.toEqual(['s1']);
    });

    it('skips a report with a single citation set', () => {
      expect(
        swapCitations({
          topic_clusters: [{ all_evidence: [{ source_ids: ['s1'] }] }],
        })
      ).toBeNull();
    });
  });

  describe('fabricateDetails', () => {
    it('adds a false detail to exactly n claims', () => {
      const allText = (report: Report) => JSON.stringify(report);
      for (const count of [1, 2, 3]) {
        const text = allText(fabricateDetails(reference, count)!);
        const added = FALSE_DETAILS.filter((detail) => text.includes(detail));
        expect(added).toHaveLength(count);
      }
    });

    it('joins the detail to the claim instead of after its full stop', () => {
      const bad = fabricateDetails(reference, 1)!;
      const bullet = (bad.executive_summary as { bullets: string[] })
        .bullets[0];
      expect(bullet).toBe(`Scheduling AI is spreading${FALSE_DETAILS[0]}`);
    });

    it('returns null when the report has too few claims for the rung', () => {
      expect(
        fabricateDetails({ executive_summary: { bullets: ['only one'] } }, 2)
      ).toBeNull();
    });
  });

  describe('misattribute', () => {
    it('swaps the two actors in names and prose', () => {
      const bad = misattribute(reference)!;
      const watch = (bad.competitor_watch as Record<string, string>[])[0]!;
      expect(watch.competitor_name).toBe('Beta Dental');
      expect(watch.observation).toBe('Beta Dental ships X');
      expect(clusters(bad)[0]!.observation).toBe(
        'Beta Dental rolled out reminders.'
      );
      expect(
        (bad.what_looks_most_interesting as Record<string, string>[])[0]!
          .summary
      ).toBe('Acme adopts analytics.');
    });

    it('leaves quoted excerpts and ids alone', () => {
      const bad = misattribute(reference)!;
      const evidence = clusters(bad)[0]!.all_evidence as Record<
        string,
        unknown
      >[];
      expect(evidence[1]).toEqual({
        id: 'e2',
        source_ids: ['s2'],
        excerpt: 'Acme said so',
      });
    });

    it('skips a report naming fewer than two actors', () => {
      expect(
        misattribute({ competitor_watch: [{ competitor_name: 'Acme' }] })
      ).toBeNull();
    });
  });

  describe('dropContent', () => {
    it('keeps half the findings and clears the small sections', () => {
      const bad = dropContent(reference)!;
      expect(clusters(bad).map((c) => c.id)).toEqual(['c1']);
      expect(bad.what_looks_most_interesting).toHaveLength(1);
      expect(bad.competitor_watch).toEqual([]);
      expect(bad.possible_leads).toEqual([]);
      expect(bad.social_product_feedback).toEqual([]);
    });

    it('drops library entries for removed clusters only', () => {
      const bad = dropContent(reference)!;
      expect(
        (bad.source_library as { source_id: string }[]).map((e) => e.source_id)
      ).toEqual(['s1', 's9']);
    });

    it('returns null when there is nothing to drop', () => {
      expect(dropContent({ title: 'empty' })).toBeNull();
    });
  });
});

describe('invariance transforms', () => {
  it('reorders sections without changing content', () => {
    const reordered = reorderSections(reference);
    expect(clusters(reordered).map((c) => c.id)).toEqual(['c2', 'c1']);
    expect(canonical(reordered)).toEqual(canonical(reference));
  });

  it('keeps the executive summary bullets in order', () => {
    expect(reorderSections(reference).executive_summary).toEqual(
      reference.executive_summary
    );
  });

  it('reverses key order without changing values', () => {
    const reversed = reverseKeyOrder(reference);
    expect(Object.keys(reversed)).toEqual(Object.keys(reference).reverse());
    expect(reversed).toEqual(reference);
  });

  it('shows the reformatted report compactly', () => {
    const probe = JUDGE_PROBES.find((p) => p.name === 'reformatted-json')!;
    expect(probe.serialize?.(reference)).not.toContain('\n');
  });
});

describe('selectProbes / estimateJudgeCalls', () => {
  it('runs every probe by default', () => {
    expect(selectProbes()).toBe(JUDGE_PROBES);
    expect(selectProbes([])).toBe(JUDGE_PROBES);
  });

  it('selects the named probes', () => {
    expect(selectProbes(['padded-clusters']).map((p) => p.name)).toEqual([
      'padded-clusters',
    ]);
  });

  it('rejects an unknown probe name, listing the known ones', () => {
    expect(() => selectProbes(['nope'])).toThrow(PROBE_NAMES.join(', '));
  });

  it('counts one reference per judge plus every variant', () => {
    // 1 claim_support reference + 3 ladder rungs.
    expect(
      estimateJudgeCalls(selectProbes(['subtle-fabrication-ladder']))
    ).toBe(4);
    // 3 references + one variant per judge.
    expect(estimateJudgeCalls(selectProbes(['reordered-sections']))).toBe(6);
  });
});

describe('runJudgeProbes', () => {
  /**
   * Fake judges that score by looking at the report, so the result does not
   * depend on call order. `rate` sees the report as the judge was shown it.
   */
  const fakeJudges = (
    rate: (judge: string, reportJson: string, report: Report) => number | null
  ) =>
    ['judge_claim_support', 'judge_coverage', 'judge_noise'].map((name) => ({
      name,
      evaluate: vi.fn(
        async (args: { reportJson: string; reportData: unknown }) => ({
          score: rate(name, args.reportJson, args.reportData as Report),
        })
      ),
    }));

  const run = (
    judges: ReturnType<typeof fakeJudges>,
    only?: string[],
    report: Report = reference
  ) =>
    runJudgeProbes({
      judges: judges as never,
      reference: report,
      sources: [],
      log: () => undefined,
      only,
    });

  const isReference = (report: Report) =>
    JSON.stringify(report) === JSON.stringify(reference);

  it('scores the reference once per judge across all probes', async () => {
    const judges = fakeJudges(() => 0.5);
    await run(judges, [
      'fabricated-claims',
      'swapped-citations',
      'misattribution',
    ]);
    const claim = judges[0]!.evaluate;
    const referenceCalls = claim.mock.calls.filter(([args]) =>
      isReference(args.reportData as Report)
    );
    expect(referenceCalls).toHaveLength(1);
    // 1 reference + 3 variants.
    expect(claim).toHaveBeenCalledTimes(4);
  });

  /** A working judge: full marks for the reference content in any layout. */
  const rateByContent = (_: string, __: string, report: Report) =>
    JSON.stringify(canonical(report)) === JSON.stringify(canonical(reference))
      ? 1
      : 0.25;

  it('passes a judge that marks every degradation down and ignores layout', async () => {
    const results = await run(fakeJudges(rateByContent));
    expect(results.filter((r) => r.status !== 'pass')).toEqual([]);
  });

  it('fails a judge that returns the same score for everything degraded', async () => {
    const results = await run(
      fakeJudges(() => 0.5),
      ['fabricated-claims', 'dropped-content', 'padded-clusters']
    );
    expect(results.map((r) => r.status)).toEqual(['fail', 'fail', 'fail']);
    expect(results[0]!.reason).toContain('did not notice');
  });

  describe('ladder', () => {
    const ladder = (scores: number[]) => {
      const byDetails = (report: Report) => {
        const text = JSON.stringify(report);
        return FALSE_DETAILS.filter((detail) => text.includes(detail)).length;
      };
      return run(
        fakeJudges((_, __, report) => scores[byDetails(report)] ?? null),
        ['subtle-fabrication-ladder']
      );
    };

    it('passes falling scores', async () => {
      const [result] = await ladder([1, 0.75, 0.5, 0.25]);
      expect(result!.status).toBe('pass');
      expect(result!.variantScores).toEqual([0.75, 0.5, 0.25]);
    });

    it('passes flat steps as long as the worst rung drops', async () => {
      const [result] = await ladder([1, 1, 0.75, 0.75]);
      expect(result!.status).toBe('pass');
    });

    it('fails a score that climbs back up', async () => {
      const [result] = await ladder([1, 0.5, 0.75, 0.25]);
      expect(result!.status).toBe('fail');
      expect(result!.reason).toContain('not monotonic');
    });

    it('fails a judge that never drops', async () => {
      const [result] = await ladder([0.75, 0.75, 0.75, 0.75]);
      expect(result!.status).toBe('fail');
      expect(result!.reason).toContain('never dropped');
    });
  });

  describe('invariance', () => {
    const shifted = (delta: number) =>
      run(
        fakeJudges((_, __, report) =>
          isReference(report) ? 0.75 : 0.75 - delta
        ),
        ['reordered-sections']
      );

    it('passes a move within one raw point', async () => {
      const results = await shifted(0.25);
      expect(results).toHaveLength(3);
      expect(results.every((r) => r.status === 'pass')).toBe(true);
    });

    it('fails a move beyond one raw point', async () => {
      const results = await shifted(0.5);
      expect(results.every((r) => r.status === 'fail')).toBe(true);
      expect(results[0]!.reason).toContain('should not matter');
    });

    it('shows the variant with the probe serializer', async () => {
      const judges = fakeJudges(() => 0.5);
      await run(judges, ['reformatted-json']);
      const shown = judges[0]!.evaluate.mock.calls.map(
        ([args]) => args.reportJson
      );
      expect(shown.some((json) => !json.includes('\n'))).toBe(true);
      expect(shown.some((json) => json.includes('\n'))).toBe(true);
    });
  });

  describe('detail count fallback', () => {
    /**
     * Judges that score the reference and the variant as given, itemising
     * `refCount` problems in the reference and `variantCount` in the variant.
     */
    const counting = (
      [refScore, variantScore]: [number, number],
      [refCount, variantCount]: [number | null, number | null],
      key = 'missed_signalsCount'
    ) =>
      ['judge_claim_support', 'judge_coverage', 'judge_noise'].map((name) => ({
        name,
        evaluate: vi.fn(async (args: { reportData: unknown }) => {
          const atReference = isReference(args.reportData as Report);
          const count = atReference ? refCount : variantCount;
          return {
            score: atReference ? refScore : variantScore,
            metadata: count === null ? {} : { [key]: count },
          };
        }),
      }));

    const dropped = (judges: ReturnType<typeof counting>) =>
      run(judges as never, ['dropped-content']);

    it('passes a held score when the judge itemises more missed signals', async () => {
      const [result] = await dropped(counting([0.25, 0.25], [8, 10]));
      expect(result!.status).toBe('pass');
      expect(result!.reason).toContain('missed_signalsCount 8 → 10');
      expect(result!.referenceDetailCount).toBe(8);
      expect(result!.variantDetailCounts).toEqual([10]);
    });

    it('fails a held score when the count does not rise', async () => {
      const [result] = await dropped(counting([0.25, 0.25], [8, 8]));
      expect(result!.status).toBe('fail');
      expect(result!.reason).toContain('did not notice');
    });

    it('fails a held score when the count was not reported', async () => {
      const [result] = await dropped(counting([0.25, 0.25], [null, 10]));
      expect(result!.status).toBe('fail');
    });

    it('still fails a score that rises, whatever the count', async () => {
      const [result] = await dropped(counting([0.25, 0.5], [8, 12]));
      expect(result!.status).toBe('fail');
    });

    it('still passes a score that drops, without consulting the count', async () => {
      const [result] = await dropped(counting([0.5, 0.25], [8, 3]));
      expect(result!.status).toBe('pass');
    });

    it('is not used by probes that do not name a count', async () => {
      const [result] = await run(
        counting([0.5, 0.5], [2, 9], 'violationsCount') as never,
        ['fabricated-claims']
      );
      expect(result!.status).toBe('fail');
      expect(result!.referenceDetailCount).toBeUndefined();
    });
  });

  it('treats an unscored verdict as a failure', async () => {
    const results = await run(
      fakeJudges(() => null),
      ['fabricated-claims']
    );
    expect(results[0]!.status).toBe('fail');
    expect(results[0]!.reason).toContain('no usable score');
  });

  it('skips a probe the report gives nothing to change, without calling the judge', async () => {
    const judges = fakeJudges(() => 0.5);
    const results = await run(judges, ['misattribution'], {
      executive_summary: { bullets: ['a', 'b', 'c'] },
    });
    expect(results[0]!.status).toBe('skip');
    expect(judges[0]!.evaluate).not.toHaveBeenCalled();
  });

  it('ignores probes for judges that are not provided', async () => {
    const results = await runJudgeProbes({
      judges: fakeJudges(() => 0.5).slice(2) as never,
      reference,
      sources: [],
      log: () => undefined,
      only: ['fabricated-claims', 'padded-clusters'],
    });
    expect(results.map((r) => r.probe)).toEqual(['padded-clusters']);
  });
});
