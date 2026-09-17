import { afterEach, describe, expect, it, vi } from 'vitest';

import { hydrateClient } from '@/composition/hydrate-client';
import { startClientHydration } from '@/composition/start-client-hydration';
import { captureStartHydrationOwner } from '@/composition/start-hydration-compat';

const mocks = vi.hoisted(() => ({
  hydrateStart: vi.fn(),
  hydrateRoot: vi.fn(),
  reportHydrationFailure: vi.fn(),
}));
vi.mock('@tanstack/start-client-core/client', () => ({
  hydrateStart: mocks.hydrateStart,
}));
vi.mock('react-dom/client', () => ({ hydrateRoot: mocks.hydrateRoot }));
vi.mock('@tanstack/react-router', () => ({ RouterProvider: () => null }));
vi.mock('@/composition/hydration-failure', () => ({
  reportHydrationFailure: mocks.reportHydrationFailure,
}));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const fixture = () => {
  const document = {} as Document;
  const bootstrap = { h: vi.fn() };
  const view = Object.assign(new EventTarget(), {
    document,
    $_TSR: bootstrap,
  }) as EventTarget & {
    document: Document;
    $_TSR: { h: ReturnType<typeof vi.fn> } | undefined;
  };
  Object.assign(document, { defaultView: view });
  vi.stubGlobal('window', view);
  const loading = Promise.withResolvers<unknown>();
  mocks.hydrateStart.mockReturnValue(loading.promise);
  return { document, bootstrap, view, loading };
};

describe('client hydration cleanup ownership', () => {
  it('suppresses a pending route import failure after pagehide', async () => {
    const { document, loading, view } = fixture();
    const hydration = startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient }),
    });
    await vi.waitFor(() => expect(mocks.hydrateStart).toHaveBeenCalledOnce());

    view.dispatchEvent(new Event('pagehide'));
    loading.reject(new Error('navigation canceled the route chunk'));
    await hydration;

    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('reports a route import failure for the current owner', async () => {
    const { document, loading } = fixture();
    const failure = new Error('route chunk failed');
    const hydration = hydrateClient(document);

    loading.reject(failure);
    await hydration;

    expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
      document,
      failure
    );
    expect(mocks.hydrateRoot).not.toHaveBeenCalled();
  });

  it('suppresses a route import failure after ownership changes', async () => {
    const { document, loading } = fixture();
    const hydration = hydrateClient(document);

    captureStartHydrationOwner(document);
    loading.reject(new Error('stale route chunk failed'));
    await hydration;

    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    expect(mocks.hydrateRoot).not.toHaveBeenCalled();
  });

  it('signals and renders the current document after its route imports finish', async () => {
    const { document, bootstrap, loading } = fixture();
    const hydration = hydrateClient(document);
    expect(bootstrap.h).not.toHaveBeenCalled();
    expect(mocks.hydrateRoot).not.toHaveBeenCalled();
    loading.resolve({});
    await hydration;
    expect(bootstrap.h).toHaveBeenCalledTimes(1);
    expect(mocks.hydrateRoot).toHaveBeenCalledWith(
      document,
      expect.anything(),
      expect.objectContaining({ onUncaughtError: expect.any(Function) })
    );
  });

  it('reports an uncaught root error after normal bootstrap cleanup', async () => {
    const { document, bootstrap, view, loading } = fixture();
    bootstrap.h.mockImplementation(() => {
      view.$_TSR = undefined;
    });
    const hydration = hydrateClient(document);
    loading.resolve({});
    await hydration;

    const options = mocks.hydrateRoot.mock.calls[0]?.[2] as {
      onUncaughtError: (error: unknown) => void;
    };
    const failure = new Error('root render failed');
    options.onUncaughtError(failure);

    expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
      document,
      failure
    );
  });

  it('does not report a root error after the bootstrap owner is replaced', async () => {
    const { document, view, loading } = fixture();
    const hydration = hydrateClient(document);
    loading.resolve({});
    await hydration;
    const options = mocks.hydrateRoot.mock.calls[0]?.[2] as {
      onUncaughtError: (error: unknown) => void;
    };

    view.$_TSR = { h: vi.fn() };
    options.onUncaughtError(new Error('stale root failed'));

    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('does not report a root error after a newer owner claims the document', async () => {
    const { document, loading } = fixture();
    const hydration = hydrateClient(document);
    loading.resolve({});
    await hydration;
    const options = mocks.hydrateRoot.mock.calls[0]?.[2] as {
      onUncaughtError: (error: unknown) => void;
    };

    captureStartHydrationOwner(document);
    options.onUncaughtError(new Error('superseded root failed'));

    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('does not report a root error after the document is replaced', async () => {
    const { document, view, loading } = fixture();
    const hydration = hydrateClient(document);
    loading.resolve({});
    await hydration;
    const options = mocks.hydrateRoot.mock.calls[0]?.[2] as {
      onUncaughtError: (error: unknown) => void;
    };

    view.document = {} as Document;
    options.onUncaughtError(new Error('old document failed'));

    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('does not render or clear bootstrap data after a hard reload', async () => {
    const { document, bootstrap, view, loading } = fixture();
    const hydration = hydrateClient(document);
    view.document = {} as Document;
    view.$_TSR = { h: vi.fn() };
    loading.resolve({});
    await hydration;
    expect(bootstrap.h).not.toHaveBeenCalled();
    expect(view.$_TSR.h).not.toHaveBeenCalled();
    expect(mocks.hydrateRoot).not.toHaveBeenCalled();
  });

  it('does not signal replacement bootstrap state through a reused window', async () => {
    const { document, bootstrap, view, loading } = fixture();
    const hydration = hydrateClient(document);
    view.$_TSR = { h: vi.fn() };
    loading.resolve({});
    await hydration;
    expect(bootstrap.h).not.toHaveBeenCalled();
    expect(view.$_TSR.h).not.toHaveBeenCalled();
    expect(mocks.hydrateRoot).not.toHaveBeenCalled();
  });
});
