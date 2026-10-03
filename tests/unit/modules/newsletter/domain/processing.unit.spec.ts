import { sourceFixture, stateFixture } from '@tests/support/newsletter';
import { describe, expect, it } from 'vitest';

import {
  markdownLinks,
  markdownText,
} from '@/modules/newsletter/domain/markdown';
import {
  auditSignature,
  partitionSources,
  resolveContextBudget,
  resolveTopicRoot,
} from '@/modules/newsletter/domain/processing';

describe('Bounded newsletter evidence and shared Markdown parsing', () => {
  it('retains custom names and requires an explicit unknown-model limit', () => {
    expect(
      resolveContextBudget({
        mode: 'local',
        provider: 'codex-cli',
        model: 'my-custom-model',
      })
    ).toBeUndefined();
    expect(
      resolveContextBudget({
        mode: 'local',
        provider: 'codex-cli',
        model: 'my-custom-model',
        contextWindowTokens: 64000,
      })
    ).toBe(64000);
  });
  it('visits every character of long evidence with original source ids', () => {
    const source = { ...sourceFixture, content: 'evidence '.repeat(20000) };
    const batches = partitionSources([source], 8192);
    expect(batches.length).toBeGreaterThan(10);
    let covered = 0;
    for (const batch of batches)
      for (const slice of batch) {
        expect(slice.sourceId).toBe(source.id);
        expect(slice.start).toBeLessThanOrEqual(covered);
        covered = Math.max(covered, slice.end);
        expect(
          Buffer.byteLength(source.content.slice(slice.start, slice.end))
        ).toBeLessThan(8192);
      }
    expect(covered).toBe(source.content.length);
  });
  it('invalidates verification for every audit-relevant change and resolves merge chains without cycles', () => {
    const state = stateFixture(),
      angle = state.angles[0]!;
    const signature = auditSignature(
      angle,
      state.sources,
      state.profile!.audience
    );
    expect(
      auditSignature(
        { ...angle, title: 'Rephrased display title' },
        state.sources,
        state.profile!.audience
      )
    ).toBe(signature);
    expect(
      auditSignature(
        { ...angle, takeaway: 'Changed thesis' },
        state.sources,
        state.profile!.audience
      )
    ).not.toBe(signature);
    expect(
      auditSignature(
        angle,
        state.sources.map((s) => ({ ...s, junk: true })),
        state.profile!.audience
      )
    ).not.toBe(signature);
    expect(
      auditSignature(
        angle,
        state.sources.map((s) => ({ ...s, content: s.content + ' revised' })),
        state.profile!.audience
      )
    ).not.toBe(signature);
    const topics = ['A', 'B', 'C'].map((id, i) => ({
      id,
      title: id,
      summary: '',
      sourceIds: [],
      corrected: false,
      mergedInto: i < 2 ? ['B', 'C'][i] : undefined,
    }));
    expect(resolveTopicRoot(topics, 'A')).toBe('C');
    topics[2]!.mergedInto = 'A';
    expect(resolveTopicRoot(topics, 'A')).toBeUndefined();
  });
  it('handles balanced parentheses and reference links consistently, keeping raw HTML inert', () => {
    const markdown =
      '[Study](https://example.org/study_(2026)) and [reference][primary].\n\n[primary]: https://example.org/Reference_(A)\n\n<script>window.bad = true</script>';
    expect(markdownLinks(markdown)).toEqual([
      'https://example.org/study_(2026)',
      'https://example.org/Reference_(A)',
    ]);
    expect(markdownText(markdown)).toContain('Study');
    expect(markdownText(markdown)).not.toContain('window.bad');
  });
});
