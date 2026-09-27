import type { AppError } from '@/modules/kernel/domain/errors/app-error';

type SafeDiagnostics = {
  stage: string;
  provider: string;
  model?: string;
  errorCode?: string;
  errorType?: string;
  upstreamStatus?: number;
  requestId?: string;
  durationMs: number;
};

const safeToken = (value: unknown, max = 80): string | undefined =>
  typeof value === 'string' &&
  /^[a-zA-Z0-9_.:-]+$/.test(value) &&
  !/(secret|token|bearer|^sk[-_])/i.test(value) &&
  value.length <= max
    ? value
    : undefined;

const safeStatus = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isInteger(value) &&
  value >= 100 &&
  value <= 599
    ? value
    : undefined;

const safeDuration = (value: unknown): number | undefined =>
  typeof value === 'number' &&
  Number.isFinite(value) &&
  value >= 0 &&
  value <= 1_000_000_000
    ? Math.round(value)
    : undefined;

export function safeFailureDiagnostics(input: {
  error: unknown;
  stage: string;
  provider: string;
  model?: string;
  durationMs: number;
  upstreamStatus?: number;
  requestId?: string | null;
}): SafeDiagnostics {
  const raw =
    typeof input.error === 'object' && input.error !== null
      ? (input.error as Record<string, unknown>)
      : {};
  return {
    stage: safeToken(input.stage) ?? 'unknown',
    provider: safeToken(input.provider) ?? 'unknown',
    ...(safeToken(input.model) ? { model: safeToken(input.model) } : {}),
    ...(safeToken(raw.code) ? { errorCode: safeToken(raw.code) } : {}),
    ...(safeToken(raw.name) || safeToken(raw.type)
      ? { errorType: safeToken(raw.name) ?? safeToken(raw.type) }
      : {}),
    ...(safeStatus(input.upstreamStatus ?? raw.status)
      ? { upstreamStatus: safeStatus(input.upstreamStatus ?? raw.status) }
      : {}),
    ...(safeToken(input.requestId ?? raw.requestID ?? raw.requestId)
      ? {
          requestId: safeToken(
            input.requestId ?? raw.requestID ?? raw.requestId
          ),
        }
      : {}),
    durationMs: safeDuration(input.durationMs) ?? 0,
  };
}

export function safeAppErrorDetails(error: AppError): Record<string, unknown> {
  const details = error.details ?? {};
  return Object.fromEntries(
    [
      ['stage', safeToken(details.stage)],
      ['provider', safeToken(details.provider)],
      ['model', safeToken(details.model)],
      ['errorCode', safeToken(details.errorCode)],
      ['errorType', safeToken(details.errorType)],
      ['upstreamStatus', safeStatus(details.upstreamStatus)],
      ['requestId', safeToken(details.requestId)],
      ['durationMs', safeDuration(details.durationMs)],
    ].filter((entry) => entry[1] !== undefined)
  );
}
