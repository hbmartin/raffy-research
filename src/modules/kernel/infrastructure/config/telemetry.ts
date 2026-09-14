import { parseKeyPairsIntoRecord } from '@opentelemetry/core';
import { validateHeaderName, validateHeaderValue } from 'node:http';
import { z } from 'zod';

import {
  baseEnvSchema,
  isProdRuntimeEnvironment,
  parseEnv,
} from './env-schema';
import { ConfigurationError } from '../../domain/errors/configuration-error';

const telemetryEnvSchema = baseEnvSchema.extend({
  SENTRY_DSN: z.string().url().optional(),
  VITE_SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  SENTRY_ORG: z.string().optional(),
  SENTRY_PROJECT: z.string().optional(),
  SENTRY_AUTH_TOKEN: z.string().optional(),
  OTEL_COLLECTOR_URL: z.string().url().optional(),
  OTEL_COLLECTOR_BEARER_TOKEN: z.string().optional(),
  OTEL_EXPORTER_OTLP_HEADERS: z.string().optional(),
  OTEL_EXPORTER_OTLP_TRACES_HEADERS: z.string().optional(),
  OTEL_EXPORTER_OTLP_METRICS_HEADERS: z.string().optional(),
  OTEL_EXPORTER_OTLP_LOGS_HEADERS: z.string().optional(),
  OTEL_SERVICE_NAME: z.string().optional(),
  OTEL_SERVICE_VERSION: z.string().optional(),
  OTEL_ENVIRONMENT: z.string().optional(),
  OTEL_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).optional(),
  OTEL_LOCAL_SQLITE_ENABLED: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  OTEL_LOCAL_SQLITE_PATH: z.string().optional(),
  TELEMETRY_PROXY_MAX_BYTES: z.coerce.number().int().positive().optional(),
  TELEMETRY_LOG_MAX_EVENTS: z.coerce.number().int().positive().optional(),
});

export type TelemetryConfig = {
  dsn?: string;
  browserDsn?: string;
  environment?: string;
  tracesSampleRate: number;
  org?: string;
  project?: string;
  authToken?: string;
  collectorUrl?: string;
  collectorBearerToken?: string;
  collectorHeaders: Readonly<Record<string, string>>;
  signalHeaders: Readonly<
    Record<'traces' | 'metrics' | 'logs', Readonly<Record<string, string>>>
  >;
  serviceName: string;
  serviceVersion?: string;
  otelEnvironment?: string;
  otelTracesSampleRate: number;
  localSqliteEnabled: boolean;
  localSqlitePath: string;
  proxyMaxBytes: number;
  logMaxEvents: number;
};

let cachedTelemetryConfig: TelemetryConfig | undefined;

const forbiddenHeaders = new Set([
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
  'expect',
  'te',
  'trailer',
  'host',
  'content-length',
]);

const validateCollectorHeader = (
  variable: string,
  name: string,
  value: string
) => {
  const message = `Invalid ${variable}: expected supported HTTP header names and values.`;
  if (forbiddenHeaders.has(name.toLowerCase()))
    throw new ConfigurationError(message);
  try {
    validateHeaderName(name);
    validateHeaderValue(name, value);
  } catch {
    throw new ConfigurationError(message);
  }
};

const parseCollectorHeaders = (variable: string, value: string | undefined) =>
  Object.fromEntries(
    // Normalize each SDK-parsed entry before resolving duplicates. Parsing the
    // entire record first loses source order when exact and mixed-case names
    // are interleaved (X-Key=first,x-key=second,X-Key=last).
    (value ?? '').split(',').flatMap((entry) =>
      Object.entries(parseKeyPairsIntoRecord(entry)).map(([name, value]) => {
        validateCollectorHeader(variable, name, value);
        return [name.toLowerCase(), value];
      })
    )
  );

export const resolveCollectorHeaders = (
  config: TelemetryConfig,
  signal: 'traces' | 'metrics' | 'logs'
) => {
  const headers = new Headers(config.collectorHeaders);
  for (const [name, value] of Object.entries(config.signalHeaders[signal]))
    headers.set(name, value);
  if (config.collectorBearerToken)
    headers.set('authorization', `Bearer ${config.collectorBearerToken}`);
  return Object.fromEntries(headers.entries());
};

export function getTelemetryConfig(): TelemetryConfig {
  if (cachedTelemetryConfig) return cachedTelemetryConfig;

  const env = parseEnv(telemetryEnvSchema);
  const isProduction = isProdRuntimeEnvironment(env);
  if (isProduction && !env.OTEL_COLLECTOR_URL) {
    throw new ConfigurationError(
      'OTEL_COLLECTOR_URL is required in production telemetry configuration.'
    );
  }

  const collectorHeaders = env.OTEL_COLLECTOR_URL
    ? parseCollectorHeaders(
        'OTEL_EXPORTER_OTLP_HEADERS',
        env.OTEL_EXPORTER_OTLP_HEADERS
      )
    : {};
  const signalHeaders = {
    traces: env.OTEL_COLLECTOR_URL
      ? parseCollectorHeaders(
          'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
          env.OTEL_EXPORTER_OTLP_TRACES_HEADERS
        )
      : {},
    metrics: env.OTEL_COLLECTOR_URL
      ? parseCollectorHeaders(
          'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
          env.OTEL_EXPORTER_OTLP_METRICS_HEADERS
        )
      : {},
    logs: env.OTEL_COLLECTOR_URL
      ? parseCollectorHeaders(
          'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
          env.OTEL_EXPORTER_OTLP_LOGS_HEADERS
        )
      : {},
  };
  if (env.OTEL_COLLECTOR_URL && env.OTEL_COLLECTOR_BEARER_TOKEN) {
    validateCollectorHeader(
      'OTEL_COLLECTOR_BEARER_TOKEN',
      'authorization',
      `Bearer ${env.OTEL_COLLECTOR_BEARER_TOKEN}`
    );
  }

  cachedTelemetryConfig = {
    dsn: env.SENTRY_DSN,
    browserDsn: env.VITE_SENTRY_DSN ?? env.SENTRY_DSN,
    environment: env.SENTRY_ENVIRONMENT,
    tracesSampleRate: env.SENTRY_TRACES_SAMPLE_RATE ?? (isProduction ? 0.1 : 1),
    org: env.SENTRY_ORG,
    project: env.SENTRY_PROJECT,
    authToken: env.SENTRY_AUTH_TOKEN,
    collectorUrl: env.OTEL_COLLECTOR_URL,
    collectorBearerToken: env.OTEL_COLLECTOR_BEARER_TOKEN,
    collectorHeaders,
    signalHeaders,
    serviceName: env.OTEL_SERVICE_NAME ?? 'start-ui-web',
    serviceVersion: env.OTEL_SERVICE_VERSION,
    otelEnvironment:
      env.OTEL_ENVIRONMENT ??
      env.SENTRY_ENVIRONMENT ??
      (isProduction ? 'production' : 'local'),
    otelTracesSampleRate: env.OTEL_TRACES_SAMPLE_RATE ?? 1,
    localSqliteEnabled: env.OTEL_LOCAL_SQLITE_ENABLED ?? !isProduction,
    localSqlitePath:
      env.OTEL_LOCAL_SQLITE_PATH ?? '.telemetry/telemetry.sqlite',
    proxyMaxBytes: env.TELEMETRY_PROXY_MAX_BYTES ?? 1_000_000,
    logMaxEvents: env.TELEMETRY_LOG_MAX_EVENTS ?? 50,
  };
  return cachedTelemetryConfig;
}
