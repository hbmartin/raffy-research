import { describe, expect, it, vi } from 'vitest';

import { createErrorOnlyFetch } from '@/composition/telemetry/error-only-fetch';

const request = new Request('https://app.example');
const reporter = () => ({
  captureException: vi.fn(),
  flush: vi.fn(async () => undefined),
});

describe('error-only server entry', () => {
  it('preserves HTML bytes and headers without injecting trace metadata', async () => {
    const report = reporter();
    const html = '<html><head></head><body>hello</body></html>';
    const fetch = createErrorOnlyFetch(
      async () =>
        new Response(html, { status: 201, headers: { 'x-test': 'value' } }),
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

  it('rewraps a known-length response and removes Content-Length', async () => {
    const report = reporter();
    const original = new Response('<html>ready</html>', {
      headers: { 'Content-Length': '18', 'Content-Type': 'text/html' },
    });
    const fetch = createErrorOnlyFetch(async () => original, report);
    const response = await fetch(request, {
      context: { requestId: 'test' },
    });
    expect(response).not.toBe(original);
    expect(response.headers.get('Content-Length')).toBeNull();
    expect(await response.text()).toBe('<html>ready</html>');
    expect(report.flush).toHaveBeenCalledOnce();
  });

  it('observes non-HTML response bodies too', async () => {
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

  it.each(['text/html', 'application/x-ndjson', 'text/event-stream'])(
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
