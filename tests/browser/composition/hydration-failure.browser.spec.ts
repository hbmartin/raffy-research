import { page } from '@tests/utils';
import { afterEach, expect, test, vi } from 'vitest';

import { reportHydrationFailure } from '@/composition/hydration-failure';

const loggerMocks = vi.hoisted(() => ({
  error: vi.fn(),
  flush: vi.fn(async () => undefined),
}));

vi.mock('@/platform/telemetry/frontend-logger', () => ({
  flushFrontendLogs: loggerMocks.flush,
  frontendLogger: { error: loggerMocks.error },
}));

afterEach(() => {
  document.getElementById('hydration-failure')?.remove();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

test('reports a root failure and renders the reload control', async () => {
  const reportError = vi.fn();
  vi.stubGlobal('reportError', reportError);

  reportHydrationFailure(document, 'root render failed');

  expect(reportError).toHaveBeenCalledWith(
    expect.objectContaining({ message: 'root render failed' })
  );
  expect(loggerMocks.error).toHaveBeenCalledWith('client.hydration_failed', {
    error: 'root render failed',
  });
  expect(loggerMocks.flush).toHaveBeenCalledWith({ preferBeacon: false });
  await expect
    .element(page.getByRole('alert'))
    .toMatchTextContent('This page could not finish loading');
  await expect
    .element(page.getByRole('button', { name: 'Reload page' }))
    .toHaveAttribute('type', 'button');
});

test('keeps one recovery control when reporting services fail', async () => {
  loggerMocks.error.mockImplementation(() => {
    throw new Error('logger failed');
  });
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
