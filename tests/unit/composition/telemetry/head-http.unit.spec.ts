import { once } from 'node:events';
import {
  createServer,
  request as httpRequest,
  type RequestListener,
} from 'node:http';
import { createRequire } from 'node:module';
import { expect, it, vi } from 'vitest';

import { createErrorOnlyFetch } from '@/composition/telemetry/error-only-fetch';

it('completes HEAD telemetry through srvx without consuming a body', async () => {
  const require = createRequire(
    createRequire(import.meta.url).resolve('nitro/package.json')
  );
  const { toNodeHandler } = (await import(require.resolve('srvx'))) as {
    toNodeHandler: (
      fetch: (request: Request) => Promise<Response>
    ) => RequestListener;
  };
  const cancel = vi.fn();
  const reporter = {
    captureException: vi.fn(),
    flush: vi.fn(async () => undefined),
  };
  const close = vi.fn();
  const fetch = createErrorOnlyFetch(
    async () =>
      new Response(new ReadableStream({ cancel }, { highWaterMark: 0 }), {
        status: 202,
        headers: { 'Content-Type': 'application/json', 'Content-Length': '42' },
      }),
    reporter,
    undefined,
    close
  );
  const server = createServer(
    toNodeHandler(async (request) =>
      fetch(request, { context: { requestId: 'head-http' } })
    )
  );
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('Expected TCP address');
  try {
    const response = await new Promise<import('node:http').IncomingMessage>(
      (resolve, reject) => {
        const request = httpRequest(
          { hostname: '127.0.0.1', port: address.port, method: 'HEAD' },
          resolve
        );
        request.on('error', reject);
        request.end();
      }
    );
    expect(response.statusCode).toBe(202);
    expect(response.headers['content-length']).toBe('42');
    expect(cancel).toHaveBeenCalledOnce();
    expect(reporter.flush).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    response.destroy();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
