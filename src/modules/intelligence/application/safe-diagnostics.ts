import { isMatching, P } from 'ts-pattern';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

import {
  type ReportValidationDiagnostic,
  sanitizeReportValidationDiagnostics,
} from '../domain/report-data';

export type ReportFailureDiagnostics = {
  stage?: string;
  provider?: string;
  model?: string;
  errorCode?: string;
  errorType?: string;
  upstreamStatus?: number;
  requestId?: string;
  durationMs?: number;
  validationDiagnostics?: ReportValidationDiagnostic[];
};

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

// These provider codes describe credential state; they are not credential values.
const safeErrorCode = (value: unknown): string | undefined =>
  value === 'token_revoked' || value === 'token_expired'
    ? value
    : safeToken(value);

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
    ...(safeErrorCode(raw.code) ? { errorCode: safeErrorCode(raw.code) } : {}),
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

export function safeReportFailureDiagnostics(
  input: unknown
): ReportFailureDiagnostics {
  const details = isMatching(P.record(P.string, P.unknown), input) ? input : {};
  return Object.fromEntries(
    [
      ['stage', safeToken(details.stage)],
      ['provider', safeToken(details.provider)],
      ['model', safeToken(details.model)],
      ['errorCode', safeErrorCode(details.errorCode)],
      ['errorType', safeToken(details.errorType)],
      ['upstreamStatus', safeStatus(details.upstreamStatus)],
      ['requestId', safeToken(details.requestId)],
      ['durationMs', safeDuration(details.durationMs)],
      [
        'validationDiagnostics',
        safeValidationDiagnostics(details.validationDiagnostics),
      ],
    ].filter((entry) => entry[1] !== undefined)
  );
}

const safeValidationDiagnostics = (input: unknown) => {
  if (!Array.isArray(input)) return undefined;
  return sanitizeReportValidationDiagnostics(
    input.flatMap((issue: unknown) =>
      isMatching({ path: P.string, code: P.string }, issue) &&
      safeToken(issue.code)
        ? [
            {
              path:
                issue.path === '<root>'
                  ? []
                  : issue.path
                      .slice(0, 128)
                      .split('.')
                      .map((part) =>
                        /^\d+$/.test(part) ? Number(part) : part
                      ),
              code: issue.code,
            },
          ]
        : []
    )
  );
};

export function safeAppErrorDetails(error: AppError): ReportFailureDiagnostics {
  return safeReportFailureDiagnostics(error.details);
}

const unexpectedErrorTypes = new Set([
  'Error',
  'AppError',
  'TypeError',
  'RangeError',
  'ReferenceError',
  'SyntaxError',
  'URIError',
  'EvalError',
  'AggregateError',
  'AbortError',
  'TimeoutError',
  'AI_APICallError',
  'AI_RetryError',
]);

/** Unexpected throws carry only known types and allowlisted diagnostic fields. */
export function safeUnexpectedFailureDiagnostics(
  error: unknown
): ReportFailureDiagnostics {
  const raw =
    typeof error === 'object' && error !== null
      ? (error as Record<string, unknown>)
      : {};
  const diagnostics =
    error instanceof AppError ? safeAppErrorDetails(error) : {};
  return {
    ...diagnostics,
    ...safeReportFailureDiagnostics({ errorCode: raw.code }),
    errorType:
      typeof raw.name === 'string' && unexpectedErrorTypes.has(raw.name)
        ? raw.name
        : 'UnknownError',
  };
}

export function reportFailureContext(error: AppError):
  | {
      failureCode: string;
      diagnostics: ReportFailureDiagnostics;
    }
  | undefined {
  const context = error.details?.reportFailure;
  if (!isMatching({ failureCode: P.string }, context)) return undefined;
  const failureCode = safeErrorCode(context.failureCode);
  return failureCode
    ? {
        failureCode,
        diagnostics: safeReportFailureDiagnostics(
          'diagnostics' in context ? context.diagnostics : undefined
        ),
      }
    : undefined;
}
