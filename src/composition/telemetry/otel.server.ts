import { context, metrics, propagation, trace } from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { AsyncLocalStorageContextManager } from '@opentelemetry/context-async-hooks';
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
import { AsyncLocalStorage } from 'node:async_hooks';

import {
  getTelemetryConfig,
  resolveCollectorHeaders,
} from '@/modules/kernel/infrastructure/config/telemetry';
import type { TelemetryAdapter, TelemetryUser } from '@/platform/telemetry';

import { createOpenTelemetryAdapter } from './otel-adapter';

export const createServerTelemetryUserContext = () => {
  const users = new AsyncLocalStorage<{
    closed: boolean;
    user: TelemetryUser | null;
  }>();
  return {
    getUser: () => {
      const store = users.getStore();
      return store && !store.closed ? store.user : null;
    },
    run: <T>(fn: () => T) => users.run({ closed: false, user: null }, fn),
    setUser: (user: TelemetryUser | null) => {
      const store = users.getStore();
      if (store && !store.closed) store.user = user;
    },
    close: () => {
      const store = users.getStore();
      if (store) {
        store.closed = true;
        store.user = null;
      }
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
export const closeServerTelemetryUserContext = () => userContext.close();

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
    const contextManager = new AsyncLocalStorageContextManager().enable();
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

    // Phoenix is a second, independent trace destination: a Phoenix-only
    // setup must still initialise, so neither URL alone may short-circuit.
    if (!config.collectorUrl && !config.phoenixCollectorUrl) {
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
        ...(config.collectorUrl
          ? [
              new BatchSpanProcessor(
                new OTLPTraceExporter({
                  headers: resolveCollectorHeaders(config, 'traces'),
                  url: signalUrl(config.collectorUrl, 'traces'),
                })
              ),
            ]
          : []),
        ...(config.phoenixCollectorUrl
          ? [
              new BatchSpanProcessor(
                new OTLPTraceExporter({
                  headers: config.phoenixApiKey
                    ? { Authorization: `Bearer ${config.phoenixApiKey}` }
                    : undefined,
                  url: signalUrl(config.phoenixCollectorUrl, 'traces'),
                })
              ),
            ]
          : []),
      ],
    });

    // Metrics and logs stay on the primary collector; Phoenix takes traces
    // only, so a Phoenix-only setup builds no meter or logger provider.
    const collectorUrl = config.collectorUrl;
    if (collectorUrl) {
      meterProvider = new MeterProvider({
        readers: [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              headers: resolveCollectorHeaders(config, 'metrics'),
              url: signalUrl(collectorUrl, 'metrics'),
            }),
            exportIntervalMillis: 30_000,
          }),
        ],
        resource,
      });
      loggerProvider = new LoggerProvider({
        processors: [
          new BatchLogRecordProcessor({
            exporter: new OTLPLogExporter({
              headers: resolveCollectorHeaders(config, 'logs'),
              url: signalUrl(collectorUrl, 'logs'),
            }),
          }),
        ],
        resource,
      });
    }
    // Build every timer-owning provider before mutating process globals. Any
    // failure after this point is terminal for the process, never retried.
    if (!trace.setGlobalTracerProvider(tracerProvider))
      throw new Error('OpenTelemetry tracer provider was already registered');
    if (meterProvider && !metrics.setGlobalMeterProvider(meterProvider))
      throw new Error('OpenTelemetry meter provider was already registered');
    if (loggerProvider && !logs.setGlobalLoggerProvider(loggerProvider))
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
