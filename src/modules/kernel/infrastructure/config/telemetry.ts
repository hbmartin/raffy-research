import { validateHeaderName, validateHeaderValue } from 'node:http';
import { z } from 'zod';

import {
  baseEnvSchema,
  isProdRuntimeEnvironment,
  parseEnv,
  shouldSkipEnvValidation,
} from './env-schema';
import { ConfigurationError } from '../../domain/errors/configuration-error';

const sentryEnvSchema = baseEnvSchema.extend({
  SENTRY_DSN: z.string().url().optional(),
  VITE_SENTRY_DSN: z.string().url().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
});

const telemetryEnvSchema = baseEnvSchema.extend({
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
  collectorUrl?: string;
  collectorBearerToken?: string;
  collectorHeaders: Readonly<Record<string, string>>;
  signalHeaders: Readonly<
    Record<'traces' | 'metrics' | 'logs', Readonly<Record<string, string>>>
  >;
  resolvedHeaders: Readonly<
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

export type SentryServerConfig = Pick<
  TelemetryConfig,
  'browserDsn' | 'dsn' | 'environment'
>;

let cachedTelemetryConfig: TelemetryConfig | undefined;
let cachedSentryServerConfig: SentryServerConfig | undefined;
const reportedInvalidConfig = new Set<'otel' | 'sentry'>();

const reportInvalidConfigFallback = (component: 'otel' | 'sentry') => {
  if (reportedInvalidConfig.has(component)) return;
  reportedInvalidConfig.add(component);
  process.stderr.write(
    `${JSON.stringify({
      component,
      event: 'telemetry.config_invalid',
      fallback: 'disabled',
    })}\n`
  );
};

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

const parseCollectorHeaders = (variable: string, value: string | undefined) => {
  if (!value) return {};
  const parsed: Record<string, string> = {};
  for (const entry of value.split(',')) {
    const separator = entry.indexOf('=');
    if (separator <= 0 || entry.includes(';'))
      throw new ConfigurationError(
        `Invalid ${variable}: expected key=value entries without metadata.`
      );
    let name: string;
    let decodedValue: string;
    try {
      name = decodeURIComponent(entry.slice(0, separator).trim());
      decodedValue = decodeURIComponent(entry.slice(separator + 1).trim());
    } catch {
      throw new ConfigurationError(
        `Invalid ${variable}: malformed percent escape.`
      );
    }
    if (!name || !decodedValue)
      throw new ConfigurationError(
        `Invalid ${variable}: empty header name or value.`
      );
    validateCollectorHeader(variable, name, decodedValue);
    // Preserve source order, including mixed-case duplicates: the last wins.
    parsed[name.toLowerCase()] = decodedValue;
  }
  return parsed;
};

const mergeCollectorHeaders = (
  general: Readonly<Record<string, string>>,
  signal: Readonly<Record<string, string>>,
  bearer?: string
) => {
  const headers = new Headers(general);
  for (const [name, value] of Object.entries(signal)) headers.set(name, value);
  if (bearer) headers.set('authorization', `Bearer ${bearer}`);
  return Object.fromEntries(headers.entries());
};

export const resolveCollectorHeaders = (
  config: TelemetryConfig,
  signal: 'traces' | 'metrics' | 'logs'
) => config.resolvedHeaders[signal];

export function getSentryServerConfig(): SentryServerConfig {
  if (cachedSentryServerConfig) return cachedSentryServerConfig;

  try {
    const env = parseEnv(sentryEnvSchema);
    cachedSentryServerConfig = {
      dsn: env.SENTRY_DSN ?? env.VITE_SENTRY_DSN,
      browserDsn: env.VITE_SENTRY_DSN ?? env.SENTRY_DSN,
      environment: env.SENTRY_ENVIRONMENT,
    };
  } catch (error) {
    if (!shouldSkipEnvValidation() || !(error instanceof ConfigurationError))
      throw error;
    reportInvalidConfigFallback('sentry');
    cachedSentryServerConfig = {};
  }

  return cachedSentryServerConfig;
}

export function getTelemetryConfig(): TelemetryConfig {
  if (cachedTelemetryConfig) return cachedTelemetryConfig;

  const sentryConfig = getSentryServerConfig();

  try {
    cachedTelemetryConfig = buildTelemetryConfig(sentryConfig);
  } catch (error) {
    if (!shouldSkipEnvValidation() || !(error instanceof ConfigurationError))
      throw error;
    // An explicit validation bypass must never export with partially parsed
    // credentials. Keep the app available with telemetry disabled instead.
    reportInvalidConfigFallback('otel');
    cachedTelemetryConfig = {
      ...sentryConfig,
      collectorHeaders: {},
      signalHeaders: { traces: {}, metrics: {}, logs: {} },
      resolvedHeaders: { traces: {}, metrics: {}, logs: {} },
      serviceName: 'start-ui-web',
      otelTracesSampleRate: 0,
      localSqliteEnabled: false,
      localSqlitePath: '.telemetry/telemetry.sqlite',
      proxyMaxBytes: 1_000_000,
      logMaxEvents: 50,
    };
  }
  return cachedTelemetryConfig;
}

function buildTelemetryConfig(
  sentryConfig: SentryServerConfig
): TelemetryConfig {
  const env = parseEnv(telemetryEnvSchema);
  const isProduction = isProdRuntimeEnvironment(env);
  if (
    isProduction &&
    !env.OTEL_COLLECTOR_URL &&
    !shouldSkipEnvValidation(env)
  ) {
    throw new ConfigurationError(
      'OTEL_COLLECTOR_URL is required in production telemetry configuration.'
    );
  }

  const headerVariables = {
    general: 'OTEL_EXPORTER_OTLP_HEADERS',
    traces: 'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
    metrics: 'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
    logs: 'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
  } as const;
  const parsedHeaders = Object.fromEntries(
    Object.entries(headerVariables).map(([signal, variable]) => [
      signal,
      env.OTEL_COLLECTOR_URL
        ? parseCollectorHeaders(variable, env[variable])
        : {},
    ])
  ) as Record<keyof typeof headerVariables, Record<string, string>>;
  const collectorHeaders = parsedHeaders.general;
  const signalHeaders = {
    traces: parsedHeaders.traces,
    metrics: parsedHeaders.metrics,
    logs: parsedHeaders.logs,
  };
  if (env.OTEL_COLLECTOR_URL && env.OTEL_COLLECTOR_BEARER_TOKEN) {
    validateCollectorHeader(
      'OTEL_COLLECTOR_BEARER_TOKEN',
      'authorization',
      `Bearer ${env.OTEL_COLLECTOR_BEARER_TOKEN}`
    );
  }

  return {
    ...sentryConfig,
    collectorUrl: env.OTEL_COLLECTOR_URL,
    collectorBearerToken: env.OTEL_COLLECTOR_BEARER_TOKEN,
    collectorHeaders,
    signalHeaders,
    resolvedHeaders: {
      traces: mergeCollectorHeaders(
        collectorHeaders,
        signalHeaders.traces,
        env.OTEL_COLLECTOR_BEARER_TOKEN
      ),
      metrics: mergeCollectorHeaders(
        collectorHeaders,
        signalHeaders.metrics,
        env.OTEL_COLLECTOR_BEARER_TOKEN
      ),
      logs: mergeCollectorHeaders(
        collectorHeaders,
        signalHeaders.logs,
        env.OTEL_COLLECTOR_BEARER_TOKEN
      ),
    },
    serviceName: env.OTEL_SERVICE_NAME ?? 'start-ui-web',
    serviceVersion: env.OTEL_SERVICE_VERSION,
    otelEnvironment:
      env.OTEL_ENVIRONMENT ??
      sentryConfig.environment ??
      (isProduction ? 'production' : 'local'),
    otelTracesSampleRate: env.OTEL_TRACES_SAMPLE_RATE ?? 1,
    localSqliteEnabled: env.OTEL_LOCAL_SQLITE_ENABLED ?? !isProduction,
    localSqlitePath:
      env.OTEL_LOCAL_SQLITE_PATH ?? '.telemetry/telemetry.sqlite',
    proxyMaxBytes: env.TELEMETRY_PROXY_MAX_BYTES ?? 1_000_000,
    logMaxEvents: env.TELEMETRY_LOG_MAX_EVENTS ?? 50,
  };
}
