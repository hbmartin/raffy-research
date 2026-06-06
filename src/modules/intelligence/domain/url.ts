const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);

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
