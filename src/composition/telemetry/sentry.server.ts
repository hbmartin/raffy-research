import * as Sentry from '@sentry/tanstackstart-react';

import {
  createNoOpTelemetry,
  type TelemetryAdapter,
} from '@/platform/telemetry';

import { createTelemetryAdapterChain } from './adapter-chain';
import { setTelemetry } from './index';
import { initOpenTelemetryServer } from './otel.server';
import { createSentryTelemetryAdapter } from './sentry-adapter';
import { initSentryServer } from './sentry-bootstrap.server';

let initialized = false;

const isTelemetryAdapter = (
  adapter: TelemetryAdapter | undefined
): adapter is TelemetryAdapter => Boolean(adapter);

/**
 * Initialize Sentry for the Node server runtime. Safe to call multiple times;
 * the underlying SDK is only initialized once per process.
 *
 * No-op when `SENTRY_DSN` is unset so dev/test/CI without a DSN keep working.
 */
export const initTelemetryServer = () => {
  if (initialized) return;

  const sentryEnabled = initSentryServer();
  const otelAdapter = initOpenTelemetryServer();
  const adapters = [otelAdapter].filter(isTelemetryAdapter);
  if (sentryEnabled) {
    adapters.push(createSentryTelemetryAdapter(Sentry));
  }
  setTelemetry(
    createTelemetryAdapterChain(
      adapters.length > 0 ? adapters : [createNoOpTelemetry()]
    )
  );
  initialized = true;
};
