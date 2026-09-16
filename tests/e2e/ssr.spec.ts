import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFixtureEnvironment } from '../../scripts/ssr-fixture-env';

import { SSR_SEED_PASSWORD } from '@tests/support/ssr-e2e';

import { installConsoleErrorGuard } from './utils/console-error-guard';
import { ADMIN_EMAIL } from './utils/constants';

const captureSsrScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  browserName: string,
  name: string
) => {
  // WebKit's screenshot implementation injects an unnonced `body {}` stylesheet
  // in an isolated world. Keep CSP assertions intact; capture visual evidence in
  // Chromium and Firefox instead. WebKit still runs all behavioral checks.
  if (browserName === 'webkit') return;
  await page.screenshot({
    path: testInfo.outputPath(name),
    fullPage: true,
    caret: 'initial',
  });
};

test('completes login SSR and hydrates an interactive form after a hard reload', async ({
  page,
  browserName,
}, testInfo) => {
  const guard = installConsoleErrorGuard(page, testInfo);
  // APIRequestContext consumes the whole response, including the query stream.
  const response = await page.request.get('/login', { timeout: 10_000 });
  expect(response.status()).toBe(200);
  const html = await response.text();
  expect(html).toContain('</html>');
  expect(html).not.toContain('Serialization timeout');
  expect(html).not.toContain('__START_UI_CSP_NONCE__');
  const firstNonce = html.match(/property="csp-nonce" content="([^"]+)"/)?.[1];
  expect(firstNonce).toBeTruthy();
  expect(response.headers()['content-security-policy']).toContain(
    `'nonce-${firstNonce}'`
  );

  // Reload without waiting for initial hydration to finish.
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
  const nonceState = await page.evaluate(() => {
    const nonce = document
      .querySelector('meta[property="csp-nonce"]')
      ?.getAttribute('content');
    const invalid = Array.from(
      document.querySelectorAll('script:not([src]), style')
    )
      .filter((tag) => (tag as HTMLElement).nonce !== nonce)
      .map((tag) => tag.outerHTML.slice(0, 100));
    const style = document.createElement('style');
    style.textContent = '.ssr-style-probe { color: rgb(1, 2, 3) }';
    document.head.append(style);
    const probe = document.createElement('span');
    probe.className = 'ssr-style-probe';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    style.remove();
    probe.remove();
    return { nonce, invalid, color };
  });
  expect(nonceState.nonce).not.toBe(firstNonce);
  expect(nonceState.invalid).toEqual([]);
  expect(nonceState.color).toBe('rgb(1, 2, 3)');
  for (const signal of ['traces', 'metrics']) {
    const status = await page.evaluate(
      async (signal) =>
        (
          await fetch(`/api/telemetry/otel/v1/${signal}`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-protobuf' },
            body: new Uint8Array([1, 2, 3]),
          })
        ).status,
      signal
    );
    expect(status).toBe(202);
  }
  await captureSsrScreenshot(page, testInfo, browserName, 'login-hydrated.png');
  await guard.assertNoUnexpectedIssues();
});

test('completes authenticated SSR and hydrates the manager after a hard reload', async ({
  page,
  browserName,
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
  await captureSsrScreenshot(
    page,
    testInfo,
    browserName,
    'manager-hydrated.png'
  );
  await guard.assertNoUnexpectedIssues();
});

test('rejects invalid production collector headers before readiness', async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'ssr-desktop',
    'Server startup is checked once; it does not depend on the browser.'
  );
  const env = await readFixtureEnvironment();
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: {
      ...env,
      PORT: '3013',
      OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'x-token=credential-sentinel%0Avalue',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });
  const timer = setTimeout(() => child.kill('SIGKILL'), 8_000);
  try {
    const [code, signal] = await once(child, 'exit');
    expect(signal).toBeNull();
    expect(code).not.toBe(0);
    expect(output).toContain('OTEL_EXPORTER_OTLP_TRACES_HEADERS');
    expect(output).not.toContain('credential-sentinel');
    expect(output).not.toContain('Listening on');
  } finally {
    clearTimeout(timer);
    child.kill('SIGKILL');
  }
});
