import {
  context,
  metrics,
  propagation,
  ProxyTracerProvider,
  trace,
} from '@opentelemetry/api';
import { logs } from '@opentelemetry/api-logs';
import { LoggerProvider } from '@opentelemetry/sdk-logs';
import { MeterProvider } from '@opentelemetry/sdk-metrics';
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { once } from 'node:events';
import { createServer, type IncomingHttpHeaders, type Server } from 'node:http';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let collector: Server;
let providers: Array<{
  forceFlush(): Promise<void>;
  shutdown(): Promise<void>;
}> = [];

beforeEach(() => {
  vi.resetModules();
  trace.disable();
  metrics.disable();
  logs.disable();
  context.disable();
  propagation.disable();
});

afterEach(async () => {
  await Promise.all(providers.map((provider) => provider.shutdown()));
  providers = [];
  collector?.closeAllConnections();
  await new Promise<void>((resolve) => collector?.close(() => resolve()));
  trace.disable();
  metrics.disable();
  logs.disable();
  context.disable();
  propagation.disable();
  vi.unstubAllEnvs();
});

describe('server OTLP header precedence', () => {
  it.each([undefined, 'explicit-token'])(
    'preserves signal-specific headers with collector bearer token %s',
    async (bearerToken) => {
      const received: Array<{ path: string; headers: IncomingHttpHeaders }> =
        [];
      collector = createServer((request, response) => {
        received.push({ path: request.url ?? '', headers: request.headers });
        request.resume();
        response.writeHead(200, { 'Content-Type': 'application/x-protobuf' });
        response.end();
      });
      collector.listen(0, '127.0.0.1');
      await once(collector, 'listening');
      const address = collector.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing collector port');

      vi.stubEnv('OTEL_COLLECTOR_URL', `http://127.0.0.1:${address.port}`);
      vi.stubEnv('OTEL_COLLECTOR_BEARER_TOKEN', bearerToken);
      vi.stubEnv(
        'OTEL_EXPORTER_OTLP_HEADERS',
        'x-key=general,x-shared=shared,authorization=Basic%20general'
      );
      vi.stubEnv(
        'OTEL_EXPORTER_OTLP_TRACES_HEADERS',
        'x-key=traces,authorization=Basic%20traces'
      );
      vi.stubEnv(
        'OTEL_EXPORTER_OTLP_METRICS_HEADERS',
        'x-key=metrics,authorization=Basic%20metrics'
      );
      vi.stubEnv(
        'OTEL_EXPORTER_OTLP_LOGS_HEADERS',
        'x-key=logs,authorization=Basic%20logs'
      );
      vi.stubEnv('OTEL_TRACES_SAMPLE_RATE', '1');

      const { initOpenTelemetryServer } =
        await import('@/composition/telemetry/otel.server');
      initOpenTelemetryServer();
      const tracer = trace.getTracerProvider() as ProxyTracerProvider;
      const tracerProvider = tracer.getDelegate() as NodeTracerProvider;
      const meterProvider = metrics.getMeterProvider() as MeterProvider;
      const loggerProvider = logs.getLoggerProvider() as LoggerProvider;
      providers = [tracerProvider, meterProvider, loggerProvider];

      trace.getTracer('header-test').startSpan('export').end();
      metrics.getMeter('header-test').createCounter('header_test').add(1);
      logs.getLogger('header-test').emit({ body: 'export' });
      await Promise.all(providers.map((provider) => provider.forceFlush()));

      expect(received.map(({ path }) => path).sort()).toEqual([
        '/v1/logs',
        '/v1/metrics',
        '/v1/traces',
      ]);
      for (const { path, headers } of received) {
        const signal = path.slice('/v1/'.length);
        expect(headers['x-key']).toBe(signal);
        expect(headers['x-shared']).toBe('shared');
        expect(headers.authorization).toBe(
          bearerToken ? `Bearer ${bearerToken}` : `Basic ${signal}`
        );
        expect(headers['content-type']).toBe('application/x-protobuf');
      }
    }
  );
});

vi.mock('@/composition/kernel', () => ({ getKernel: vi.fn() }));

describe('proxy HTTP failure boundary', () => {
  it.each(['collector', 'sentry'] as const)(
    'returns a controlled 502 for %s rejection and connection refusal',
    async (destination) => {
      collector = createServer((request, response) => {
        request.resume();
        response.writeHead(401);
        response.end('upstream-private-detail');
      });
      collector.listen(0, '127.0.0.1');
      await once(collector, 'listening');
      const address = collector.address();
      if (!address || typeof address === 'string')
        throw new Error('Missing collector port');
      const origin = `http://127.0.0.1:${address.port}`;
      vi.stubEnv('OTEL_COLLECTOR_URL', origin);
      vi.stubEnv('VITE_SENTRY_DSN', `${origin.replace('://', '://public@')}/1`);
      vi.stubEnv('OTEL_LOCAL_SQLITE_ENABLED', 'false');
      const diagnostic = vi
        .spyOn(process.stderr, 'write')
        .mockReturnValue(true);
      try {
        const { handleOtlpProxyRequest, handleSentryTunnelRequest } =
          await import('@/composition/telemetry/transport');
        const send = () => {
          const request = new Request('http://localhost/api/telemetry', {
            method: 'POST',
            headers: {
              Origin: 'http://localhost',
              'Sec-Fetch-Site': 'same-origin',
              'Content-Type':
                destination === 'collector'
                  ? 'application/x-protobuf'
                  : 'application/x-sentry-envelope',
            },
            body: 'fixture',
          });
          return destination === 'collector'
            ? handleOtlpProxyRequest(request, 'traces')
            : handleSentryTunnelRequest(request);
        };
        const rejected = await send();
        expect(rejected.status).toBe(502);
        expect(await rejected.text()).toBe('');
        collector.closeAllConnections();
        await new Promise<void>((resolve) => collector.close(() => resolve()));
        const disconnected = await send();
        expect(disconnected.status).toBe(502);
        expect(await disconnected.text()).toBe('');
        expect(diagnostic).toHaveBeenCalledTimes(2);
        expect(JSON.stringify(diagnostic.mock.calls)).not.toContain(
          'upstream-private-detail'
        );
      } finally {
        diagnostic.mockRestore();
      }
    }
  );
});
