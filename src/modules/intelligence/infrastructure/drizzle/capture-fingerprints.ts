import { createHash } from 'node:crypto';

import type { SourceRecordWriteInput } from '../../domain/source';
import { canonicalizeSourceUrl } from '../../domain/url';

export const fingerprint = (value: string): string =>
  createHash('sha256').update(value, 'utf8').digest('hex');

export const MIN_AUTOMATIC_COPY_WORDS = 40;
export const isBlockingContent = (content: string) =>
  /^(?:access denied|forbidden|page not found|404(?:\b|:)|just a moment|verify (?:you are|that you are) human|enable javascript|checking your browser|security verification|captcha)\b/i.test(
    normalizeEvidenceContent(content)
  );

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
  const prose =
    input.sourceType !== 'seo_report' &&
    normalized.length > 0 &&
    !isBlockingContent(normalized);
  const equivalenceKey = !prose
    ? null
    : words.length >= MIN_AUTOMATIC_COPY_WORDS
      ? `body:${normalizedFingerprint}`
      : canonicalUrl
        ? `url-body:${fingerprint(JSON.stringify([canonicalUrl, normalizedFingerprint]))}`
        : null;
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
    equivalenceKey,
  };
}

/** Bounded comparisons during insertion, never during polling or archive reads. */
export function isUncertainCopy(left: string, right: string): boolean {
  const words = (value: string) =>
    new Set(normalizeEvidenceContent(value).toLowerCase().split(' '));
  const a = words(left),
    b = words(right);
  if (isBlockingContent(left) || isBlockingContent(right)) return false;
  if (
    normalizeEvidenceContent(left) === normalizeEvidenceContent(right) &&
    left.trim()
  )
    return true;
  if (a.size < 40 || b.size < 40) return false;
  let intersection = 0;
  for (const word of a) if (b.has(word)) intersection++;
  return intersection / (a.size + b.size - intersection) >= 0.85;
}
