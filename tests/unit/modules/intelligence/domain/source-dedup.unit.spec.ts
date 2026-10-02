import { describe, expect, it } from 'vitest';

import {
  canonicalizeSourceUrl,
  collapseDuplicateSources,
  type SourceRecord,
} from '@/modules/intelligence';
import { toSourceRecordId, toWorkspaceId } from '@/modules/kernel';

const workspaceId = toWorkspaceId('ws-1');

const sourceWith = (
  overrides: Omit<Partial<SourceRecord>, 'id'> & { id: string }
): SourceRecord =>
  ({
    workspaceId,
    providerName: 'exa',
    providerSourceId: null,
    sourceType: 'web_page',
    sourceSubtype: null,
    sourceName: null,
    sourceUrl: null,
    externalUrl: 'https://example.com/a',
    title: null,
    authorOrAccount: null,
    domain: null,
    publishedAt: null,
    capturedAt: new Date('2026-06-01T00:00:00.000Z'),
    contentText: null,
    diffAddedText: null,
    diffRemovedText: null,
    rawPayload: null,
    metadata: null,
    relevanceLabel: null,
    labeledAt: null,
    createdAt: new Date('2026-06-01T00:00:00.000Z'),
    updatedAt: new Date('2026-06-01T00:00:00.000Z'),
    ...overrides,
    id: toSourceRecordId(overrides.id),
  }) as unknown as SourceRecord;

describe('canonicalizeSourceUrl', () => {
  it.each([
    ['drops the scheme', 'https://example.com/a', 'example.com/a'],
    [
      'drops http too, so the pair collapse',
      'http://example.com/a',
      'example.com/a',
    ],
    ['drops a www. prefix', 'https://www.example.com/a', 'example.com/a'],
    ['lowercases the host', 'https://ExAmPle.COM/a', 'example.com/a'],
    ['drops a trailing slash', 'https://example.com/a/', 'example.com/a'],
    [
      'drops several trailing slashes',
      'https://example.com/a///',
      'example.com/a',
    ],
    ['reduces a bare host to the host', 'https://example.com', 'example.com'],
    [
      'drops a default https port',
      'https://example.com:443/a',
      'example.com/a',
    ],
    ['drops a fragment', 'https://example.com/a#section', 'example.com/a'],
    [
      'drops utm parameters',
      'https://example.com/a?utm_source=x',
      'example.com/a',
    ],
    [
      'drops gclid and fbclid',
      'https://example.com/a?gclid=1&fbclid=2',
      'example.com/a',
    ],
  ])('%s', (_label, input, expected) => {
    expect(canonicalizeSourceUrl(input)).toBe(expected);
  });

  it('keeps a non-default port, because that is a different server', () => {
    expect(canonicalizeSourceUrl('https://example.com:8443/a')).toBe(
      'example.com:8443/a'
    );
  });

  it('keeps meaningful query parameters, ordered so argument order stops mattering', () => {
    expect(canonicalizeSourceUrl('https://example.com/a?b=2&a=1')).toBe(
      'example.com/a?a=1&b=2'
    );
    expect(canonicalizeSourceUrl('https://example.com/a?a=1&b=2')).toBe(
      'example.com/a?a=1&b=2'
    );
  });

  it('keeps meaningful parameters while dropping tracking ones alongside them', () => {
    expect(
      canonicalizeSourceUrl('https://example.com/a?id=7&utm_medium=x')
    ).toBe('example.com/a?id=7');
  });

  it.each([
    'gclid',
    'wbraid',
    'gbraid',
    'dclid',
    'fbclid',
    'msclkid',
    'yclid',
    'twclid',
    'ttclid',
    'li_fat_id',
    'mc_cid',
    'mc_eid',
    'igshid',
    'ref_src',
  ])('drops the %s click id', (param) => {
    expect(canonicalizeSourceUrl(`https://example.com/a?${param}=abc123`)).toBe(
      'example.com/a'
    );
  });

  /**
   * `searchParams` hands back decoded values. Joining them raw would let one
   * parameter carrying the delimiters render identically to two parameters, and
   * collapse two distinct pages into one.
   */
  it('does not let an encoded delimiter collide with a real one', () => {
    const oneParam = canonicalizeSourceUrl('https://example.com/a?x=1%262=3');
    const twoParams = canonicalizeSourceUrl('https://example.com/a?x=1&2=3');

    expect(oneParam).not.toBe(twoParams);
    expect(oneParam).toBe('example.com/a?x=1%262%3D3');
    expect(twoParams).toBe('example.com/a?2=3&x=1');
  });

  /**
   * Paths are case-sensitive in HTTP, and real captures carry case-significant
   * id segments. Lowercasing the path would corrupt them into a key that never
   * matches the page it came from.
   */
  it('preserves path case', () => {
    expect(
      canonicalizeSourceUrl(
        'https://www.westfield.com.au/store/414ohe25z4U55LbyVOJIS1/x'
      )
    ).toBe('westfield.com.au/store/414ohe25z4U55LbyVOJIS1/x');
  });

  /**
   * `/en/foo` and `/foo` are routinely two translations of one page. Captured
   * together they differ in content and in language, so merging them would
   * silently drop one language's evidence.
   */
  it('preserves a locale segment, so translations stay distinct', () => {
    expect(
      canonicalizeSourceUrl('https://www.orbidenti.com/en/events-preview/5622')
    ).toBe('orbidenti.com/en/events-preview/5622');
    expect(
      canonicalizeSourceUrl('https://www.orbidenti.com/events-preview/5622')
    ).toBe('orbidenti.com/events-preview/5622');
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace', '   '],
    ['not a URL', 'not a url'],
    ['a non-http scheme', 'ftp://example.com/a'],
    ['a javascript: URL', 'javascript:alert(1)'],
  ])('returns null for %s', (_label, input) => {
    expect(canonicalizeSourceUrl(input)).toBeNull();
  });
});

describe('collapseDuplicateSources', () => {
  it('keeps one record per page and counts what it dropped', () => {
    const result = collapseDuplicateSources([
      sourceWith({ id: 'a', externalUrl: 'https://www.example.com/p' }),
      sourceWith({ id: 'b', externalUrl: 'https://example.com/p/' }),
      sourceWith({ id: 'c', externalUrl: 'https://example.com/other' }),
    ]);

    expect(result.selected).toHaveLength(2);
    expect(result.collapsedCount).toBe(1);
    expect(result.selected.map((source) => source.externalUrl)).toEqual([
      'https://example.com/p/',
      'https://example.com/other',
    ]);
  });

  it('keeps the newest capture, since that is the text a reader would see now', () => {
    const result = collapseDuplicateSources([
      sourceWith({
        id: 'old',
        contentText: 'stale',
        capturedAt: new Date('2026-06-01T00:00:00.000Z'),
      }),
      sourceWith({
        id: 'new',
        contentText: 'fresh',
        capturedAt: new Date('2026-06-03T00:00:00.000Z'),
      }),
      sourceWith({
        id: 'middle',
        contentText: 'middling',
        capturedAt: new Date('2026-06-02T00:00:00.000Z'),
      }),
    ]);

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.contentText).toBe('fresh');
    expect(result.collapsedCount).toBe(2);
  });

  it('holds a collapsed page at the position of its first capture', () => {
    const result = collapseDuplicateSources([
      sourceWith({ id: 'dup-first', externalUrl: 'https://example.com/p' }),
      sourceWith({ id: 'other', externalUrl: 'https://example.com/q' }),
      sourceWith({
        id: 'dup-second',
        externalUrl: 'https://example.com/p',
        capturedAt: new Date('2026-06-09T00:00:00.000Z'),
      }),
    ]);

    expect(result.selected.map((source) => source.id)).toEqual([
      'dup-second',
      'other',
    ]);
  });

  /**
   * visualping and distill emit one record per change to a URL that is stable
   * by design. Collapsing them would discard exactly the signal they exist to
   * deliver, so a diff is an exemption rather than a tiebreak.
   */
  it('never collapses change events, even on an identical URL', () => {
    const result = collapseDuplicateSources([
      sourceWith({
        id: 'change-1',
        providerName: 'visualping',
        externalUrl: 'https://example.com/pricing',
        diffAddedText: 'now $49',
      }),
      sourceWith({
        id: 'change-2',
        providerName: 'visualping',
        externalUrl: 'https://example.com/pricing',
        diffAddedText: 'now $59',
      }),
      sourceWith({
        id: 'removal',
        providerName: 'distill',
        externalUrl: 'https://example.com/pricing',
        diffRemovedText: 'free tier',
      }),
    ]);

    expect(result.selected).toHaveLength(3);
    expect(result.collapsedCount).toBe(0);
  });

  it('keeps a change event separate from an ordinary capture of the same page', () => {
    const result = collapseDuplicateSources([
      sourceWith({ id: 'page', externalUrl: 'https://example.com/pricing' }),
      sourceWith({
        id: 'change',
        externalUrl: 'https://example.com/pricing',
        diffAddedText: 'now $49',
      }),
    ]);

    expect(result.selected.map((source) => source.id)).toEqual([
      'page',
      'change',
    ]);
  });

  it('passes through records with no usable address rather than merging them', () => {
    const result = collapseDuplicateSources([
      sourceWith({ id: 'a', externalUrl: null }),
      sourceWith({ id: 'b', externalUrl: null }),
      sourceWith({ id: 'c', externalUrl: 'not a url' }),
    ]);

    expect(result.selected).toHaveLength(3);
    expect(result.collapsedCount).toBe(0);
  });

  it('returns an empty result for no sources', () => {
    expect(collapseDuplicateSources([])).toEqual({
      selected: [],
      collapsedCount: 0,
    });
  });

  /**
   * An eval case is this same data after a JSON round trip, so `capturedAt`
   * arrives as a string. The harness must be able to collapse with the very
   * function the generator uses, or it measures a selection that never ships.
   */
  it('accepts an ISO string capturedAt, as the eval harness supplies', () => {
    const result = collapseDuplicateSources([
      {
        externalUrl: 'https://www.example.com/p',
        capturedAt: '2026-06-01T00:00:00.000Z',
        diffAddedText: null,
        diffRemovedText: null,
        marker: 'old',
      },
      {
        externalUrl: 'https://example.com/p',
        capturedAt: '2026-06-05T00:00:00.000Z',
        diffAddedText: null,
        diffRemovedText: null,
        marker: 'new',
      },
    ]);

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0]?.marker).toBe('new');
  });

  it('treats an unparseable timestamp as oldest instead of throwing', () => {
    const result = collapseDuplicateSources([
      sourceWith({ id: 'good', contentText: 'real' }),
      {
        externalUrl: 'https://example.com/a',
        capturedAt: 'not a date',
        diffAddedText: null,
        diffRemovedText: null,
        contentText: 'from the unparseable capture',
      },
    ]);

    expect(result.selected).toHaveLength(1);
    expect(result.collapsedCount).toBe(1);
    // The parseable capture wins, which is what "sorts oldest" has to mean.
    expect(result.selected[0]?.contentText).toBe('real');
  });
});
