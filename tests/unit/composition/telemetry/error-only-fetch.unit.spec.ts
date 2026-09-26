import { describe, expect, it, vi } from 'vitest';

import { createErrorOnlyFetch } from '@/composition/telemetry/error-only-fetch';
import { createServerTelemetryUserContext } from '@/composition/telemetry/otel.server';

const request = new Request('https://app.example');
const reporter = () => ({
  captureException: vi.fn(),
  flush: vi.fn(async () => undefined),
});

describe('error-only server entry', () => {
  it.each([false, true])(
    'finishes an unconsumed HEAD body even when flush rejects: %s',
    async (rejectFlush) => {
      const report = reporter();
      if (rejectFlush)
        report.flush.mockRejectedValue(new Error('collector unavailable'));
      const close = vi.fn();
      const cancel = vi.fn();
      const pull = vi.fn();
      const fetch = createErrorOnlyFetch(
        async () =>
          new Response(
            new ReadableStream({ pull, cancel }, { highWaterMark: 0 }),
            {
              status: 202,
              headers: {
                'Content-Type': 'application/json',
                'Content-Length': '42',
                'x-test': 'preserved',
              },
            }
          ),
        report,
        undefined,
        close
      );
      const response = await fetch(
        new Request('https://app.example', { method: 'HEAD' }),
        { context: { requestId: 'head-test' } }
      );
      expect(response.body).toBeNull();
      expect(response.status).toBe(202);
      expect(response.headers.get('Content-Length')).toBe('42');
      expect(response.headers.get('x-test')).toBe('preserved');
      expect(pull).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(report.flush).toHaveBeenCalledOnce();
      expect(close).toHaveBeenCalledOnce();
    }
  );

  it('flushes HEAD cancellation failures without changing the HTTP response', async () => {
    const report = reporter();
    const close = vi.fn();
    const error = new Error('cancel failed');
    const fetch = createErrorOnlyFetch(
      async () =>
        new Response(
          new ReadableStream({
            cancel() {
              throw error;
            },
          })
        ),
      report,
      undefined,
      close
    );
    const response = await fetch(
      new Request('https://app.example', { method: 'HEAD' }),
      { context: { requestId: 'head-test' } }
    );
    expect(response.body).toBeNull();
    expect(report.captureException).toHaveBeenCalledWith(
      error,
      expect.anything()
    );
    expect(report.flush).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });
  it('preserves HTML bytes and headers without injecting trace metadata', async () => {
    const report = reporter();
    const html = '<html><head></head><body>hello</body></html>';
    const fetch = createErrorOnlyFetch(
      async () =>
        new Response(html, {
          status: 201,
          headers: { 'Content-Type': 'text/html', 'x-test': 'value' },
        }),
      report
    );
    const result = await fetch(request, { context: { requestId: 'test' } });
    expect(report.flush).not.toHaveBeenCalled();
    expect(await result.text()).toBe(html);
    expect(result.status).toBe(201);
    expect(result.headers.get('x-test')).toBe('value');
    expect(report.flush).toHaveBeenCalledTimes(1);
    expect(report.captureException).not.toHaveBeenCalled();
  });

  it('returns a known-length response unchanged and preserves Content-Length', async () => {
    const report = reporter();
    const original = new Response('<html>ready</html>', {
      headers: { 'Content-Length': '18', 'Content-Type': 'text/html' },
    });
    const fetch = createErrorOnlyFetch(async () => original, report);
    const response = await fetch(request, {
      context: { requestId: 'test' },
    });
    expect(response).toBe(original);
    expect(response.headers.get('Content-Length')).toBe('18');
    expect(report.flush).toHaveBeenCalledOnce();
    expect(await response.text()).toBe('<html>ready</html>');
    expect(report.flush).toHaveBeenCalledOnce();
  });

  it('observes unknown-length JSON responses', async () => {
    const report = reporter();
    const original = new Response(JSON.stringify({ ready: true }), {
      headers: { 'Content-Type': 'application/json' },
    });
    const fetch = createErrorOnlyFetch(async () => original, report);
    const response = await fetch(request, {
      context: { requestId: 'test' },
    });
    expect(response).not.toBe(original);
    expect(report.flush).not.toHaveBeenCalled();
    await expect(response.json()).resolves.toEqual({ ready: true });
    expect(report.flush).toHaveBeenCalledOnce();
  });

  it('preserves encoded response bytes and headers', async () => {
    const report = reporter();
    const original = new Response('compressed', {
      headers: {
        'Content-Type': 'text/html',
        'Content-Encoding': 'gzip',
      },
    });
    const fetch = createErrorOnlyFetch(async () => original, report);
    const response = await fetch(request, { context: { requestId: 'test' } });
    expect(response).not.toBe(original);
    expect(response.headers.get('Content-Encoding')).toBe('gzip');
    expect(await response.text()).toBe('compressed');
    expect(report.flush).toHaveBeenCalledOnce();
  });

  it('captures and flushes when the returned body is already locked', async () => {
    const report = reporter();
    const original = new Response(new ReadableStream(), {
      headers: { 'Content-Type': 'text/html' },
    });
    const upstreamReader = original.body!.getReader();
    const fetch = createErrorOnlyFetch(async () => original, report);

    const response = fetch(request, { context: { requestId: 'test' } });

    await expect(response).rejects.toBeInstanceOf(TypeError);
    expect(report.captureException).toHaveBeenCalledWith(
      expect.any(TypeError),
      {
        mechanism: { type: 'auto.http.tanstackstart', handled: false },
      }
    );
    expect(report.flush).toHaveBeenCalledOnce();
    upstreamReader.releaseLock();
  });

  it('captures handler exceptions and flushes before rethrowing', async () => {
    const report = reporter();
    const failure = new Error('handler failure');
    const fetch = createErrorOnlyFetch(async () => {
      throw failure;
    }, report);
    await expect(
      fetch(request, { context: { requestId: 'test' } })
    ).rejects.toBe(failure);
    expect(report.captureException).toHaveBeenCalledWith(failure, {
      mechanism: { type: 'auto.http.tanstackstart', handled: false },
    });
    expect(report.flush).toHaveBeenCalledTimes(1);
  });

  it('keeps interleaved stream failures in their mutable request user contexts', async () => {
    const users = createServerTelemetryUserContext();
    const captured: Array<{ failure: string; user: string | null }> = [];
    const flushed: Array<string | null> = [];
    const fetch = createErrorOnlyFetch(
      async (request) => {
        const id = new URL(request.url).pathname.slice(1);
        users.setUser({ id });
        return new Response(
          new ReadableStream({
            pull(controller) {
              controller.error(new Error(id));
            },
          }),
          { headers: { 'Content-Type': 'text/html' } }
        );
      },
      {
        captureException(error) {
          captured.push({
            failure: (error as Error).message,
            user: users.getUser()?.id ?? null,
          });
        },
        async flush() {
          flushed.push(users.getUser()?.id ?? null);
        },
      },
      users.capture,
      users.close
    );
    const [first, second] = await Promise.all([
      users.run(() =>
        fetch(new Request('https://app.example/first'), {
          context: { requestId: 'first' },
        })
      ),
      users.run(() =>
        fetch(new Request('https://app.example/second'), {
          context: { requestId: 'second' },
        })
      ),
    ]);

    expect(users.getUser()).toBeNull();
    await expect(second.text()).rejects.toThrow('second');
    await expect(first.text()).rejects.toThrow('first');
    expect(captured).toEqual([
      { failure: 'second', user: 'second' },
      { failure: 'first', user: 'first' },
    ]);
    expect(flushed).toEqual(['second', 'first']);
    expect(users.getUser()).toBeNull();
  });

  it.each([
    'text/html',
    'application/x-ndjson',
    'text/event-stream',
    'application/x-tss-framed; v=1',
    'application/octet-stream',
  ])(
    'captures a delayed %s stream error without swallowing it',
    async (contentType) => {
      const report = reporter();
      const failure = new Error('stream failure');
      const stream = new ReadableStream({
        pull(controller) {
          controller.error(failure);
        },
      });
      const fetch = createErrorOnlyFetch(
        async () =>
          new Response(stream, {
            headers: { 'Content-Type': contentType },
          }),
        report
      );
      const response = await fetch(request, { context: { requestId: 'test' } });
      expect(report.flush).not.toHaveBeenCalled();
      await expect(response.text()).rejects.toBe(failure);
      expect(report.captureException).toHaveBeenCalledWith(failure, {
        mechanism: { type: 'auto.http.tanstackstart', handled: false },
      });
      expect(report.flush).toHaveBeenCalledTimes(1);
    }
  );

  it('takes a context snapshot only for an observed body', async () => {
    const capture = vi.fn(
      () =>
        <T>(fn: () => T) =>
          fn()
    );
    const fetch = createErrorOnlyFetch(
      async () => new Response('known', { headers: { 'Content-Length': '5' } }),
      reporter(),
      capture
    );
    await fetch(request, { context: { requestId: 'test' } });
    expect(capture).not.toHaveBeenCalled();
  });

  it('clears user context after a known-length response', async () => {
    const users = createServerTelemetryUserContext();
    let deferredRead: (() => string | null) | undefined;
    const fetch = createErrorOnlyFetch(
      async () => {
        users.setUser({ id: 'request-user' });
        const snapshot = users.capture();
        deferredRead = () => snapshot(() => users.getUser()?.id ?? null);
        return new Response('ready', { headers: { 'Content-Length': '5' } });
      },
      reporter(),
      users.capture,
      users.close
    );
    await users.run(() => fetch(request, { context: { requestId: 'test' } }));
    expect(deferredRead?.()).toBeNull();
  });

  it('propagates cancellation without reporting it as an error', async () => {
    const report = reporter();
    const cancel = vi.fn();
    const fetch = createErrorOnlyFetch(
      async () =>
        new Response(new ReadableStream({ cancel }), {
          headers: { 'Content-Type': 'text/html' },
        }),
      report
    );
    const response = await fetch(request, { context: { requestId: 'test' } });
    const reader = response.body!.getReader();
    const pending = reader.read();
    await reader.cancel('disconnect');
    await pending;
    expect(cancel).toHaveBeenCalledWith('disconnect');
    expect(report.captureException).not.toHaveBeenCalled();
    expect(report.flush).toHaveBeenCalledTimes(1);
  });

  it('clears the captured user when an observed stream is canceled', async () => {
    const users = createServerTelemetryUserContext();
    let deferredRead: (() => string | null) | undefined;
    const fetch = createErrorOnlyFetch(
      async () => {
        users.setUser({ id: 'stream-user' });
        const snapshot = users.capture();
        deferredRead = () => snapshot(() => users.getUser()?.id ?? null);
        return new Response(new ReadableStream(), {
          headers: { 'Content-Type': 'application/x-tss-framed; v=1' },
        });
      },
      reporter(),
      users.capture,
      users.close
    );
    const response = await users.run(() =>
      fetch(request, { context: { requestId: 'test' } })
    );
    expect(deferredRead?.()).toBe('stream-user');
    await response.body!.cancel();
    expect(deferredRead?.()).toBeNull();
  });

  it('allows cancellation after upstream completion while a flush is pending', async () => {
    const report = reporter();
    const started = Promise.withResolvers<void>();
    const flushing = Promise.withResolvers<undefined>();
    report.flush.mockImplementation(() => {
      started.resolve();
      return flushing.promise;
    });
    const fetch = createErrorOnlyFetch(
      async () =>
        new Response(
          new ReadableStream({ start: (controller) => controller.close() }),
          { headers: { 'Content-Type': 'text/html' } }
        ),
      report
    );
    const response = await fetch(request, { context: { requestId: 'test' } });
    const reader = response.body!.getReader();
    const reading = reader.read();
    await started.promise;
    const cancellation = reader.cancel('disconnect');
    flushing.resolve(undefined);
    await expect(cancellation).resolves.toBeUndefined();
    expect((await reading).done).toBe(true);
    expect(report.captureException).not.toHaveBeenCalled();
    expect(report.flush).toHaveBeenCalledTimes(1);
  });

  it('does not drain upstream until the response is consumed', async () => {
    const report = reporter();
    const pull = vi.fn(
      (controller: ReadableStreamDefaultController<Uint8Array>) => {
        controller.enqueue(new Uint8Array([1]));
      }
    );
    const stream = new ReadableStream({ pull }, { highWaterMark: 0 });
    const fetch = createErrorOnlyFetch(
      async () =>
        new Response(stream, { headers: { 'Content-Type': 'text/html' } }),
      report
    );
    const response = await fetch(request, { context: { requestId: 'test' } });
    expect(pull).not.toHaveBeenCalled();
    const reader = response.body!.getReader();
    expect((await reader.read()).value).toEqual(new Uint8Array([1]));
    expect(pull).toHaveBeenCalledTimes(1);
    await reader.cancel();
  });

  it('keeps an empty response usable if flushing fails', async () => {
    const report = reporter();
    report.flush.mockRejectedValue(new Error('offline'));
    const fetch = createErrorOnlyFetch(
      async () => new Response(null, { status: 204 }),
      report
    );
    expect(
      (await fetch(request, { context: { requestId: 'test' } })).status
    ).toBe(204);
  });
});
