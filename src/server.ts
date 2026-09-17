// oxlint-disable-next-line simple-import-sort/imports -- Sentry must initialize before server dependencies evaluate.
import '../instrument.server.mjs';

import { flushIfServerless } from '@sentry/core';
import { captureException } from '@sentry/tanstackstart-react';
import handler, {
  createServerEntry,
  type ServerEntry,
} from '@tanstack/react-start/server-entry';
import { randomUUID } from 'node:crypto';

import { createErrorOnlyFetch } from './composition/telemetry/error-only-fetch';
import { initTelemetryServer } from './composition/telemetry/sentry.server';
import { isValidatedSsrFixtureRuntime } from './modules/kernel/infrastructure/config/auth';
import type { AppStartRequestContext } from './start';

initTelemetryServer();

const requestHandler: ServerEntry = {
  fetch: createErrorOnlyFetch(
    (request) => {
      return handler.fetch(request, {
        context: {
          allowPlaywrightScreenshotStyles: isValidatedSsrFixtureRuntime(),
          requestId: randomUUID(),
        } satisfies AppStartRequestContext,
      });
    },
    { captureException, flush: () => flushIfServerless() }
  ),
};

export default createServerEntry(requestHandler);
