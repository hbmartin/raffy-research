import { describe, expect, it } from 'vitest';

import { signalUrl } from '@/composition/telemetry/otel.server';

describe('OTLP signal URL', () => {
  it('appends the signal path to a base collector URL', () => {
    expect(signalUrl('https://app.phoenix.arize.com/s/acme', 'traces')).toBe(
      'https://app.phoenix.arize.com/s/acme/v1/traces'
    );
  });

  it('tolerates a trailing slash', () => {
    expect(signalUrl('https://collector.example.com/', 'metrics')).toBe(
      'https://collector.example.com/v1/metrics'
    );
  });

  // Appending blindly produced /v1/traces/v1/traces, which the collector
  // answers with 405 while the exporter reports nothing.
  it('does not double a URL that already names the signal', () => {
    expect(
      signalUrl('https://app.phoenix.arize.com/s/acme/v1/traces', 'traces')
    ).toBe('https://app.phoenix.arize.com/s/acme/v1/traces');
  });

  it('does not double a URL that already ends in /v1', () => {
    expect(signalUrl('https://app.phoenix.arize.com/v1', 'traces')).toBe(
      'https://app.phoenix.arize.com/v1/traces'
    );
  });

  it('rewrites one signal path to another rather than nesting', () => {
    expect(signalUrl('https://collector.example.com/v1/traces', 'logs')).toBe(
      'https://collector.example.com/v1/logs'
    );
  });

  it('leaves a path that merely contains v1 elsewhere alone', () => {
    expect(signalUrl('https://example.com/v1/api/otel', 'traces')).toBe(
      'https://example.com/v1/api/otel/v1/traces'
    );
  });
});
