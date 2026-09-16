import { page } from '@tests/utils';
import { afterEach, expect, test, vi } from 'vitest';

import { reportHydrationFailure } from '@/composition/hydration-failure';

afterEach(() => {
  document.getElementById('hydration-failure')?.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('reports a root failure and renders the reload control', async () => {
  const fetchMock = vi
    .fn()
    .mockResolvedValue(new Response(null, { status: 202 }));
  const reportError = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('reportError', reportError);

  reportHydrationFailure(document, 'root render failed');

  expect(reportError).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'root render failed' })
  );
  expect(fetchMock).toHaveBeenCalledWith(
    '/api/telemetry/logs',
    expect.objectContaining({
      body: expect.any(String),
      credentials: 'same-origin',
      keepalive: true,
      method: 'POST',
    })
  );
  const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
  expect(JSON.parse(String(request.body))).toMatchObject({
    records: [
      {
        error: 'root render failed',
        event: 'client.hydration_failed',
        level: 'error',
      },
    ],
  });
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('This page could not finish loading');
  await expect
    .element(page.getByRole('button', { name: 'Reload page' }))
    .toHaveAttribute('type', 'button');
});

test('keeps one recovery control when reporting services fail', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('fetch failed')));
  vi.stubGlobal(
    'reportError',
    vi.fn(() => {
      throw new Error('reporting failed');
    })
  );

  reportHydrationFailure(document, new Error('first failure'));
  reportHydrationFailure(document, new Error('second failure'));

  expect(document.querySelectorAll('#hydration-failure')).toHaveLength(1);
  await expect.element(page.getByRole('alert')).toBeVisible();
  await expect
    .element(page.getByRole('button', { name: 'Reload page' }))
    .toBeVisible();
});
