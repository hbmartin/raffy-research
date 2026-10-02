const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Query parameters that identify a referral, not a page. Dropping them keeps
 * two links to the same article from reading as two articles.
 *
 * Google alone attaches several click ids that travel together — `wbraid` and
 * `gbraid` ride alongside `gclid` on the same click — so dropping one and
 * keeping its siblings would leave the collapse inconsistent.
 */
const TRACKING_PARAMS =
  /^(utm_[a-z0-9_]+|gclid|wbraid|gbraid|dclid|fbclid|msclkid|yclid|twclid|ttclid|li_fat_id|mc_cid|mc_eid|igshid|ref_src)$/i;

/**
 * Normalize a URL for display/storage fields that only allow http(s).
 *
 * This is not an SSRF guard. Do not use it to validate fetch targets because
 * localhost, private IP ranges, and metadata-service hosts can still be valid
 * http(s) URLs.
 */
export function normalizeHttpUrl(
  value: string | null | undefined
): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    return SAFE_URL_PROTOCOLS.has(url.protocol) ? url.toString() : null;
  } catch {
    return null;
  }
}

export function isSafeHttpUrl(value: string): boolean {
  return normalizeHttpUrl(value) !== null;
}

/**
 * Collapse the spellings of one address into a single identity key.
 *
 * Distinct from `normalizeHttpUrl`, which answers "is this a storable http(s)
 * URL" and preserves the URL as given. This answers "are these the same page",
 * so host case, a `www.` prefix, the scheme, a default port, a fragment,
 * tracking parameters and a trailing slash all have to stop mattering. The
 * result is an opaque key, not a URL — never render it or fetch it.
 *
 * Deliberately preserved:
 * - **Path case.** Paths are case-sensitive in HTTP, and real captures carry
 *   case-significant id segments (`/store/414ohe25z4U55LbyVOJIS1/bupa-dental`).
 * - **Locale segments.** `/en/foo` and `/foo` are routinely two translations of
 *   one page. Captured together they differ in content and language, which is
 *   two pieces of evidence, not one duplicated.
 */
export function canonicalizeSourceUrl(
  value: string | null | undefined
): string | null {
  const safe = normalizeHttpUrl(value);
  if (!safe) return null;

  try {
    const url = new URL(safe);
    // `host` keeps a non-default port and omits a default one, which is the
    // distinction we want: a different port is a different server.
    const host = url.host.toLowerCase().replace(/^www\./, '');
    const path = url.pathname.replace(/\/+$/, '');
    // Re-encoded before joining: `searchParams` hands back decoded values, so
    // joining them raw would let `?a=x%26b%3Dy` — one parameter whose value
    // contains the delimiters — render identically to `?a=x&b=y`, two
    // parameters, and collapse two distinct pages into one.
    const params = [...url.searchParams.entries()]
      .filter(([key]) => !TRACKING_PARAMS.test(key))
      .map(
        ([key, param]) =>
          `${encodeURIComponent(key)}=${encodeURIComponent(param)}`
      )
      .sort();
    const query = params.length > 0 ? `?${params.join('&')}` : '';
    return `${host}${path}${query}`;
  } catch {
    return null;
  }
}
