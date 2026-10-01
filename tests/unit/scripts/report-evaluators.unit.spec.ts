import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  REPORT_EVALUATORS,
  type ReportEvaluatorArgs,
} from '../../../scripts/eval/report-evaluators';

const score = (name: string, args: ReportEvaluatorArgs) => {
  const evaluator = REPORT_EVALUATORS.find((e) => e.name === name);
  if (!evaluator) throw new Error(`no evaluator named ${name}`);
  return evaluator.evaluate(args);
};

const input = (ids: string[]) => ({
  sourceCount: ids.length,
  sources: ids.map((id) => ({ id, title: id, provider: 'exa' })),
});

describe('source_utilization', () => {
  it('counts only citations to sources that were offered', () => {
    const result = score('source_utilization', {
      input: input(['s1', 's2']),
      output: {
        topic_clusters: [
          {
            id: 'c1',
            representative_evidence: [{ id: 'e1', source_ids: ['s1'] }],
          },
        ],
      },
    });
    expect(result.score).toBe(0.5);
    expect(result.metadata?.inventedCount).toBe(0);
  });

  it('does not let invented citations push the score above 1', () => {
    // Previously cited ÷ available, so three fabricated ids over two sources
    // scored 1.5 -- rewarding the failure this is meant to expose.
    const result = score('source_utilization', {
      input: input(['s1', 's2']),
      output: {
        topic_clusters: [
          {
            id: 'c1',
            representative_evidence: [
              { id: 'e1', source_ids: ['ghost-1', 'ghost-2', 'ghost-3'] },
            ],
          },
        ],
      },
    });
    expect(result.score).toBe(0);
    expect(result.metadata?.inventedCount).toBe(3);
    expect(result.label).toContain('invented');
  });

  it('separates real citations from invented ones', () => {
    const result = score('source_utilization', {
      input: input(['s1', 's2']),
      output: {
        topic_clusters: [
          {
            id: 'c1',
            representative_evidence: [{ source_ids: ['s1', 'ghost'] }],
          },
        ],
      },
    });
    expect(result.score).toBe(0.5);
    expect(result.metadata?.inventedCount).toBe(1);
  });
});

describe('lead_overlap', () => {
  const reference = {
    possible_leads: [{ id: 'lead_1', person_or_company: 'Smile Brands' }],
  };

  it('matches the entity even when the generated id differs', () => {
    // Ids are generated per run, so comparing them scored zero however well
    // the two reports agreed.
    const result = score('lead_overlap', {
      input: input([]),
      output: {
        possible_leads: [
          { id: 'completely-different-id', person_or_company: 'Smile Brands' },
        ],
      },
      expected: reference,
    });
    expect(result.score).toBe(1);
  });

  it('ignores case and surrounding whitespace in the name', () => {
    const result = score('lead_overlap', {
      input: input([]),
      output: {
        possible_leads: [{ id: 'x', person_or_company: '  smile brands ' }],
      },
      expected: reference,
    });
    expect(result.score).toBe(1);
  });

  it('scores a different company as no overlap', () => {
    const result = score('lead_overlap', {
      input: input([]),
      output: {
        possible_leads: [{ id: 'lead_1', person_or_company: 'Other Co' }],
      },
      expected: reference,
    });
    expect(result.score).toBe(0);
  });
});

describe('evidence_density', () => {
  it('counts each evidence item once across both arrays', () => {
    // all_evidence and representative_evidence overlap, so summing them
    // reported double the real density.
    const result = score('evidence_density', {
      input: input([]),
      output: {
        topic_clusters: [
          {
            id: 'c1',
            representative_evidence: [{ id: 'e1' }],
            all_evidence: [{ id: 'e1' }, { id: 'e2' }],
          },
        ],
      },
    });
    expect(result.score).toBe(2);
    expect(result.metadata?.totalEvidence).toBe(2);
  });

  it('matches the committed reference fixture', () => {
    const report = JSON.parse(
      readFileSync('fixtures/eval/aperture-2026-06-15/report.json', 'utf8')
    ) as { reportData: Record<string, unknown> };
    const result = score('evidence_density', {
      input: input([]),
      output: report.reportData,
    });
    // Two clusters, each repeating one evidence item in both arrays.
    expect(result.metadata?.totalEvidence).toBe(2);
    expect(result.score).toBe(1);
  });

  it('returns null rather than dividing by zero', () => {
    expect(
      score('evidence_density', {
        input: input([]),
        output: { topic_clusters: [] },
      })
    ).toMatchObject({ score: null });
  });
});

describe('validity metrics', () => {
  const report = (extra: Record<string, unknown>) => ({
    input: input([]),
    output: { topic_clusters: [], ...extra },
  });

  it('separates what the model managed from what the pipeline delivered', () => {
    const repaired = report({ __firstAttemptValid: false, __repaired: true });
    // The pipeline delivered a valid report; the model did not manage it
    // unaided. Collapsing these hid how often a repair was needed.
    expect(score('valid_json', repaired)).toMatchObject({
      score: 1,
      label: 'valid after repair',
    });
    expect(score('first_attempt_valid', repaired)).toMatchObject({
      score: 0,
      label: 'needed repair',
    });
  });

  it('scores both when the first attempt was already valid', () => {
    const clean = report({ __firstAttemptValid: true, __repaired: false });
    expect(score('valid_json', clean)).toMatchObject({
      score: 1,
      label: 'valid',
    });
    expect(score('first_attempt_valid', clean)).toMatchObject({ score: 1 });
  });

  it('scores both zero when the repair failed too', () => {
    const failed = {
      input: input([]),
      output: {
        parseError: true,
        __firstAttemptValid: false,
        __repaired: true,
      },
    };
    expect(score('valid_json', failed)).toMatchObject({ score: 0 });
    expect(score('first_attempt_valid', failed)).toMatchObject({ score: 0 });
  });

  it('reports no score for runs recorded before the repair pass existed', () => {
    expect(score('first_attempt_valid', report({}))).toMatchObject({
      score: null,
      label: 'unknown',
    });
  });
});

describe('stripRunMetadata', () => {
  it('removes the bookkeeping a judge should not read as prose', async () => {
    const { stripRunMetadata } = await import('../../../scripts/eval/fixtures');
    expect(
      stripRunMetadata({
        title: 'Weekly digest',
        __firstAttemptValid: false,
        __repaired: true,
      })
    ).toEqual({ title: 'Weekly digest' });
  });
});
