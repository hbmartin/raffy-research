import { describe, expect, it, vi } from 'vitest';

import {
  fabricateClaims,
  JUDGE_PROBES,
  padWithDuplicates,
  runJudgeProbes,
} from '../../../scripts/eval/judge-probes';

const reference = {
  executive_summary: { bullets: ['a', 'b', 'c'] },
  topic_clusters: [
    {
      id: 'c1',
      observation: 'Real observation',
      why_this_may_matter: 'Because of evidence',
      representative_evidence: [{ id: 'e1', source_ids: ['s1'] }],
    },
  ],
};

describe('degradations', () => {
  it('replaces the claims but keeps every citation', () => {
    const bad = fabricateClaims(reference);
    const cluster = (bad.topic_clusters as Record<string, unknown>[])[0]!;
    expect(cluster.observation).not.toBe('Real observation');
    // The citation must survive, or the judge marks it down for the wrong
    // reason and the probe proves nothing.
    expect(cluster.representative_evidence).toEqual([
      { id: 'e1', source_ids: ['s1'] },
    ]);
  });

  it('does not mutate the report it is given', () => {
    const before = JSON.stringify(reference);
    fabricateClaims(reference);
    padWithDuplicates(reference);
    expect(JSON.stringify(reference)).toBe(before);
  });

  it('repeats every cluster when padding', () => {
    const padded = padWithDuplicates(reference, 3);
    expect((padded.topic_clusters as unknown[]).length).toBe(3);
  });
});

describe('runJudgeProbes', () => {
  /** Each judge is asked twice: reference first, then the degraded report. */
  const judgeScoring = (
    claimSupport: [number, number],
    noise: [number, number]
  ) => {
    const queues: Record<string, number[]> = {
      judge_claim_support: [...claimSupport],
      judge_noise: [...noise],
    };
    return Object.keys(queues).map((name) => ({
      name,
      evaluate: vi.fn(async () => ({ score: queues[name]!.shift() ?? null })),
    }));
  };

  it('passes a judge that marks the degraded report down', async () => {
    const results = await runJudgeProbes({
      judges: judgeScoring([1, 0.25], [1, 0.5]) as never,
      reference,
      sources: [],
      log: () => undefined,
    });
    expect(results.every((r) => r.discriminated)).toBe(true);
    expect(results).toHaveLength(JUDGE_PROBES.length);
  });

  it('fails a judge that returns the same score for both', async () => {
    const results = await runJudgeProbes({
      judges: judgeScoring([0.5, 0.5], [0.5, 0.5]) as never,
      reference,
      sources: [],
      log: () => undefined,
    });
    expect(results.every((r) => !r.discriminated)).toBe(true);
  });

  it('fails a judge that scores the degraded report higher', async () => {
    const results = await runJudgeProbes({
      judges: judgeScoring([0.5, 0.75], [0.5, 0.75]) as never,
      reference,
      sources: [],
      log: () => undefined,
    });
    expect(results[0]?.discriminated).toBe(false);
  });

  it('treats an unscored verdict as no discrimination', async () => {
    const judges = [
      {
        name: 'judge_claim_support',
        evaluate: vi.fn(async () => ({ score: null })),
      },
    ];
    const results = await runJudgeProbes({
      judges: judges as never,
      reference,
      sources: [],
      log: () => undefined,
    });
    expect(results[0]?.discriminated).toBe(false);
  });
});
