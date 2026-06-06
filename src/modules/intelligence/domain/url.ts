const SAFE_URL_PROTOCOLS = new Set(['http:', 'https:']);

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
