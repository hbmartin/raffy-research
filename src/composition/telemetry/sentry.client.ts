import * as Sentry from '@sentry/tanstackstart-react';

import { envClient } from '@/platform/env/client';
import {
  createNoOpTelemetry,
  type TelemetryAdapter,
} from '@/platform/telemetry';

import { createTelemetryAdapterChain } from './adapter-chain';
import { setTelemetry } from './index';
import { initOpenTelemetryClient } from './otel.client';
import {
  createSentryTelemetryAdapter,
  sanitizeSentryEvent,
} from './sentry-adapter';
import { sentryDataCollection } from './sentry-data-collection';

let initialized = false;

type SentryInitOptions = Parameters<typeof Sentry.init>[0];

/**
 * Initialize Sentry for the browser runtime. Safe to call multiple times.
 *
 * No-op when `VITE_SENTRY_DSN` is unset so previews/local dev keep working
 * without telemetry configuration.
 */
const isTelemetryAdapter = (
  adapter: TelemetryAdapter | undefined
): adapter is TelemetryAdapter => Boolean(adapter);

export const initTelemetryClient = (_router?: unknown) => {
  if (initialized) return;
  initialized = true;

  const adapters = [initOpenTelemetryClient()].filter(isTelemetryAdapter);

  if (!envClient.VITE_SENTRY_DSN) {
    if (adapters.length > 0) {
      setTelemetry(createTelemetryAdapterChain(adapters));
    }
    return;
  }

  const options = {
    dsn: envClient.VITE_SENTRY_DSN,
    environment: envClient.VITE_SENTRY_ENVIRONMENT,
    // A nullish override prevents the SDK from treating a zero sampling rate as
    // tracing enabled. OpenTelemetry is the sole trace owner.
    tracesSampleRate: null,
    dataCollection: sentryDataCollection,
    tunnel: envClient.VITE_SENTRY_TUNNEL_PATH,
    beforeSend: sanitizeSentryEvent,
    integrations: [],
  };

  Sentry.init(options as unknown as SentryInitOptions);

  adapters.push(createSentryTelemetryAdapter(Sentry));
  setTelemetry(
    createTelemetryAdapterChain(
      adapters.length > 0 ? adapters : [createNoOpTelemetry()]
    )
  );
};
