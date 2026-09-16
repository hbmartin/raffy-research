import { afterEach, describe, expect, it, vi } from 'vitest';

import { hydrateClient } from '@/composition/hydrate-client';

const mocks = vi.hoisted(() => ({
  hydrateStart: vi.fn(),
  hydrateRoot: vi.fn(),
}));
vi.mock('@tanstack/start-client-core/client', () => ({
  hydrateStart: mocks.hydrateStart,
}));
vi.mock('react-dom/client', () => ({ hydrateRoot: mocks.hydrateRoot }));
vi.mock('@tanstack/react-router', () => ({ RouterProvider: () => null }));
afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

const fixture = () => {
  const document = {} as Document;
  const bootstrap = { h: vi.fn() };
  const view = { document, $_TSR: bootstrap };
  Object.assign(document, { defaultView: view });
  vi.stubGlobal('window', view);
  const loading = Promise.withResolvers<unknown>();
  mocks.hydrateStart.mockReturnValue(loading.promise);
  return { document, bootstrap, view, loading };
};

describe('client hydration cleanup ownership', () => {
  it('signals and renders the current document after its route imports finish', async () => {
    const { document, bootstrap, loading } = fixture();
    const hydration = hydrateClient(document);
    expect(bootstrap.h).not.toHaveBeenCalled();
    expect(mocks.hydrateRoot).not.toHaveBeenCalled();
    loading.resolve({});
    await hydration;
    expect(bootstrap.h).toHaveBeenCalledTimes(1);
    expect(mocks.hydrateRoot).toHaveBeenCalledWith(document, expect.anything());
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
