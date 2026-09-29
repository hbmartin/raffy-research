import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  isInitialHydrationDocumentActive,
  markInitialHydrationCommitted,
  startClientHydration,
} from '@/composition/start-client-hydration';

const mocks = vi.hoisted(() => ({
  reportHydrationFailure: vi.fn(),
  showClientRecovery: vi.fn(),
}));

vi.mock('@/composition/hydration-failure', () => ({
  reportHydrationFailure: mocks.reportHydrationFailure,
  showClientRecovery: mocks.showClientRecovery,
}));

const fixture = () => {
  const document = new EventTarget() as Document;
  const view = new EventTarget() as EventTarget & {
    document: Document;
    location: { reload: ReturnType<typeof vi.fn> };
  };
  view.document = document;
  view.location = { reload: vi.fn() };
  Object.assign(document, { defaultView: view });
  return { document, view };
};

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('initial hydration coordinator', () => {
  it('reports an active-document chunk failure', async () => {
    const { document } = fixture();
    const failure = new Error('chunk failed');

    await startClientHydration({
      document,
      loadHydrationModule: async () => {
        throw failure;
      },
    });

    expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
      document,
      failure
    );
  });

  it('suppresses a delayed chunk failure after pagehide', async () => {
    const { document, view } = fixture();
    const loading = Promise.withResolvers<never>();
    const hydration = startClientHydration({
      document,
      loadHydrationModule: () => loading.promise,
    });

    view.dispatchEvent(new Event('pagehide'));
    loading.reject(new Error('navigation canceled the chunk'));
    await hydration;

    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('reloads an uncommitted document restored from bfcache', async () => {
    const { document, view } = fixture();
    const loading = Promise.withResolvers<{
      hydrateClient: (document: Document) => Promise<void>;
    }>();
    const hydration = startClientHydration({
      document,
      loadHydrationModule: () => loading.promise,
    });

    view.dispatchEvent(new Event('pagehide'));
    expect(isInitialHydrationDocumentActive(document)).toBe(false);
    view.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true })
    );
    expect(isInitialHydrationDocumentActive(document)).toBe(false);
    expect(view.location.reload).toHaveBeenCalledOnce();
    view.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true })
    );
    expect(view.location.reload).toHaveBeenCalledOnce();
    view.document = {} as Document;
    loading.resolve({ hydrateClient: vi.fn(async () => undefined) });
    await hydration;
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('does not hydrate or report after the document is replaced', async () => {
    const { document, view } = fixture();
    const loading = Promise.withResolvers<{
      hydrateClient: (document: Document) => Promise<void>;
    }>();
    const hydrateClient = vi.fn(async (_document: Document) => undefined);
    const hydration = startClientHydration({
      document,
      loadHydrationModule: () => loading.promise,
    });

    view.document = {} as Document;
    loading.resolve({ hydrateClient });
    await hydration;

    expect(hydrateClient).not.toHaveBeenCalled();
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('reports a genuine hydration rejection for the active document', async () => {
    const { document } = fixture();
    const failure = new Error('hydration failed');

    await startClientHydration({
      document,
      loadHydrationModule: async () => ({
        hydrateClient: vi.fn(async () => {
          throw failure;
        }),
      }),
    });

    expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
      document,
      failure
    );
  });

  it('keeps lifecycle listeners when initial hydration work settles', async () => {
    const { document, view } = fixture();

    await startClientHydration({
      document,
      loadHydrationModule: async () => ({
        hydrateClient: vi.fn(async () => undefined),
      }),
    });

    view.dispatchEvent(new Event('pagehide'));
    expect(isInitialHydrationDocumentActive(document)).toBe(false);
    view.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true })
    );
    expect(view.location.reload).toHaveBeenCalledOnce();
  });

  it('hydrates immediately during tentative navigation', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    const hydrateClient = vi.fn(async () => undefined);
    const hydration = startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient }),
    });
    view.dispatchEvent(new Event('beforeunload'));
    await Promise.resolve();
    expect(hydrateClient).toHaveBeenCalledWith(document);
    await hydration;
    expect(hydrateClient).toHaveBeenCalledWith(document);
  });

  it('reports a failure after a canceled beforeunload', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    const loading = Promise.withResolvers<never>();
    const hydration = startClientHydration({
      document,
      loadHydrationModule: () => loading.promise,
    });
    view.dispatchEvent(new Event('beforeunload'));
    loading.reject(new Error('chunk failed'));
    await hydration;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    view.dispatchEvent(new Event('focus'));
    view.dispatchEvent(new Event('focus'));
    expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
  });

  it('keeps a committed document interactive after a cache restore', async () => {
    const { document, view } = fixture();
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({
        hydrateClient: vi.fn(async () => undefined),
      }),
    });
    markInitialHydrationCommitted(document);
    view.dispatchEvent(new Event('beforeunload'));
    expect(isInitialHydrationDocumentActive(document)).toBe(true);
    view.dispatchEvent(new Event('pagehide'));
    expect(isInitialHydrationDocumentActive(document)).toBe(false);
    view.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true })
    );
    expect(isInitialHydrationDocumentActive(document)).toBe(true);
    expect(view.location.reload).not.toHaveBeenCalled();
  });
});

it('discards tentative import failures when departure is confirmed', async () => {
  const { document, view } = fixture();
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  view.dispatchEvent(new Event('beforeunload'));
  loading.reject(new Error('cancelled request'));
  await hydration;
  view.dispatchEvent(new Event('pagehide'));
  view.dispatchEvent(new Event('focus'));
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
});

it('does not flush recovery for a document replaced during tentative departure', async () => {
  const { document, view } = fixture();
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  view.dispatchEvent(new Event('beforeunload'));
  loading.reject(new Error('old request'));
  await hydration;
  view.document = {} as Document;
  view.dispatchEvent(new Event('focus'));
  view.dispatchEvent(Object.assign(new Event('pageshow'), { persisted: true }));
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  expect(view.location.reload).not.toHaveBeenCalled();
});

it('ignores synthetic interaction and resumes on return to visible', async () => {
  const { document, view } = fixture();
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  view.dispatchEvent(new Event('beforeunload'));
  loading.reject(new Error('request failed'));
  await hydration;
  view.dispatchEvent(new Event('pointerdown'));
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  Object.assign(document, { visibilityState: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
});
