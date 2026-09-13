import { expect, test } from '@playwright/test';

import { SSR_SEED_PASSWORD } from '@tests/support/ssr-e2e';

import { installConsoleErrorGuard } from './utils/console-error-guard';
import { ADMIN_EMAIL } from './utils/constants';

test('completes login SSR and hydrates an interactive form after a hard reload', async ({
  page,
}, testInfo) => {
  const guard = installConsoleErrorGuard(page, testInfo);
  // APIRequestContext consumes the whole response, including the query stream.
  const response = await page.request.get('/login', { timeout: 10_000 });
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('</html>');
  expect(html).not.toContain('Serialization timeout');

  await page.goto('/login', { waitUntil: 'load', timeout: 10_000 });
  const reloadResponse = await page.reload({
    waitUntil: 'load',
    timeout: 10_000,
  });
  const reloadHtml = await reloadResponse?.text();
  expect(reloadHtml).toBeTruthy();
  await expect(page.getByTestId('auth-login-form')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await page.getByPlaceholder('Email', { exact: true }).fill(ADMIN_EMAIL);
  await page
    .getByPlaceholder('Password', { exact: true })
    .fill(SSR_SEED_PASSWORD);
  await expect(page.locator('button[type="submit"]')).toBeEnabled();

  const meta = await page.evaluate((serverHtml) => {
    const server = new DOMParser().parseFromString(
      serverHtml ?? '',
      'text/html'
    );
    const tags = (head: HTMLHeadElement) =>
      Array.from(head.querySelectorAll('meta'))
        .map((tag) =>
          JSON.stringify({
            name: tag.name,
            property: tag.getAttribute('property'),
            content: tag.content,
            charset: tag.getAttribute('charset'),
          })
        )
        .sort();
    return { server: tags(server.head), hydrated: tags(document.head) };
  }, reloadHtml);
  expect(meta.hydrated).toEqual(meta.server);
  await page.screenshot({
    path: testInfo.outputPath('login-hydrated.png'),
    fullPage: true,
  });
  await guard.assertNoUnexpectedIssues();
});

test('completes authenticated SSR and hydrates the manager after a hard reload', async ({
  page,
}, testInfo) => {
  const guard = installConsoleErrorGuard(page, testInfo);
  await page.goto('/login', { waitUntil: 'load', timeout: 10_000 });
  await expect(page.getByTestId('auth-login-form')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await page.getByPlaceholder('Email', { exact: true }).fill(ADMIN_EMAIL);
  await page
    .getByPlaceholder('Password', { exact: true })
    .fill(SSR_SEED_PASSWORD);
  await page.locator('button[type="submit"]').click();
  await expect(page.getByTestId('layout-manager')).toBeVisible();

  const response = await page.request.get('/manager', { timeout: 10_000 });
  expect(response.status()).toBe(200);
  expect(await response.text()).toContain('layout-manager');
  await page.reload({ waitUntil: 'load', timeout: 10_000 });
  await expect(page.getByTestId('layout-manager')).toBeVisible();
  await page.screenshot({
    path: testInfo.outputPath('manager-hydrated.png'),
    fullPage: true,
  });
  await guard.assertNoUnexpectedIssues();
});
