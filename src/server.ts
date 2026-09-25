// oxlint-disable-next-line simple-import-sort/imports -- Sentry must initialize before server dependencies evaluate.
import '../instrument.server.mjs';

import { flushIfServerless } from '@sentry/core/server';
import { captureException } from '@sentry/tanstackstart-react';
import handler, {
  createServerEntry,
  type ServerEntry,
} from '@tanstack/react-start/server-entry';
import { randomUUID } from 'node:crypto';

import { createErrorOnlyFetch } from './composition/telemetry/error-only-fetch';
import {
  captureServerTelemetryUserContext,
  closeServerTelemetryUserContext,
  runWithServerTelemetryUserContext,
} from './composition/telemetry/otel.server';
import { initTelemetryServer } from './composition/telemetry/sentry.server';
import { isValidatedSsrFixtureRuntime } from './modules/kernel/infrastructure/config/auth';
import type { AppStartRequestContext } from './start';

initTelemetryServer();

const allowFixtureScreenshotStyles = isValidatedSsrFixtureRuntime(
  import.meta.env.RAFFY_PRODUCTION_BUILD === true ||
    import.meta.env.RAFFY_PRODUCTION_BUILD === 'true'
);

const observedFetch = createErrorOnlyFetch(
  (request) =>
    handler.fetch(request, {
      context: {
        allowPlaywrightScreenshotStyles:
          allowFixtureScreenshotStyles &&
          new URL(request.url).hostname === '127.0.0.1',
        requestId: randomUUID(),
      } satisfies AppStartRequestContext,
    }),
  { captureException, flush: () => flushIfServerless() },
  captureServerTelemetryUserContext,
  closeServerTelemetryUserContext
);

const requestHandler: ServerEntry = {
  fetch: (...args) =>
    runWithServerTelemetryUserContext(() => observedFetch(...args)),
};

export default createServerEntry(requestHandler);
