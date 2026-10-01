import { describe, expect, it, vi } from 'vitest';

import {
  buildClaimSupportPrompt,
  buildCoveragePrompt,
  buildNoisePrompt,
  CLAIM_SUPPORT_CONTENT_LIMIT,
  collectCitedSourceIds,
  COVERAGE_CONTENT_LIMIT,
} from '@/modules/intelligence';

import {
  createJudgeEvaluators,
  extractVerdict,
  normalizeScore,
  parseJudgeVerdict,
} from '../../../scripts/eval/judge-evaluators';

const source = (id: string, content = 'x'.repeat(9000)) =>
  ({
    id,
    providerName: 'exa',
    sourceType: 'web_page',
    title: `Title ${id}`,
    authorOrAccount: null,
    externalUrl: null,
    contentText: content,
    diffAddedText: null,
    diffRemovedText: null,
    relevanceLabel: null,
  }) as never;

const reportData = {
  title: 'Weekly digest',
  topic_clusters: [
    {
      id: 'c1',
      representative_evidence: [{ id: 'e1', source_ids: ['s1', 's2'] }],
    },
  ],
  source_library: [{ source_id: 's3', relation_type: 'cited' }],
};

describe('collectCitedSourceIds', () => {
  it('takes the union of evidence source_ids and the bibliography', () => {
    expect(collectCitedSourceIds(reportData).sort()).toEqual([
      's1',
      's2',
      's3',
    ]);
  });

  it('returns nothing for a report that cites nothing', () => {
    expect(collectCitedSourceIds({ title: 'x', topic_clusters: [] })).toEqual(
      []
    );
  });
});

describe('judge prompts', () => {
  it('gives cited sources a generous budget and coverage a small one', () => {
    const claim = buildClaimSupportPrompt({
      reportJson: '{}',
      sources: [source('s1')],
    });
    const coverage = buildCoveragePrompt({
      reportJson: '{}',
      sources: [source('s1')],
    });
    expect(claim).toContain('x'.repeat(CLAIM_SUPPORT_CONTENT_LIMIT));
    expect(claim).not.toContain('x'.repeat(CLAIM_SUPPORT_CONTENT_LIMIT + 1));
    expect(coverage).toContain('x'.repeat(COVERAGE_CONTENT_LIMIT));
    expect(coverage).not.toContain('x'.repeat(COVERAGE_CONTENT_LIMIT + 1));
    // Coverage must stay far smaller, since it carries every source.
    expect(coverage.length).toBeLessThan(claim.length);
  });

  it('asks the noise judge to read the report without any sources', () => {
    const prompt = buildNoisePrompt({ reportJson: '{"title":"x"}' });
    expect(prompt).toContain('=== REPORT ===');
    expect(prompt).not.toContain('SOURCES');
  });
});

describe('verdict validation', () => {
  it('maps a valid 1-5 score onto 0-1', () => {
    expect(normalizeScore(1)).toBe(0);
    expect(normalizeScore(3)).toBe(0.5);
    expect(normalizeScore(5)).toBe(1);
  });

  it('accepts a well-formed verdict', () => {
    const result = parseJudgeVerdict('{"score":4,"explanation":"ok"}');
    expect(result.ok).toBe(true);
  });

  it('rejects an out-of-range score rather than clamping it', () => {
    // Clamping 9 to 5 reports a perfect score for a judge that ignored the
    // scale -- the same conflation as defaulting a missing score to zero.
    const result = parseJudgeVerdict('{"score":9}');
    expect(result.ok).toBe(false);
    expect(result).toMatchObject({ reason: 'invalid-verdict' });
  });

  it('rejects a missing score rather than defaulting it', () => {
    expect(parseJudgeVerdict('{}')).toMatchObject({
      ok: false,
      reason: 'invalid-verdict',
    });
  });

  it('rejects a non-numeric score', () => {
    expect(parseJudgeVerdict('{"score":"high"}')).toMatchObject({ ok: false });
    expect(parseJudgeVerdict('{"score":true}')).toMatchObject({ ok: false });
  });

  it('rejects a fractional score, which the scale does not allow', () => {
    expect(parseJudgeVerdict('{"score":3.5}')).toMatchObject({ ok: false });
  });

  it('rejects detail fields that are not lists of objects', () => {
    expect(
      parseJudgeVerdict('{"score":3,"violations":"lots of them"}')
    ).toMatchObject({ ok: false });
  });

  it('says which field was wrong', () => {
    expect(parseJudgeVerdict('{"score":9}')).toMatchObject({
      ok: false,
      issues: expect.arrayContaining([expect.stringContaining('score')]),
    });
  });

  it('reads JSON wrapped in a code fence or surrounded by prose', () => {
    expect(extractVerdict('```json\n{"score":4}\n```')).toEqual({ score: 4 });
    expect(extractVerdict('Here you go: {"score":2} hope that helps')).toEqual({
      score: 2,
    });
  });

  it('returns null when there is no object to find', () => {
    expect(extractVerdict('I cannot evaluate this')).toBeNull();
  });
});

describe('judge evaluators', () => {
  const sources = [source('s1'), source('s2'), source('s9')];

  it('judges claim support against only the cited sources', async () => {
    const generate = vi.fn().mockResolvedValue(
      JSON.stringify({
        score: 4,
        violations: [{ section: 'topic_clusters', problem: 'unsupported' }],
        explanation: 'One cluster overstates the source.',
      })
    );
    const [claimSupport] = createJudgeEvaluators(generate);
    const result = await claimSupport!.evaluate({
      reportJson: JSON.stringify(reportData),
      reportData,
      sources,
    });

    const prompt = generate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('id: s1');
    expect(prompt).toContain('id: s2');
    // s9 is in the period but uncited, so the judge must not see it.
    expect(prompt).not.toContain('id: s9');

    expect(result.score).toBe(0.75);
    expect(result.label).toBe('4/5');
    expect(result.explanation).toBe('One cluster overstates the source.');
    expect(result.metadata).toMatchObject({
      citedCount: 2,
      availableCount: 3,
      violationsCount: 1,
    });
  });

  it('scores a report that cites nothing as unsupported without calling a model', async () => {
    const generate = vi.fn();
    const [claimSupport] = createJudgeEvaluators(generate);
    const result = await claimSupport!.evaluate({
      reportJson: '{}',
      reportData: { title: 'x' },
      sources,
    });
    expect(result).toMatchObject({ score: 0, label: 'no-citations' });
    expect(generate).not.toHaveBeenCalled();
  });

  it('gives the coverage judge every source', async () => {
    const generate = vi.fn().mockResolvedValue('{"score":3}');
    const evaluators = createJudgeEvaluators(generate);
    const coverage = evaluators.find((e) => e.name === 'judge_coverage');
    await coverage!.evaluate({
      reportJson: '{}',
      reportData,
      sources,
    });
    const prompt = generate.mock.calls[0]![0].prompt as string;
    expect(prompt).toContain('id: s9');
  });

  it('reports an unparseable verdict rather than inventing a score', async () => {
    const generate = vi.fn().mockResolvedValue('I refuse to answer.');
    const evaluators = createJudgeEvaluators(generate);
    const noise = evaluators.find((e) => e.name === 'judge_noise');
    const result = await noise!.evaluate({
      reportJson: '{}',
      reportData,
      sources: [],
    });
    expect(result).toMatchObject({ score: null, label: 'unparseable' });
    expect(result.metadata?.rawText).toContain('I refuse');
  });
});
