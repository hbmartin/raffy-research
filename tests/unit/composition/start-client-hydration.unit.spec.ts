import { afterEach, describe, expect, it, vi } from 'vitest';

import { startClientHydration } from '@/composition/start-client-hydration';

const mocks = vi.hoisted(() => ({
  reportHydrationFailure: vi.fn(),
}));

vi.mock('@/composition/hydration-failure', () => ({
  reportHydrationFailure: mocks.reportHydrationFailure,
}));

const fixture = () => {
  const document = {} as Document;
  const view = new EventTarget() as EventTarget & { document: Document };
  view.document = document;
  Object.assign(document, { defaultView: view });
  return { document, view };
};

afterEach(() => {
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

  it.each(['beforeunload', 'pagehide'])(
    'suppresses a delayed chunk failure after %s',
    async (eventName) => {
      const { document, view } = fixture();
      const loading = Promise.withResolvers<never>();
      const hydration = startClientHydration({
        document,
        loadHydrationModule: () => loading.promise,
      });

      view.dispatchEvent(new Event(eventName));
      loading.reject(new Error('navigation canceled the chunk'));
      await hydration;

      expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    }
  );

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
});
