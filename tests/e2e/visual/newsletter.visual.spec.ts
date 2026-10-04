import { expect, test } from '@tests/e2e/utils';
import { USER_FILE } from '@tests/e2e/utils/constants';
import { seedNewsletterE2e } from '@tests/support/newsletter-e2e';

import { screenshot } from './helpers';

test.describe('Newsletter visual review', () => {
  test.use({ storageState: USER_FILE });

  test('renders theme evidence on desktop and mobile', async ({ page }) => {
    const fixture = await seedNewsletterE2e();
    try {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.to('/app');
      const panel = page.getByRole('region', { name: 'Newsletter drafting' });
      await expect(
        panel.getByRole('button', { name: 'Draft this theme', exact: true })
      ).toBeVisible();
      await panel.getByText('Evidence history (1)', { exact: true }).click();
      await panel.scrollIntoViewIfNeeded();
      const mask = [panel.getByText(/distinct sources;/)];
      await screenshot(page, 'newsletter-desktop.png', { mask });
      await panel.screenshot({
        path: 'test-results/task-verification/newsletter/newsletter-desktop.png',
      });
      await page.setViewportSize({ width: 390, height: 844 });
      await panel.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await screenshot(page, 'newsletter-mobile.png', { mask });
      await panel.screenshot({
        path: 'test-results/task-verification/newsletter/newsletter-mobile.png',
      });
    } finally {
      await fixture.close();
    }
  });
});
