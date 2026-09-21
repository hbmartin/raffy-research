import { QueryClient, useSuspenseQuery } from '@tanstack/react-query';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  Scripts,
} from '@tanstack/react-router';
import type { AnyRouter } from '@tanstack/react-router';
import {
  createRequestHandler,
  defaultStreamHandler,
  transformReadableStreamWithRouter,
} from '@tanstack/react-router/ssr/server';
import { setupRouterSsrQueryIntegration } from '@tanstack/react-router-ssr-query';
import { createElement as h, Suspense } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { createErrorOnlyFetch } from '@/composition/telemetry/error-only-fetch';
import { applySecurityHeaders } from '@/platform/http/security-headers';

describe('query SSR response lifecycle', () => {
  it.each([
    [0, 0],
    [0, 50],
    [30, 0],
  ])(
    'finishes query serialization and cleanup with %s ms query and %s ms dehydration',
    async (delay, dehydrationDelay) => {
      const client = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      const query = {
        queryKey: ['lifecycle'],
        queryFn: () =>
          new Promise<string>((resolve) =>
            setTimeout(() => resolve('query-completed'), delay)
          ),
      };
      function Content() {
        return h('main', null, useSuspenseQuery(query).data);
      }
      const root = createRootRoute({
        component: () =>
          h(
            'html',
            null,
            h('head'),
            h(
              'body',
              null,
              h(Suspense, { fallback: h('span', null, 'waiting') }, h(Outlet)),
              h(Scripts)
            )
          ),
      });
      const index = createRoute({
        getParentRoute: () => root,
        path: '/',
        loader: () => {
          void client.prefetchQuery(query);
        },
        component: Content,
      });
      const router = createRouter({
        routeTree: root.addChildren([index]),
        ssr: { nonce: 'lifecycle-nonce' },
        dehydrate: async () => {
          await new Promise((resolve) => setTimeout(resolve, dehydrationDelay));
          return {};
        },
      });
      setupRouterSsrQueryIntegration({ router, queryClient: client });
      const cleanup = vi.fn();
      const request = new Request('http://localhost/', {
        headers: { 'User-Agent': 'Mozilla/5.0' },
        signal: AbortSignal.timeout(2_000),
      });
      const fetch = createErrorOnlyFetch(
        async () => {
          const response = await createRequestHandler({
            request,
            createRouter: () => router,
          })(async (context) => {
            context.router.serverSsr!.onCleanup(cleanup);
            return defaultStreamHandler(context);
          });
          return applySecurityHeaders(response, {
            isProduction: true,
            cspNonce: 'lifecycle-nonce',
          });
        },
        { captureException: vi.fn(), flush: async () => undefined }
      );
      try {
        const response = await fetch(request, {
          context: { requestId: 'lifecycle' },
        });
        const html = await response.text();
        expect(html).toContain('query-completed');
        expect(html).toContain('</html>');
        expect(html).not.toContain('Serialization timeout');
        expect(cleanup).toHaveBeenCalledTimes(1);
      } finally {
        client.clear();
      }
    }
  );

  it('closes and cleans up a reserved fast-path stream', async () => {
    const cleanup = vi.fn();
    const renderFinished = vi.fn();
    const serverSsr = {
      reserveStreamFastPath: () => true,
      onInjectedHtml: () => () => undefined,
      setRenderFinished: renderFinished,
      cleanup,
    };
    const appStream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('<html>fast</html>'));
        controller.close();
      },
    });
    const transformed = transformReadableStreamWithRouter(
      { serverSsr } as unknown as AnyRouter,
      appStream as unknown as Parameters<
        typeof transformReadableStreamWithRouter
      >[1]
    );
    const fetch = createErrorOnlyFetch(
      async () =>
        new Response(transformed as unknown as BodyInit, {
          headers: { 'Content-Type': 'text/html' },
        }),
      { captureException: vi.fn(), flush: async () => undefined }
    );
    expect(
      await (
        await fetch(new Request('http://localhost/'), {
          context: { requestId: 'fast' },
        })
      ).text()
    ).toBe('<html>fast</html>');
    expect(renderFinished).toHaveBeenCalledTimes(1);
    expect(cleanup).toHaveBeenCalledTimes(1);
  });
});
