import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createCspNonceBridgeScript,
  readCspNonceFromMeta,
} from '@/platform/http/csp-nonce';
import {
  appendVaryHeader,
  applySecurityHeaders,
  buildContentSecurityPolicy,
  getSecurityHeaders,
} from '@/platform/http/security-headers';

const directiveValue = (policy: string, directiveName: string) =>
  policy
    .split('; ')
    .find((directive) => directive.startsWith(`${directiveName} `));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('security headers', () => {
  it('builds an enforced CSP with configured image and connection origins', () => {
    const policy = buildContentSecurityPolicy({
      baseUrl: 'https://app.example',
      isProduction: true,
    });

    expect(policy).toContain("default-src 'self'");
    expect(policy).toContain("base-uri 'self'");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("form-action 'self'");
    expect(directiveValue(policy, 'script-src')).toBe("script-src 'self'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(directiveValue(policy, 'style-src')).toBe(
      "style-src 'self' 'unsafe-inline'"
    );
    expect(policy).toContain("style-src-attr 'unsafe-inline'");
    expect(policy).toContain(
      "img-src 'self' data: blob: https://raw.githubusercontent.com"
    );
    expect(policy).toContain("connect-src 'self'");
    expect(policy).not.toContain('sentry.io');
    expect(policy).toContain("font-src 'self' data:");
    expect(policy).toContain("manifest-src 'self'");
    expect(policy).toContain("media-src 'self' blob:");
    expect(policy).toContain("worker-src 'self' blob:");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain('upgrade-insecure-requests');
  });

  it('adds a CSP nonce for scripts while allowing inline style elements', () => {
    const policy = buildContentSecurityPolicy({
      cspNonce: 'test-nonce',
    });

    expect(directiveValue(policy, 'script-src')).toBe(
      "script-src 'self' 'nonce-test-nonce'"
    );
    expect(directiveValue(policy, 'style-src')).toBe(
      "style-src 'self' 'unsafe-inline'"
    );
    expect(directiveValue(policy, 'style-src-attr')).toBe(
      "style-src-attr 'unsafe-inline'"
    );
  });

  it('can allow Playwright screenshot styles outside production only', () => {
    const testPolicy = buildContentSecurityPolicy({
      allowPlaywrightScreenshotStyles: true,
      cspNonce: 'test-nonce',
      isProduction: false,
    });
    const productionPolicy = buildContentSecurityPolicy({
      allowPlaywrightScreenshotStyles: true,
      cspNonce: 'test-nonce',
      isProduction: true,
    });

    expect(directiveValue(testPolicy, 'style-src')).toContain(
      "'sha256-7kYjkz6pduUs3kVL/X05CBZQltL/7ngRDDedeYMKnCY='" // pragma: allowlist secret
    );
    expect(directiveValue(testPolicy, 'style-src')).toContain(
      "'sha256-usAZqtYVSsNUHiWQ9dUUoz3b/VIjZb4D3aBYhD6zD5o='" // pragma: allowlist secret
    );
    expect(directiveValue(productionPolicy, 'style-src')).not.toContain(
      'sha256-7kYjkz6pduUs3kVL' // pragma: allowlist secret
    );
  });

  it('keeps scripts nonce-protected while allowing inline style elements', () => {
    const testPolicy = buildContentSecurityPolicy({
      allowDevServerCspRelaxations: true,
      cspNonce: 'test-nonce',
      isProduction: false,
    });
    const productionPolicy = buildContentSecurityPolicy({
      allowDevServerCspRelaxations: true,
      cspNonce: 'test-nonce',
      isProduction: true,
    });

    expect(directiveValue(testPolicy, 'script-src')).toBe(
      "script-src 'self' 'nonce-test-nonce' 'unsafe-eval'"
    );
    expect(directiveValue(testPolicy, 'style-src')).toBe(
      "style-src 'self' 'unsafe-inline'"
    );
    expect(directiveValue(testPolicy, 'style-src-elem')).toBe(
      "style-src-elem 'self' 'unsafe-inline'"
    );
    expect(directiveValue(productionPolicy, 'script-src')).toBe(
      "script-src 'self' 'nonce-test-nonce'"
    );
    expect(directiveValue(productionPolicy, 'style-src')).toBe(
      "style-src 'self' 'unsafe-inline'"
    );
    expect(directiveValue(productionPolicy, 'style-src-elem')).toBe(
      "style-src-elem 'self' 'unsafe-inline'"
    );
  });

  it('does not add HTTPS upgrade directives outside production HTTPS', () => {
    expect(
      buildContentSecurityPolicy({
        baseUrl: 'http://localhost:3000',
        isProduction: true,
      })
    ).not.toContain('upgrade-insecure-requests');
    expect(
      buildContentSecurityPolicy({
        baseUrl: 'https://app.example',
        isProduction: false,
      })
    ).not.toContain('upgrade-insecure-requests');
  });

  it('returns security headers without report-only CSP', () => {
    const headers = getSecurityHeaders({
      isProduction: true,
    });

    expect(headers['Content-Security-Policy']).toContain("default-src 'self'");
    expect(headers['Content-Security-Policy-Report-Only']).toBeUndefined();
    expect(headers['Cross-Origin-Opener-Policy']).toBe(
      'same-origin-allow-popups'
    );
    expect(headers['Cross-Origin-Resource-Policy']).toBe('same-origin');
    expect(headers['Origin-Agent-Cluster']).toBe('?1');
    expect(headers['Strict-Transport-Security']).toBe(
      'max-age=63072000; includeSubDomains; preload'
    );
  });

  it('applies security headers and removes stale report-only CSP', () => {
    const response = new Response('ok', {
      headers: {
        'Content-Security-Policy-Report-Only': "default-src 'none'",
      },
    });

    applySecurityHeaders(response);

    expect(response.headers.get('Content-Security-Policy')).toContain(
      "default-src 'self'"
    );
    expect(response.headers.get('Content-Security-Policy-Report-Only')).toBe(
      null
    );
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('appends Vary values without losing existing values or adding duplicates', () => {
    const response = new Response('ok', {
      headers: {
        Vary: 'Cookie, origin',
      },
    });

    appendVaryHeader(response, ['Origin', 'Sec-Fetch-Site', 'Referer']);

    expect(response.headers.get('Vary')).toBe(
      'Cookie, origin, Sec-Fetch-Site, Referer'
    );
  });

  it('keeps wildcard Vary as the only value', () => {
    const response = new Response('ok', {
      headers: {
        Vary: 'Cookie, *',
      },
    });

    appendVaryHeader(response, ['Origin']);

    expect(response.headers.get('Vary')).toBe('*');
  });

  it('preserves response body identity when applying security headers', () => {
    const body = new ReadableStream();
    const response = new Response(body);
    expect(
      applySecurityHeaders(response, { cspNonce: 'nonce', isProduction: true })
    ).toBe(response);
    expect(response.body).toBe(body);
  });

  it('reads the CSP nonce from meta content before browser-hidden nonce attributes', () => {
    const getAttribute = vi
      .fn<(name: string) => string>()
      .mockReturnValueOnce('request-nonce')
      .mockReturnValueOnce('');
    const querySelector = vi.fn(() => ({
      getAttribute,
      nonce: '',
    }));
    vi.stubGlobal('document', { querySelector });

    expect(readCspNonceFromMeta()).toBe('request-nonce');
    expect(querySelector).toHaveBeenCalledWith('meta[property="csp-nonce"]');
    expect(getAttribute).toHaveBeenNthCalledWith(1, 'content');
  });

  it('falls back to nonce property and nonce attribute when meta content is empty', () => {
    const attributeValues = new Map([
      ['content', ''],
      ['nonce', 'attribute-nonce'],
    ]);
    const getAttribute = vi.fn((name: string) => attributeValues.get(name));
    const querySelector = vi.fn(() => ({
      getAttribute,
      nonce: 'property-nonce',
    }));
    vi.stubGlobal('document', { querySelector });

    expect(readCspNonceFromMeta()).toBe('property-nonce');
    expect(getAttribute).toHaveBeenNthCalledWith(1, 'content');
    expect(getAttribute).not.toHaveBeenCalledWith('nonce');

    querySelector.mockReturnValueOnce({
      getAttribute,
      nonce: '',
    });

    expect(readCspNonceFromMeta()).toBe('attribute-nonce');
  });

  it('creates a bridge script that exposes the nonce and nonces dynamic style elements', () => {
    type FakeElement = {
      getAttribute: (name: string) => string | undefined;
      setAttribute: (name: string, value: string) => void;
    };
    class FakeDocument {
      createElement() {
        const attributes = new Map<string, string>();

        return {
          getAttribute: (name: string) => attributes.get(name),
          setAttribute: (name: string, value: string) => {
            attributes.set(name, value);
          },
        };
      }
    }
    const fakeWindow = {};
    vi.stubGlobal('window', fakeWindow);
    vi.stubGlobal('Document', FakeDocument);

    new Function(createCspNonceBridgeScript('bridge-nonce'))();

    const document = new FakeDocument() as unknown as Document;
    const styleElement = document.createElement(
      'style'
    ) as unknown as FakeElement;
    const divElement = document.createElement('div') as unknown as FakeElement;

    expect(window.__nonce__).toBe('bridge-nonce');
    expect(window.__startUiCspNonceBridgeInstalled).toBe(true);
    expect(styleElement.getAttribute('nonce')).toBe('bridge-nonce');
    expect(divElement.getAttribute('nonce')).toBeUndefined();
  });
});
