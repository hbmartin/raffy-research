import { page } from '@tests/utils';
import { afterEach, expect, test, vi } from 'vitest';

import {
  reportHydrationFailure,
  reportRootFailure,
} from '@/composition/hydration-failure';

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
    .toHaveTextContent('This page could not finish loading');
  await expect
    .element(page.getByRole('button', { name: 'Reload page' }))
    .toHaveAttribute('type', 'button');
});

test('reports a later uncaught root error with a generic recovery notice', async () => {
  const reportError = vi.fn();
  vi.stubGlobal('reportError', reportError);
  const failure = new Error('later render failed');

  reportRootFailure(document, failure, true);

  expect(reportError).toHaveBeenCalledWith(failure);
  expect(loggerMocks.error).toHaveBeenCalledWith('client.root_uncaught', {
    error: 'later render failed',
  });
  await expect
    .element(page.getByRole('alert'))
    .toHaveTextContent('This page encountered an error');
});

test('reports a stale root error without adding a recovery notice', () => {
  vi.stubGlobal('reportError', vi.fn());
  reportRootFailure(document, new Error('stale root failed'), false);

  expect(loggerMocks.error).toHaveBeenCalledWith('client.root_uncaught', {
    error: 'stale root failed',
  });
  expect(document.getElementById('hydration-failure')).toBeNull();
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
  expect(loggerMocks.flush).toHaveBeenCalledWith({ preferBeacon: false });
  await expect.element(page.getByRole('alert')).toBeVisible();
  await expect
    .element(page.getByRole('button', { name: 'Reload page' }))
    .toBeVisible();
});
