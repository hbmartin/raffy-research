import * as Sentry from '@sentry/tanstackstart-react';

import { getSentryServerConfig } from '@/modules/kernel/infrastructure/config/telemetry';

import { sanitizeSentryEvent } from './sentry-adapter';

type SentryInitOptions = Parameters<typeof Sentry.init>[0];

let state: 'new' | 'disabled' | 'enabled' | 'failed' = 'new';

/**
 * Initialize Sentry before the rest of the server graph. OpenTelemetry owns
 * tracing, while Sentry retains its error and request-isolation integrations.
 */
export const initSentryServer = () => {
  if (state !== 'new') return state === 'enabled';

  const config = getSentryServerConfig();
  if (!config.dsn) {
    state = 'disabled';
    return false;
  }

  try {
    const options = {
      beforeSend: sanitizeSentryEvent,
      defaultIntegrations: Sentry.getDefaultIntegrationsWithoutPerformance(),
      dsn: config.dsn,
      environment: config.environment,
      enableOpenTelemetrySetup: false,
      // The Node SDK otherwise reads SENTRY_TRACES_SAMPLE_RATE from the
      // environment. Its runtime treats null as disabled even though its
      // public option type only includes number | undefined.
      tracesSampleRate: null as unknown as number,
    } satisfies SentryInitOptions;

    Sentry.init(options);
    state = 'enabled';
    return true;
  } catch {
    state = 'failed';
    process.stderr.write('{"event":"telemetry.sentry_init_failed"}\n');
    return false;
  }
};
