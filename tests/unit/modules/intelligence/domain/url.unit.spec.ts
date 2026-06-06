import { describe, expect, it } from 'vitest';

import { normalizeHttpUrl } from '@/modules/intelligence/domain/url';

describe('intelligence URL normalization', () => {
  it.each([
    'javascript:alert(1)',
    'data:text/html,hi',
    'vbscript:msgbox(1)',
    'file:///evil.com',
  ])('rejects non-http(s) URL %s', (value) => {
    expect(normalizeHttpUrl(value)).toBeNull();
  });

  it('normalizes http and https URLs', () => {
    expect(normalizeHttpUrl(' https://example.com/a ')).toBe(
      'https://example.com/a'
    );
    expect(normalizeHttpUrl('http://example.com')).toBe('http://example.com/');
  });
});
