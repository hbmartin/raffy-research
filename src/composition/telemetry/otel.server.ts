import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import {
  CompositePropagator,
  W3CBaggagePropagator,
  W3CTraceContextPropagator,
} from '@opentelemetry/core';
import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { resourceFromAttributes } from '@opentelemetry/resources';
import {
  BatchLogRecordProcessor,
  LoggerProvider,
} from '@opentelemetry/sdk-logs';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';
import {
  BatchSpanProcessor,
  NodeTracerProvider,
  ParentBasedSampler,
  TraceIdRatioBasedSampler,
} from '@opentelemetry/sdk-trace-node';
import {
  ATTR_DEPLOYMENT_ENVIRONMENT_NAME,
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';
import * as Sentry from '@sentry/tanstackstart-react';
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  getTelemetryConfig,
  resolveCollectorHeaders,
} from '@/modules/kernel/infrastructure/config/telemetry';
import type { TelemetryAdapter, TelemetryUser } from '@/platform/telemetry';

import { createOpenTelemetryAdapter } from './otel-adapter';

export const createServerTelemetryUserContext = () => {
  const users = new AsyncLocalStorage<{ user: TelemetryUser | null }>();
  return {
    getUser: () => users.getStore()?.user ?? null,
    run: <T>(fn: () => T) => users.run({ user: null }, fn),
    setUser: (user: TelemetryUser | null) => {
      const store = users.getStore();
      if (store) store.user = user;
    },
    capture: () => {
      const snapshot = AsyncLocalStorage.snapshot();
      return <T>(fn: () => T): T => snapshot(fn);
    },
  };
};

let state: 'new' | 'ready' | 'failed' = 'new';
let adapter: TelemetryAdapter | undefined;
const userContext = createServerTelemetryUserContext();

export const runWithServerTelemetryUserContext = <T>(fn: () => T) =>
  userContext.run(fn);

export const captureServerTelemetryUserContext = () => userContext.capture();

const trimTrailingSlash = (value: string) => value.replace(/\/+$/, '');

const signalUrl = (
  collectorUrl: string,
  signal: 'logs' | 'metrics' | 'traces'
) => `${trimTrailingSlash(collectorUrl)}/v1/${signal}`;

const createResource = (config: ReturnType<typeof getTelemetryConfig>) =>
  resourceFromAttributes({
    [ATTR_DEPLOYMENT_ENVIRONMENT_NAME]: config.otelEnvironment,
    [ATTR_SERVICE_NAME]: config.serviceName,
    ...(config.serviceVersion
      ? { [ATTR_SERVICE_VERSION]: config.serviceVersion }
      : {}),
  });

export const initOpenTelemetryServer = (): TelemetryAdapter | undefined => {
  if (state !== 'new') return adapter;

  // Configuration errors are deliberately outside the SDK failure boundary.
  const config = getTelemetryConfig();

  let tracerProvider: NodeTracerProvider | undefined;
  let meterProvider: MeterProvider | undefined;
  let loggerProvider: LoggerProvider | undefined;
  try {
    const contextManager = new Sentry.SentryContextManager();
    contextManager.enable();
    if (!context.setGlobalContextManager(contextManager)) {
      contextManager.disable();
      throw new Error('OpenTelemetry context manager was already registered');
    }
    if (
      !propagation.setGlobalPropagator(
        new CompositePropagator({
          propagators: [
            new W3CTraceContextPropagator(),
            new W3CBaggagePropagator(),
          ],
        })
      )
    )
      throw new Error('OpenTelemetry propagator was already registered');

    if (!config.collectorUrl) {
      state = 'ready';
      return undefined;
    }

    const resource = createResource(config);
    tracerProvider = new NodeTracerProvider({
      resource,
      sampler: new ParentBasedSampler({
        root: new TraceIdRatioBasedSampler(config.otelTracesSampleRate),
      }),
      spanProcessors: [
        new BatchSpanProcessor(
          new OTLPTraceExporter({
            headers: resolveCollectorHeaders(config, 'traces'),
            url: signalUrl(config.collectorUrl, 'traces'),
          })
        ),
      ],
    });

    meterProvider = new MeterProvider({
      readers: [
        new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({
            headers: resolveCollectorHeaders(config, 'metrics'),
            url: signalUrl(config.collectorUrl, 'metrics'),
          }),
          exportIntervalMillis: 30_000,
        }),
      ],
      resource,
    });
    loggerProvider = new LoggerProvider({
      processors: [
        new BatchLogRecordProcessor(
          new OTLPLogExporter({
            headers: resolveCollectorHeaders(config, 'logs'),
            url: signalUrl(config.collectorUrl, 'logs'),
          })
        ),
      ],
      resource,
    });
    // Build every timer-owning provider before mutating process globals. Any
    // failure after this point is terminal for the process, never retried.
    if (!trace.setGlobalTracerProvider(tracerProvider))
      throw new Error('OpenTelemetry tracer provider was already registered');
    if (!metrics.setGlobalMeterProvider(meterProvider))
      throw new Error('OpenTelemetry meter provider was already registered');
    if (!logs.setGlobalLoggerProvider(loggerProvider))
      throw new Error('OpenTelemetry logger provider was already registered');
    adapter = createOpenTelemetryAdapter(userContext);
    state = 'ready';
    return adapter;
  } catch {
    state = 'failed';
    // The API cannot unregister a global provider. Shut down all constructed
    // exporters and never construct replacements on a later call.
    void Promise.allSettled([
      tracerProvider?.shutdown(),
      meterProvider?.shutdown(),
      loggerProvider?.shutdown(),
    ]);
    process.stderr.write('{"event":"telemetry.sdk_init_failed"}\n');
    return undefined;
  }
};
