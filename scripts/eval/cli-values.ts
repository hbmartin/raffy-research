/**
 * Validation for option values the CLI cannot sensibly guess at.
 *
 * Both of these failed silently before. An unrecognised provider fell through
 * to the Claude Code branch of createModel, so a typo ran a different model
 * than the one asked for; a non-numeric count became NaN and was handed
 * straight to the experiment runner.
 */
import {
  LOCAL_AI_PROVIDERS,
  type LocalAiProviderName,
} from '@/modules/intelligence';

export function parseProvider(
  value: string | undefined,
  flag: string
): LocalAiProviderName {
  if (value && (LOCAL_AI_PROVIDERS as readonly string[]).includes(value)) {
    return value as LocalAiProviderName;
  }
  throw new Error(
    `${flag} expects one of: ${LOCAL_AI_PROVIDERS.join(', ')} (got ${value ?? 'nothing'})`
  );
}

export function parsePositiveInt(
  value: string | undefined,
  flag: string
): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(
      `${flag} expects a positive whole number (got ${value ?? 'nothing'})`
    );
  }
  return parsed;
}
