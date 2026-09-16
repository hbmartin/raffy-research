import type { ServerEntry } from '@tanstack/react-start/server-entry';

type ErrorReporter = {
  captureException(
    error: unknown,
    context?: { mechanism: { type: string; handled: boolean } }
  ): unknown;
  flush(): Promise<unknown>;
};

const unhandledHttpError = {
  mechanism: { type: 'auto.http.tanstackstart', handled: false },
} as const;

const needsStreamObservation = (response: Response) =>
  Boolean(
    response.body &&
    !response.headers.has('Content-Length') &&
    !response.headers.has('Content-Encoding') &&
    response.headers.get('Content-Type')?.toLowerCase().includes('text/html')
  );

/** Observe the final response after Start has assigned stream cleanup ownership.
 * Bytes pass through unchanged; no HTML parsing or trace metadata injection.
 */
export const createErrorOnlyFetch =
  (
    fetch: ServerEntry['fetch'],
    reporter: ErrorReporter
  ): ServerEntry['fetch'] =>
  async (...args) => {
    let flushing: Promise<void> | undefined;
    const flush = () =>
      (flushing ??= (async () => {
        try {
          await reporter.flush();
        } catch {
          /* Reporting must not break the response. */
        }
      })());
    let response: Response;
    try {
      response = await fetch(...args);
    } catch (error) {
      reporter.captureException(error, unhandledHttpError);
      await flush();
      throw error;
    }
    const responseBody = response.body;
    if (!responseBody || !needsStreamObservation(response)) {
      await flush();
      return response;
    }
    const reader = responseBody.getReader();
    let canceled = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reader.releaseLock();
    };
    const body = new ReadableStream<Uint8Array>(
      {
        async pull(controller) {
          try {
            const result = await reader.read();
            if (canceled) return;
            if (result.done) {
              release();
              await flush();
              if (!canceled) controller.close();
            } else controller.enqueue(result.value);
          } catch (error) {
            if (canceled) return;
            reporter.captureException(error, unhandledHttpError);
            await flush();
            if (!canceled) controller.error(error);
            release();
          }
        },
        async cancel(reason) {
          canceled = true;
          try {
            if (!released) await reader.cancel(reason);
          } finally {
            release();
            await flush();
          }
        },
      },
      { highWaterMark: 0 }
    );
    return new Response(body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
