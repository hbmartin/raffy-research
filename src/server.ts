import { wrapFetchWithSentry } from '@sentry/tanstackstart-react';
import handler, {
  createServerEntry,
  type ServerEntry,
} from '@tanstack/react-start/server-entry';
import { randomUUID } from 'node:crypto';
import '../instrument.server.mjs';

import { initTelemetryServer } from './composition/telemetry/sentry.server';
import type { AppStartRequestContext } from './start';

initTelemetryServer();

const requestHandler: ServerEntry = wrapFetchWithSentry({
  fetch(request) {
    return handler.fetch(request, {
      context: {
        requestId: randomUUID(),
      } satisfies AppStartRequestContext,
    });
  },
});

export default createServerEntry(requestHandler);
