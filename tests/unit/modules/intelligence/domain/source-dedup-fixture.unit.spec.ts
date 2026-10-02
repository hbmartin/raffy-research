/**
 * The dedup rule measured against real captured data rather than constructed
 * examples.
 *
 * The committed case is one workspace-week of exa captures across 13 ingest
 * runs. It is the evidence the rule was designed from, so pinning its numbers
 * here turns "69% of these records are duplicates" from a claim in a plan into
 * something CI re-checks.
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import {
  canonicalizeSourceUrl,
  collapseDuplicateSources,
} from '@/modules/intelligence';

type FixtureSource = {
  id: string;
  externalUrl: string | null;
  capturedAt: string;
  diffAddedText: string | null;
  diffRemovedText: string | null;
  relevanceLabel: string | null;
};

const sources = JSON.parse(
  readFileSync('fixtures/eval/aperture-2026-06-15/sources.json', 'utf8')
) as FixtureSource[];

describe('collapseDuplicateSources on the committed case', () => {
  it('starts from 101 records under 31 raw URLs', () => {
    expect(sources).toHaveLength(101);
    expect(new Set(sources.map((source) => source.externalUrl)).size).toBe(31);
  });

  it('reduces the period to 30 pages', () => {
    const { selected, collapsedCount } = collapseDuplicateSources(sources);

    expect(selected).toHaveLength(30);
    expect(collapsedCount).toBe(71);
    expect(selected.length + collapsedCount).toBe(sources.length);
  });

  it('leaves no two selected records pointing at the same page', () => {
    const { selected } = collapseDuplicateSources(sources);
    const keys = selected.map((source) =>
      canonicalizeSourceUrl(source.externalUrl)
    );

    expect(new Set(keys).size).toBe(keys.length);
  });

  /**
   * One events listing was captured 27 times under three spellings. Two are the
   * English page (`www.` and bare), which merge; the third is the Polish
   * rendering at a path without `/en/`, which is different content in a
   * different language and has to survive as its own evidence.
   */
  it('merges the two English spellings of the worst offender but keeps the Polish page', () => {
    const { selected } = collapseDuplicateSources(sources);
    const orbidenti = selected.filter((source) =>
      String(source.externalUrl).includes('orbidenti')
    );

    expect(orbidenti).toHaveLength(2);
    expect(
      orbidenti
        .map((source) => canonicalizeSourceUrl(source.externalUrl))
        .sort()
    ).toEqual([
      'orbidenti.com/en/events-preview/5622',
      'orbidenti.com/events-preview/5622',
    ]);
  });

  it('selects the newest capture of each page', () => {
    const { selected } = collapseDuplicateSources(sources);

    for (const chosen of selected) {
      const key = canonicalizeSourceUrl(chosen.externalUrl);
      // ISO-8601 sorts lexicographically, so the last element is the newest.
      const captures = sources
        .filter((source) => canonicalizeSourceUrl(source.externalUrl) === key)
        .map((source) => source.capturedAt)
        .sort();
      expect(chosen.capturedAt).toBe(captures.at(-1));
    }
  });

  /**
   * Guards the measurement the rule was chosen on: no record in this case
   * carries a diff, so every one of the 71 drops is a genuine re-capture
   * rather than a change event being swallowed.
   */
  it('has no change events to exempt, so every drop is a re-capture', () => {
    expect(
      sources.filter((source) =>
        [source.diffAddedText, source.diffRemovedText].some(Boolean)
      )
    ).toHaveLength(0);
  });
});
