import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  handleClientHydrationFailure,
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

const fixture = (visibilityState: DocumentVisibilityState = 'visible') => {
  const document = new EventTarget() as Document;
  const view = new EventTarget() as EventTarget & {
    document: Document;
    location: { reload: ReturnType<typeof vi.fn> };
  };
  view.document = document;
  view.location = { reload: vi.fn() };
  Object.assign(document, {
    defaultView: view,
    visibilityState,
    URL: 'https://example.test/current',
    baseURI: 'https://example.test/current',
  });
  return { document, view };
};

const trustedInteraction = (type: 'click' | 'keydown' | 'keyup') => {
  const event = new Event(type, { cancelable: true });
  Object.defineProperty(event, 'isTrusted', { value: true });
  return event;
};
const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

const linkClick = (
  attributes: Record<string, string | undefined> = { href: '/destination' },
  mouse: Partial<MouseEvent> = {}
) => {
  const event = trustedInteraction('click');
  const link = {
    getAttribute: (key: string) => attributes[key] ?? null,
    hasAttribute: (key: string) => Object.hasOwn(attributes, key),
  };
  Object.defineProperties(event, {
    target: { value: { nodeType: 1, closest: () => link } },
    button: { value: mouse.button ?? 0 },
    metaKey: { value: mouse.metaKey },
    ctrlKey: { value: mouse.ctrlKey },
    shiftKey: { value: mouse.shiftKey },
    altKey: { value: mouse.altKey },
  });
  return event;
};

afterEach(async () => {
  if (vi.isFakeTimers()) await vi.runOnlyPendingTimersAsync();
  else await nextTask();
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('initial hydration coordinator', () => {
  it('reports an active-document chunk failure without waiting for interaction', async () => {
    vi.useFakeTimers();
    const { document } = fixture();
    const failure = new Error('chunk failed');

    await startClientHydration({
      document,
      loadHydrationModule: async () => {
        throw failure;
      },
    });

    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
      document,
      failure,
      false
    );
    await vi.runAllTimersAsync();
    expect(mocks.showClientRecovery).toHaveBeenCalledWith(
      document,
      'client.hydration_failed'
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

  it('reports a genuine hydration rejection immediately', async () => {
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
      failure,
      false
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
    await hydration;
    expect(hydrateClient).toHaveBeenCalledWith(document);
  });

  it('reports an import failure after a canceled beforeunload', async () => {
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
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    view.dispatchEvent(new Event('blur'));
    view.dispatchEvent(new Event('focus'));
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
      document,
      expect.any(Error),
      false
    );
    await vi.runAllTimersAsync();
    expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
  });

  it('reports a chunk that fails after focus returns from a canceled navigation', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    const loading = Promise.withResolvers<never>();
    const hydration = startClientHydration({
      document,
      loadHydrationModule: () => loading.promise,
    });
    view.dispatchEvent(new Event('beforeunload'));
    view.dispatchEvent(new Event('blur'));
    view.dispatchEvent(new Event('focus'));
    loading.reject(new Error('canceled navigation chunk'));
    await hydration;
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
      document,
      expect.any(Error),
      false
    );
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

it('recovers a failed import when a download leaves the original document active', async () => {
  vi.useFakeTimers();
  const { document, view } = fixture();
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  view.dispatchEvent(new Event('beforeunload'));
  view.dispatchEvent(new Event('pagehide'));
  loading.reject(new Error('chunk failed during download'));
  await hydration;

  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  view.dispatchEvent(trustedInteraction('click'));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
  await vi.runAllTimersAsync();
  expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
});

it('recovers an import failure after a provisional document is replaced', async () => {
  vi.useFakeTimers();
  const { document, view } = fixture();
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  view.document = {} as Document;
  loading.reject(new Error('chunk failed during navigation'));
  await hydration;

  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  view.document = document;
  view.dispatchEvent(trustedInteraction('click'));
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
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

it('reports tentative failures when the document returns to visible', async () => {
  vi.useFakeTimers();
  const { document, view } = fixture();
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  view.dispatchEvent(new Event('beforeunload'));
  loading.reject(new Error('request failed'));
  await hydration;
  view.dispatchEvent(new Event('click'));
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  Object.assign(document, { visibilityState: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  Object.assign(document, { visibilityState: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
    document,
    expect.any(Error),
    false
  );
  await vi.runAllTimersAsync();
  expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
});

it('reports an import failure after a hidden document returns', async () => {
  vi.useFakeTimers();
  const { document } = fixture();
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  Object.assign(document, { visibilityState: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  loading.reject(new Error('navigation canceled the chunk'));
  await hydration;
  Object.assign(document, { visibilityState: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
    document,
    expect.any(Error),
    false
  );
  await vi.runAllTimersAsync();
  expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
});

it('retains an import failure across a tab switch', async () => {
  vi.useFakeTimers();
  const { document } = fixture();
  const failure = new Error('failed before switch');
  await startClientHydration({
    document,
    loadHydrationModule: async () => {
      throw failure;
    },
  });
  Object.assign(document, { visibilityState: 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.runAllTimersAsync();
  expect(mocks.showClientRecovery).not.toHaveBeenCalled();
  Object.assign(document, { visibilityState: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.runAllTimersAsync();
  expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
  expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
});

it('requires a trusted click to resume a canceled departure and defers its notice', async () => {
  vi.useFakeTimers();
  const { document, view } = fixture();
  const failure = new Error('failed while leaving');
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  view.dispatchEvent(new Event('beforeunload'));
  loading.reject(failure);
  await hydration;
  view.dispatchEvent(new Event('click'));
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  view.dispatchEvent(trustedInteraction('click'));
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(2_000);
  expect(mocks.reportHydrationFailure).toHaveBeenCalledWith(
    document,
    failure,
    false
  );
  await vi.runAllTimersAsync();
  expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
});

it('keeps an existing import timer suppressed during a long departure', async () => {
  vi.useFakeTimers();
  const { document, view } = fixture();
  await startClientHydration({
    document,
    loadHydrationModule: async () => {
      throw new Error('chunk failed');
    },
  });
  view.dispatchEvent(new Event('beforeunload'));
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  expect(mocks.showClientRecovery).not.toHaveBeenCalled();
  view.dispatchEvent(trustedInteraction('click'));
  await vi.runAllTimersAsync();
  expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
  expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
});

it('recovers a document initially loaded hidden on its first tab return', async () => {
  vi.useFakeTimers();
  const { document } = fixture('hidden');
  await startClientHydration({
    document,
    loadHydrationModule: async () => {
      throw new Error('background chunk');
    },
  });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  Object.assign(document, { visibilityState: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  await vi.runAllTimersAsync();
  expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
  expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
});

it('ignores incidental focus and navigation activation keyup', async () => {
  vi.useFakeTimers();
  const { document, view } = fixture();
  const loading = Promise.withResolvers<never>();
  const hydration = startClientHydration({
    document,
    loadHydrationModule: () => loading.promise,
  });
  view.dispatchEvent(new Event('beforeunload'));
  loading.reject(new Error('departing import'));
  await hydration;
  view.dispatchEvent(new Event('focus'));
  view.dispatchEvent(trustedInteraction('keyup'));
  view.dispatchEvent(
    Object.assign(trustedInteraction('keydown'), { key: 'Enter' })
  );
  await vi.runAllTimersAsync();
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  view.dispatchEvent(
    Object.assign(trustedInteraction('keydown'), { key: 'Tab' })
  );
  await vi.runAllTimersAsync();
  expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
});

it('does not clear a new departure after an eligible interaction', async () => {
  vi.useFakeTimers();
  const { document, view } = fixture();
  await startClientHydration({
    document,
    loadHydrationModule: async () => {
      throw new Error('chunk');
    },
  });
  view.dispatchEvent(trustedInteraction('click'));
  view.dispatchEvent(new Event('beforeunload'));
  await vi.runAllTimersAsync();
  expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
});

describe('recovery settlement and provisional activation', () => {
  it.each([
    { name: 'fragment', attributes: { href: '#section' }, mouse: {} },
    { name: 'empty fragment', attributes: { href: '/current#' }, mouse: {} },
    {
      name: 'absolute fragment',
      attributes: { href: 'https://example.test/current#section' },
      mouse: {},
    },
    {
      name: 'new tab',
      attributes: { href: '/destination', target: '_blank' },
      mouse: {},
    },
    {
      name: 'named other window',
      attributes: { href: '/destination', target: 'other' },
      mouse: {},
    },
    {
      name: 'download',
      attributes: { href: '/destination', download: '' },
      mouse: {},
    },
    { name: 'script', attributes: { href: 'javascript:void(0)' }, mouse: {} },
    {
      name: 'email',
      attributes: { href: 'mailto:user@example.test' },
      mouse: {},
    },
    { name: 'telephone', attributes: { href: 'tel:123' }, mouse: {} },
    {
      name: 'control click',
      attributes: { href: '/destination' },
      mouse: { ctrlKey: true },
    },
    {
      name: 'meta click',
      attributes: { href: '/destination' },
      mouse: { metaKey: true },
    },
    {
      name: 'shift click',
      attributes: { href: '/destination' },
      mouse: { shiftKey: true },
    },
    {
      name: 'alt click',
      attributes: { href: '/destination' },
      mouse: { altKey: true },
    },
    {
      name: 'middle click',
      attributes: { href: '/destination' },
      mouse: { button: 1 },
    },
  ])(
    'does not guard an unprevented $name activation',
    async ({ attributes, mouse }) => {
      vi.useFakeTimers();
      const { document, view } = fixture();
      await startClientHydration({
        document,
        loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
      });
      view.dispatchEvent(linkClick(attributes, mouse));
      handleClientHydrationFailure(
        document,
        new Error('application failure'),
        () => true,
        'hydrate_start'
      );
      await vi.runAllTimersAsync();
      expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
    }
  );

  it('resolves a base target before marking a link departure', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    Object.assign(document, {
      querySelector: () => ({ getAttribute: () => '_blank' }),
    });
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
    });
    view.dispatchEvent(linkClick());
    handleClientHydrationFailure(
      document,
      new Error('application failure'),
      () => true,
      'hydrate_start'
    );
    await vi.runAllTimersAsync();
    expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
  });

  it('guards a fragment resolved against a base URL in a different document', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    Object.assign(document, { baseURI: 'https://example.test/other' });
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
    });
    view.dispatchEvent(linkClick({ href: '#section' }));
    handleClientHydrationFailure(document, new Error('chunk'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('rechecks the final link target after event handlers run', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    const attributes = { href: '/destination', target: '_self' };
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
    });
    view.addEventListener('click', () => {
      attributes.target = '_blank';
    });
    view.dispatchEvent(linkClick(attributes));
    handleClientHydrationFailure(
      document,
      new Error('application failure'),
      () => true,
      'hydrate_start'
    );
    await vi.runAllTimersAsync();
    expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
  });

  it('restores recovery after a prevented native link activation', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
    });
    view.addEventListener('click', (event) => {
      handleClientHydrationFailure(document, new Error('chunk'));
      event.preventDefault();
    });
    view.dispatchEvent(linkClick());
    await vi.runAllTimersAsync();
    expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
    expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
  });

  it('does not undo a newer departure when a link is prevented', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
    });
    view.addEventListener('click', (event) => {
      event.preventDefault();
      view.dispatchEvent(new Event('beforeunload'));
      handleClientHydrationFailure(document, new Error('canceled request'));
    });
    view.dispatchEvent(linkClick());
    await vi.runAllTimersAsync();
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('retains an earlier departure after a prevented link', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
    });
    view.dispatchEvent(new Event('beforeunload'));
    handleClientHydrationFailure(document, new Error('chunk'));
    view.addEventListener('click', (event) => event.preventDefault());
    view.dispatchEvent(linkClick());
    await vi.runAllTimersAsync();
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('keeps unprevented document navigation guarded beyond the settlement delay', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
    });
    view.dispatchEvent(linkClick());
    handleClientHydrationFailure(document, new Error('chunk'));
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
  });

  it('keeps recovery timer-free during healthy ordinary input', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    await startClientHydration({
      document,
      loadHydrationModule: async () => ({ hydrateClient: vi.fn() }),
    });
    for (let count = 0; count < 20; count += 1) {
      view.dispatchEvent(trustedInteraction('click'));
      view.dispatchEvent(
        Object.assign(trustedInteraction('keydown'), { key: 'a' })
      );
    }
    expect(vi.getTimerCount()).toBe(0);
  });

  it('recovers despite a backward wall-clock adjustment', async () => {
    vi.useFakeTimers();
    const { document } = fixture();
    handleClientHydrationFailure(document, new Error('chunk'));
    vi.setSystemTime(Date.now() - 60_000);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    expect(mocks.showClientRecovery).toHaveBeenCalledOnce();
  });

  it('rearms when the monotonic deadline has not elapsed at the timer callback', async () => {
    vi.useFakeTimers();
    const { document } = fixture();
    const now = vi.fn(() => 0);
    Object.assign(document.defaultView!, { performance: { now } });
    handleClientHydrationFailure(document, new Error('chunk'));
    now.mockReturnValue(1_999);
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    now.mockReturnValue(2_000);
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
  });

  it('coalesces return signals and does not postpone recovery while typing', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    handleClientHydrationFailure(document, new Error('chunk'));
    view.dispatchEvent(new Event('beforeunload'));
    view.dispatchEvent(new Event('blur'));
    view.dispatchEvent(new Event('focus'));
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    Object.assign(document, { visibilityState: 'hidden' });
    document.dispatchEvent(new Event('visibilitychange'));
    Object.assign(document, { visibilityState: 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(vi.getTimerCount()).toBe(1);
    view.dispatchEvent(
      Object.assign(trustedInteraction('keydown'), { key: 'a' })
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
    await vi.runAllTimersAsync();
    vi.clearAllMocks();
    handleClientHydrationFailure(document, new Error('another chunk'));
    for (let count = 0; count < 4; count += 1) {
      view.dispatchEvent(
        Object.assign(trustedInteraction('keydown'), { key: 'a' })
      );
      await vi.advanceTimersByTimeAsync(500);
    }
    expect(mocks.reportHydrationFailure).toHaveBeenCalledOnce();
  });

  it('invalidates an automatic return when departure starts again', async () => {
    vi.useFakeTimers();
    const { document, view } = fixture();
    handleClientHydrationFailure(document, new Error('chunk'));
    view.dispatchEvent(new Event('blur'));
    view.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(1_000);
    view.dispatchEvent(new Event('beforeunload'));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(mocks.reportHydrationFailure).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
