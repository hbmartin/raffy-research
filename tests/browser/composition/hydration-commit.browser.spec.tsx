import { render, page } from '@tests/utils';
import { StrictMode } from 'react';
import { expect, test, vi } from 'vitest';

import { HydrationCommit } from '@/composition/hydration-commit';
import {
  hasInitialHydrationCommitted,
  handleClientHydrationFailure,
} from '@/composition/start-client-hydration';

const mocks = vi.hoisted(() => ({ report: vi.fn(), recovery: vi.fn() }));
vi.mock('@/composition/hydration-failure', () => ({
  reportHydrationFailure: mocks.report,
  reportRootFailure: mocks.report,
  showClientRecovery: mocks.recovery,
}));

test('owns the real first React commit under Strict Mode and resumes recovery on trusted input', async () => {
  const isCurrent = () => true;
  expect(hasInitialHydrationCommitted(document)).toBe(false);
  render(
    <StrictMode>
      <HydrationCommit document={document} isCurrent={isCurrent}>
        <button>Resume</button>
      </HydrationCommit>
    </StrictMode>
  );
  await expect
    .element(page.getByRole('button', { name: 'Resume' }))
    .toBeVisible();
  expect(hasInitialHydrationCommitted(document)).toBe(true);
  window.dispatchEvent(new Event('beforeunload'));
  const failure = new Error('tentative root failure');
  handleClientHydrationFailure(document, failure, isCurrent, 'root');
  handleClientHydrationFailure(document, failure, isCurrent, 'root');
  expect(mocks.report).toHaveBeenCalledExactlyOnceWith(
    document,
    failure,
    false
  );
  expect(mocks.recovery).not.toHaveBeenCalled();
  await page.getByRole('button', { name: 'Resume' }).click();
  expect(mocks.recovery).toHaveBeenCalledExactlyOnceWith(
    document,
    'client.root_uncaught'
  );
  expect(mocks.report).toHaveBeenCalledOnce();
});
