import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  RouterProvider,
} from '@tanstack/react-router';
import { beforeEach, expect, test, vi } from 'vitest';
import { render } from 'vitest-browser-react';
import { page, userEvent } from 'vitest/browser';

import {
  handleClientHydrationFailure,
  markInitialHydrationCommitted,
  startClientHydration,
} from '@/composition/start-client-hydration';

const mocks = vi.hoisted(() => ({ report: vi.fn(), recovery: vi.fn() }));
vi.mock('@/composition/hydration-failure', () => ({
  reportHydrationFailure: mocks.report,
  reportRootFailure: mocks.report,
  showClientRecovery: mocks.recovery,
}));

beforeEach(async () => {
  vi.clearAllMocks();
  await startClientHydration({
    document,
    loadHydrationModule: async () => ({ hydrateClient: async () => undefined }),
  });
  markInitialHydrationCommitted(document);
});

const expectRootRecovery = async () => {
  const failure = new Error('root failure after activation');
  handleClientHydrationFailure(document, failure, () => true, 'root');
  expect(mocks.report).toHaveBeenCalledExactlyOnceWith(
    document,
    failure,
    false
  );
  await expect.poll(() => mocks.recovery.mock.calls.length).toBe(1);
};

test('recovers a later root failure after a real TanStack Link navigation', async () => {
  const root = createRootRoute({
    component: () => <Link to="/app">SPA destination</Link>,
  });
  const login = createRoute({ getParentRoute: () => root, path: '/login' });
  const app = createRoute({ getParentRoute: () => root, path: '/app' });
  const router = createRouter({
    routeTree: root.addChildren([login, app]),
    history: createMemoryHistory({ initialEntries: ['/login'] }),
  });
  await router.load();
  render(<RouterProvider router={router} />);
  await page.getByRole('link', { name: 'SPA destination' }).click();
  await expect.poll(() => router.state.location.pathname).toBe('/app');
  await expectRootRecovery();
});

test.each(['button', 'external', 'image'] as const)(
  'recovers after a JS-handled %s form submission',
  async (control) => {
    const submit = vi.fn((event: React.FormEvent<HTMLFormElement>) =>
      event.preventDefault()
    );
    render(
      <>
        <form id="activation-form" onSubmit={submit}>
          {control === 'button' && <button>Submit</button>}
          {control === 'image' && (
            <input
              type="image"
              alt="Submit"
              src="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='30'%3E%3Crect width='80' height='30'/%3E%3C/svg%3E"
            />
          )}
        </form>
        {control === 'external' && (
          <button form="activation-form">Submit</button>
        )}
      </>
    );
    if (control === 'image') await page.getByAltText('Submit').click();
    else await page.getByRole('button', { name: 'Submit' }).click();
    expect(submit).toHaveBeenCalledOnce();
    expect(submit.mock.calls[0]?.[0].nativeEvent.isTrusted).toBe(true);
    await expectRootRecovery();
  }
);

test('does not infer departure from a form rejected by native constraint validation', async () => {
  const submit = vi.fn((event: React.FormEvent<HTMLFormElement>) =>
    event.preventDefault()
  );
  render(
    <form onSubmit={submit}>
      <input required aria-label="Required value" />
      <button>Submit invalid</button>
    </form>
  );
  await page.getByRole('button', { name: 'Submit invalid' }).click();
  expect(submit).not.toHaveBeenCalled();
  await expectRootRecovery();
});

test('does not infer submission when Enter inserts a textarea newline', async () => {
  const submit = vi.fn((event: React.FormEvent<HTMLFormElement>) =>
    event.preventDefault()
  );
  render(
    <form onSubmit={submit}>
      <textarea aria-label="Notes" />
      <button>Submit</button>
    </form>
  );
  await page.getByRole('textbox', { name: 'Notes' }).click();
  await userEvent.keyboard('first{Enter}second');
  expect(submit).not.toHaveBeenCalled();
  expect(page.getByRole('textbox', { name: 'Notes' }).element()).toHaveValue(
    'first\nsecond'
  );
  await expectRootRecovery();
});

test.each(['fragment', 'new-tab', 'download', 'modified'] as const)(
  'recovers after a %s link activation',
  async (kind) => {
    // Cancel external side effects while exercising the real activation pipeline.
    render(
      <a
        href={kind === 'fragment' ? '#recovery-target' : '/login'}
        target={kind === 'new-tab' ? '_blank' : undefined}
        download={kind === 'download' ? 'fixture.txt' : undefined}
        onClick={(event) => event.preventDefault()}
      >
        Activation
      </a>
    );
    await page
      .getByRole('link', { name: 'Activation' })
      .click(kind === 'modified' ? { modifiers: ['Control'] } : undefined);
    await expectRootRecovery();
  }
);
