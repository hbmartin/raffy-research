import * as Sentry from '@sentry/tanstackstart-react';

const dsn = process.env.SENTRY_DSN ?? process.env.VITE_SENTRY_DSN;

if (dsn) {
  try {
    Sentry.init({
      dsn,
      sendDefaultPii: false,
      tracesSampleRate: 0,
      skipOpenTelemetrySetup: true,
    });
  } catch {
    process.stderr.write('{"event":"telemetry.sentry_init_failed"}\n');
  }
}
