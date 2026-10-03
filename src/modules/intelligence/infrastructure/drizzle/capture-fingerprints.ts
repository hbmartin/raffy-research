import { createHash } from 'node:crypto';

import type { SourceRecordWriteInput } from '../../domain/source';
import { canonicalizeSourceUrl } from '../../domain/url';

export const fingerprint = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

/** Formatting differences only; case, punctuation and substantive words survive. */
export function normalizeEvidenceContent(content: string): string {
  return content
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter(
      (line) =>
        !/^(?:accept all cookies|reject all cookies|cookie settings|skip to (?:main )?content|back to top)\s*$/i.test(
          line.trim()
        )
    )
    .join('\n')
    .replace(/\[([^\]]+)\]\(https?:\/\/[^\s]+\)/g, '$1')
    .replace(/(^|\n)\s{0,3}#{1,6}\s+/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

export function captureFingerprints(input: SourceRecordWriteInput) {
  const canonicalUrl = canonicalizeSourceUrl(
    input.externalUrl ?? input.sourceUrl
  );
  const contentFingerprint = fingerprint(input.contentText ?? '');
  const normalized = normalizeEvidenceContent(input.contentText ?? '');
  const normalizedFingerprint = normalized ? fingerprint(normalized) : null;
  const words = normalized.toLowerCase().split(' ');
  const similarityBucket =
    words.length >= 40
      ? (words.map(fingerprint).sort()[0]?.slice(0, 12) ?? null)
      : null;
  // Empty text and provider metric snapshots do not prove content equivalence.
  const versionKey =
    input.sourceType !== 'seo_report' &&
    canonicalUrl &&
    input.contentText?.trim()
      ? fingerprint(JSON.stringify([canonicalUrl, contentFingerprint]))
      : null;
  return {
    canonicalUrl,
    contentFingerprint,
    normalizedFingerprint,
    similarityBucket,
    versionKey,
  };
}

/** Bounded comparisons during insertion, never during polling or archive reads. */
export function isUncertainCopy(left: string, right: string): boolean {
  const words = (value: string) =>
    new Set(normalizeEvidenceContent(value).toLowerCase().split(' '));
  const a = words(left),
    b = words(right);
  if (a.size < 40 || b.size < 40) return false;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection) >= 0.85;
}
