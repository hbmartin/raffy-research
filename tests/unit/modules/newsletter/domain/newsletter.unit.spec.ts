import {
  articleFixture,
  auditFixture,
  newsletterNow,
  newsletterProfile,
  sourceFixture,
  stateFixture,
} from '@tests/support/newsletter';
import { describe, expect, it } from 'vitest';

import {
  angleEligible,
  auditPasses,
  claimReferencesValid,
  DAY_MS,
  type DraftVersion,
  exportDraft,
  rankThemes,
  sourceWarnings,
} from '@/modules/newsletter/testing';

describe('Newsletter evidence and editorial policy', () => {
  it('counts a captured source once across providers and report versions', () => {
    const state = stateFixture();
    const duplicate = {
      ...sourceFixture,
      id: 'copy',
      capturedAt: newsletterNow.toISOString(),
      reportIds: ['report-2'],
    };
    state.sources.push(duplicate);
    state.angles[0]!.sourceIds.push('copy');
    state.topics[0]!.sourceIds.push('copy');
    const theme = rankThemes(state, newsletterNow)[0]!;
    expect(theme.historicalDevelopment).toHaveLength(1);
    expect(theme.explanation).toContain('1 distinct sources');
    expect(theme.explanation).toContain('1 new sources');
  });
  it('weights evidence by the configured half-life and ranks strong before weak', () => {
    const state = stateFixture();
    const recent = rankThemes(state, newsletterNow)[0]!.support;
    state.sources[0]!.publishedAt = new Date(
      newsletterNow.getTime() - 91 * DAY_MS
    ).toISOString();
    const older = rankThemes(state, newsletterNow)[0]!.support;
    expect(older / recent).toBeCloseTo(0.5, 2);
    state.angles.push({ ...state.angles[0]!, id: 'weak', verified: false });
    expect(rankThemes(state, newsletterNow).map((t) => t.status)).toEqual([
      'strong',
      'weak',
    ]);
  });
  it('compares unique evidence in fourteen-day windows', () => {
    const state = stateFixture();
    state.sources.push({
      ...sourceFixture,
      id: 'previous',
      identity: 'previous-study',
      publishedAt: new Date(
        newsletterNow.getTime() - 20 * DAY_MS
      ).toISOString(),
    });
    state.topics[0]!.sourceIds.push('previous');
    expect(rankThemes(state, newsletterNow)[0]!.momentum).toBe(0);
  });
  it('requires genuine new claim support after thirty-day expiry', () => {
    const state = stateFixture();
    const selected = new Date(newsletterNow.getTime() - 31 * DAY_MS);
    state.selections.push({
      id: 'selection',
      reportId: 'old-report',
      angleId: 'angle-1',
      selectedAt: selected.toISOString(),
      snoozedUntil: new Date(selected.getTime() + 30 * DAY_MS).toISOString(),
      status: 'ready',
      overrideReason: '',
      evidenceIdentities: [sourceFixture.identity],
      selectedBy: 'user',
    });
    expect(angleEligible(state, state.angles[0]!, newsletterNow)).toBe(false);
    state.sources.push({
      ...sourceFixture,
      id: 'new-study',
      identity: 'independent-study',
      publishedAt: newsletterNow.toISOString(),
      capturedAt: newsletterNow.toISOString(),
    });
    state.angles[0]!.sourceIds.push('new-study');
    expect(angleEligible(state, state.angles[0]!, newsletterNow)).toBe(false);
    state.angles[0]!.claims[0]!.sourceIds.push('new-study');
    state.angles[0]!.claims[0]!.excerpts.push({
      sourceId: 'new-study',
      text: articleFixture.claims[0]!.excerpts[0]!.text,
    });
    expect(angleEligible(state, state.angles[0]!, newsletterNow)).toBe(true);
    // Newly discovered historical support qualifies for reuse without acquiring
    // an artificial recent publication date or inflating fourteen-day momentum.
    state.sources[1]!.publishedAt = '2025-01-01T00:00:00Z';
    expect(angleEligible(state, state.angles[0]!, newsletterNow)).toBe(true);
    expect(
      rankThemes(state, newsletterNow)[0]!.components.latestFourteenDays
    ).toBe(1);
  });
  it('rejects invented excerpts, unknown sources, and incomplete or recap-only audits', () => {
    expect(claimReferencesValid(articleFixture.claims, [sourceFixture])).toBe(
      true
    );
    expect(
      claimReferencesValid(
        [
          {
            ...articleFixture.claims[0]!,
            excerpts: [
              {
                sourceId: 'source-1',
                text: 'This claim does not occur in the captured source.',
              },
            ],
          },
        ],
        [sourceFixture]
      )
    ).toBe(false);
    expect(claimReferencesValid(articleFixture.claims, [])).toBe(false);
    expect(
      auditPasses(articleFixture, {
        ...auditFixture,
        meaningfulSynthesis: false,
      })
    ).toBe(false);
    expect(
      auditPasses(articleFixture, { ...auditFixture, claimChecks: [] })
    ).toBe(false);
  });
  it('preserves useful links in plain text and reports later evidence changes', () => {
    const draft: DraftVersion = {
      ...articleFixture,
      id: 'draft',
      selectionId: 'selection',
      createdAt: newsletterNow.toISOString(),
      profile: newsletterProfile,
      feedback: '',
      audit: auditFixture,
      runtime: newsletterProfile.runtime,
      sources: [sourceFixture],
      jobId: 'job',
    };
    expect(exportDraft(draft, 'text')).toContain('(https://example.org/study)');
    expect(exportDraft(draft, 'markdown')).toContain(
      '](https://example.org/study)'
    );
    expect(sourceWarnings(draft, [{ ...sourceFixture, junk: true }])).toEqual([
      expect.stringContaining('marked Junk'),
    ]);
  });
});
