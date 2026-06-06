import { expect, test } from '@tests/e2e/utils';

import { chromiumOnlyMessage, desktopViewport, screenshot } from './helpers';

test.describe('Auth visual regression', () => {
  test.describe.configure({ timeout: 60_000 });

  test.skip(
    ({ browserName }) => browserName !== 'chromium',
    chromiumOnlyMessage
  );

  test.use({ viewport: desktopViewport });

  test('login page remains visually stable', async ({ page }) => {
    await page.to('/login');
    await expect(page.getByTestId('auth-login-form')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    await screenshot(page, 'login-page.png');
  });
});
