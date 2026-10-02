import { sourceFixture } from '@tests/support/newsletter';
import { describe, expect, it } from 'vitest';

import {
  deduplicatePublicCaptures,
  isPublicResearchSource,
} from '@/modules/intelligence/testing';
const publicSource = {
  providerName: 'exa',
  sourceType: 'web_page',
  sourceSubtype: null,
  metadata: {},
  externalUrl: 'https://example.org/research',
  contentText: 'Captured public evidence',
};
describe('Public newsletter evidence boundary', () => {
  it('excludes internal providers and private captures even when URLs look public', () => {
    expect(isPublicResearchSource(publicSource)).toBe(true);
    expect(
      isPublicResearchSource({ ...publicSource, providerName: 'slack' })
    ).toBe(false);
    expect(
      isPublicResearchSource({
        ...publicSource,
        providerName: 'notion',
        metadata: { visibility: 'public' },
      })
    ).toBe(false);
    expect(
      isPublicResearchSource({
        ...publicSource,
        metadata: { visibility: 'private' },
      })
    ).toBe(false);
    expect(
      isPublicResearchSource({ ...publicSource, sourceType: 'internal_note' })
    ).toBe(false);
  });
  it.each([
    'http://localhost/research',
    'http://10.0.0.1/study',
    'http://192.168.1.1/private',
    'http://[::1]/study',
    'http://[fd12:3456::1]/study',
    'http://[fe80::1]/study',
    'https://reader:password@example.org/private',
  ])('excludes nonpublic or credentialed URL %s', (externalUrl) => {
    expect(isPublicResearchSource({ ...publicSource, externalUrl })).toBe(
      false
    );
  });
  it('requires real content and known public provenance', () => {
    expect(isPublicResearchSource({ ...publicSource, contentText: '' })).toBe(
      false
    );
    expect(
      isPublicResearchSource({ ...publicSource, providerName: 'unknown' })
    ).toBe(false);
    expect(
      isPublicResearchSource({
        ...publicSource,
        providerName: 'manual',
        metadata: { visibility: 'public' },
      })
    ).toBe(true);
  });
});

describe('Public capture identities', () => {
  it('retains historical dates and raw captures while grouping repeated and syndicated pages', () => {
    const copies = deduplicatePublicCaptures([
      {
        ...sourceFixture,
        identity: 'body:a',
        url: 'https://example.org/original?utm_source=newsletter#highlight',
      },
      {
        ...sourceFixture,
        id: 'new-capture',
        identity: 'body:changed',
        url: 'https://example.org/original',
        content: sourceFixture.content + ' Updated capture.',
        publishedAt: '2026-10-02T00:00:00Z',
      },
      {
        ...sourceFixture,
        id: 'syndicated',
        identity: 'body:a',
        url: 'https://syndicator.example/copy',
        publishedAt: '2026-10-02T00:00:00Z',
      },
    ]);
    expect(copies).toHaveLength(3);
    expect(new Set(copies.map((s) => s.identity)).size).toBe(1);
    expect(new Set(copies.map((s) => s.publishedAt))).toEqual(
      new Set([sourceFixture.publishedAt])
    );
  });
});
