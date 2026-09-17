import { filter, isTruthy, join, map, pipe, unique, uniqueBy } from 'remeda';

type ContentSecurityPolicyOptions = {
  allowDevServerCspRelaxations?: boolean;
  allowPlaywrightScreenshotStyles?: boolean;
  baseUrl?: string;
  cspNonce?: string;
  isProduction?: boolean;
};

const uniqueSources = (sources: Array<string | undefined>) =>
  pipe(sources, filter(isTruthy), unique());

const isProductionHttps = (options: ContentSecurityPolicyOptions) => {
  if (!options.isProduction || !options.baseUrl) return false;

  try {
    return new URL(options.baseUrl).protocol === 'https:';
  } catch {
    return false;
  }
};

const formatDirective = (name: string, sources: string[]) =>
  sources.length > 0 ? `${name} ${sources.join(' ')}` : name;

export function buildContentSecurityPolicy(
  options: ContentSecurityPolicyOptions = {}
) {
  const nonceSource = options.cspNonce
    ? `'nonce-${options.cspNonce}'`
    : undefined;
  const allowDevServerCspRelaxations =
    options.allowDevServerCspRelaxations && !options.isProduction;
  const allowInlineStyleElements =
    options.allowPlaywrightScreenshotStyles === true;
  const scriptSources = uniqueSources([
    "'self'",
    nonceSource,
    allowDevServerCspRelaxations ? "'unsafe-eval'" : undefined,
  ]);
  const styleSources = uniqueSources([
    "'self'",
    allowInlineStyleElements ? "'unsafe-inline'" : nonceSource,
  ]);
  const imgSources = uniqueSources([
    "'self'",
    'data:',
    'blob:',
    'https://raw.githubusercontent.com',
  ]);
  const connectSources = uniqueSources(["'self'"]);
  const directives = [
    formatDirective('default-src', ["'self'"]),
    formatDirective('base-uri', ["'self'"]),
    formatDirective('object-src', ["'none'"]),
    formatDirective('frame-ancestors', ["'none'"]),
    formatDirective('form-action', ["'self'"]),
    formatDirective('script-src', scriptSources),
    formatDirective('script-src-attr', ["'none'"]),
    formatDirective('style-src', styleSources),
    formatDirective('style-src-elem', styleSources),
    formatDirective('style-src-attr', ["'unsafe-inline'"]),
    formatDirective('img-src', imgSources),
    formatDirective('connect-src', connectSources),
    formatDirective('font-src', ["'self'", 'data:']),
    formatDirective('manifest-src', ["'self'"]),
    formatDirective('media-src', ["'self'", 'blob:']),
    formatDirective('worker-src', ["'self'", 'blob:']),
    formatDirective('frame-src', ["'none'"]),
  ];

  if (isProductionHttps(options)) {
    directives.push('upgrade-insecure-requests');
  }

  return directives.join('; ');
}

export function getSecurityHeaders(options: ContentSecurityPolicyOptions = {}) {
  const headers: Record<string, string> = {
    'Content-Security-Policy': buildContentSecurityPolicy(options),
    'Cross-Origin-Opener-Policy': 'same-origin-allow-popups',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Origin-Agent-Cluster': '?1',
    'Permissions-Policy': [
      'camera=()',
      'display-capture=()',
      'fullscreen=(self)',
      'geolocation=()',
      'microphone=()',
      'payment=()',
    ].join(', '),
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  };

  if (options.isProduction) {
    headers['Strict-Transport-Security'] =
      'max-age=63072000; includeSubDomains; preload';
  }

  return headers;
}

export function applySecurityHeaders(
  response: Response,
  options: ContentSecurityPolicyOptions = {}
) {
  response.headers.delete('Content-Security-Policy-Report-Only');

  for (const [header, value] of Object.entries(getSecurityHeaders(options))) {
    response.headers.set(header, value);
  }

  return response;
}

export function appendVaryHeader(response: Response, values: string[]) {
  const mergedValues = pipe(
    [...(response.headers.get('Vary')?.split(',') ?? []), ...values],
    map((value) => value.trim()),
    filter(isTruthy)
  );

  if (mergedValues.includes('*')) {
    response.headers.set('Vary', '*');
    return response;
  }

  const varyValues = uniqueBy(mergedValues, (value) => value.toLowerCase());

  if (varyValues.length > 0) {
    response.headers.set('Vary', join(varyValues, ', '));
  }

  return response;
}
