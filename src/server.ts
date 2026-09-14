import { flushIfServerless } from '@sentry/core';
import { captureException } from '@sentry/tanstackstart-react';
import handler, {
  createServerEntry,
  type ServerEntry,
} from '@tanstack/react-start/server-entry';
import { randomUUID } from 'node:crypto';
import '../instrument.server.mjs';

import { createErrorOnlyFetch } from './composition/telemetry/error-only-fetch';
import { initTelemetryServer } from './composition/telemetry/sentry.server';
import type { AppStartRequestContext } from './start';

initTelemetryServer();

const requestHandler: ServerEntry = {
  fetch: createErrorOnlyFetch(
    (request) => {
      return handler.fetch(request, {
        context: {
          requestId: randomUUID(),
        } satisfies AppStartRequestContext,
      });
    },
    { captureException, flush: () => flushIfServerless() }
  ),
};

export default createServerEntry(requestHandler);
