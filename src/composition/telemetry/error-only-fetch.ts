import type { ServerEntry } from '@tanstack/react-start/server-entry';

type ErrorReporter = {
  captureException(
    error: unknown,
    context?: { mechanism: { type: string; handled: boolean } }
  ): unknown;
  flush(): Promise<unknown>;
};

type RunInRequestContext = <T>(fn: () => T) => T;

const needsStreamObservation = (response: Response) => {
  if (
    !response.body ||
    response.headers.has('Content-Length') ||
    response.headers.has('Content-Encoding')
  )
    return false;

  const contentType = response.headers
    .get('Content-Type')
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  return (
    contentType === 'text/html' ||
    contentType === 'application/xhtml+xml' ||
    contentType === 'text/event-stream' ||
    contentType === 'application/x-ndjson'
  );
};

const unhandledHttpError = {
  mechanism: { type: 'auto.http.tanstackstart', handled: false },
} as const;

/** Observe the final response after Start has assigned stream cleanup ownership.
 * Bytes pass through unchanged; no HTML parsing or trace metadata injection.
 */
export const createErrorOnlyFetch =
  (
    fetch: ServerEntry['fetch'],
    reporter: ErrorReporter,
    captureRequestContext?: () => RunInRequestContext
  ): ServerEntry['fetch'] =>
  async (...args) => {
    const runInRequestContext =
      captureRequestContext?.() ?? (<T>(fn: () => T): T => fn());
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
    let reader: ReadableStreamDefaultReader<Uint8Array>;
    try {
      reader = responseBody.getReader();
    } catch (error) {
      reporter.captureException(error, unhandledHttpError);
      await flush();
      throw error;
    }
    let canceled = false;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      reader.releaseLock();
    };
    const body = new ReadableStream<Uint8Array>(
      {
        pull(controller) {
          return runInRequestContext(async () => {
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
          });
        },
        cancel(reason) {
          return runInRequestContext(async () => {
            canceled = true;
            try {
              if (!released) await reader.cancel(reason);
            } finally {
              release();
              await flush();
            }
          });
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
