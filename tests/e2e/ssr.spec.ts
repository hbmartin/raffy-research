import { expect, type Page, test, type TestInfo } from '@playwright/test';
import { SSR_SEED_PASSWORD } from '@tests/support/ssr-e2e';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { installConsoleErrorGuard } from './utils/console-error-guard';
import { ADMIN_EMAIL } from './utils/constants';
import { readFixtureEnvironment } from '../../scripts/ssr-fixture-env';

const captureSsrScreenshot = async (
  page: Page,
  testInfo: TestInfo,
  name: string
) => {
  await page.screenshot({
    path: testInfo.outputPath(name),
    fullPage: true,
    caret: 'initial',
  });
};

const waitForHttpReady = async (
  url: string,
  child: ReturnType<typeof spawn>,
  readOutput: () => string
) => {
  const deadline = Date.now() + 30_000;
  let lastStatus: number | undefined;
  while (Date.now() < deadline) {
    if (child.exitCode !== null || child.signalCode !== null)
      throw new Error(`SSR child exited before readiness:\n${readOutput()}`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastStatus = response.status;
    } catch {
      // The child has not started listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(
    `Timed out waiting for ${url}${lastStatus ? ` (last status ${lastStatus})` : ''}:\n${readOutput()}`
  );
};

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
  expect(html).not.toContain('__START_UI_CSP_NONCE__');
  const firstNonce = html.match(/property="csp-nonce" content="([^"]+)"/)?.[1];
  expect(firstNonce).toBeTruthy();
  expect(response.headers()['content-security-policy']).toContain(
    `'nonce-${firstNonce}'`
  );
  expect(response.headers()['content-security-policy']).toContain(
    "style-src-elem 'self' 'unsafe-inline'"
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
    const invalid = Array.from(document.querySelectorAll('script:not([src])'))
      .filter((tag) => (tag as HTMLElement).nonce !== nonce)
      .map((tag) => tag.outerHTML.slice(0, 100));
    document.head.insertAdjacentHTML(
      'beforeend',
      '<style id="ssr-style-probe">.ssr-style-probe { color: rgb(1, 2, 3) }</style>'
    );
    const style = document.getElementById(
      'ssr-style-probe'
    ) as HTMLStyleElement;
    const probe = document.createElement('span');
    probe.className = 'ssr-style-probe';
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    style.remove();
    probe.remove();
    return { nonce, invalid, color, styleNonce: style.nonce };
  });
  expect(nonceState.nonce).not.toBe(firstNonce);
  expect(nonceState.invalid).toEqual([]);
  expect(nonceState.styleNonce).toBe('');
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
  await captureSsrScreenshot(page, testInfo, 'login-hydrated.png');
  await guard.assertNoUnexpectedIssues();
});

test('enforces nonced production styles outside the fixture relaxation', async ({
  page,
}, testInfo) => {
  const portByProject: Record<string, string> = {
    'ssr-desktop': '3014',
    'ssr-firefox': '3015',
    'ssr-mobile': '3017',
    'ssr-webkit': '3016',
  };
  const port = portByProject[testInfo.project.name];
  if (!port) throw new Error(`Missing port for ${testInfo.project.name}`);
  const origin = `http://127.0.0.1:${port}`;
  const env = await readFixtureEnvironment();
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: {
      ...env,
      AUTH_ALLOWED_HOSTS: `127.0.0.1:${port}`,
      AUTH_TRUSTED_CLIENT_IP_HEADER: 'x-test-client-ip',
      PORT: port,
      SSR_FIXTURE_MODE: 'false',
      VITE_BASE_URL: origin,
      VITE_PORT: port,
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

  try {
    await waitForHttpReady(`${origin}/login`, child, () => output);
    const response = await page.goto(`${origin}/login`, {
      waitUntil: 'load',
      timeout: 10_000,
    });
    expect(response?.status()).toBe(200);
    const policy = response?.headers()['content-security-policy'] ?? '';
    const styleDirective = policy
      .split('; ')
      .find((directive) => directive.startsWith('style-src '));
    const styleElementDirective = policy
      .split('; ')
      .find((directive) => directive.startsWith('style-src-elem '));
    expect(styleDirective).toContain("'nonce-");
    expect(styleDirective).not.toContain("'unsafe-inline'");
    expect(styleElementDirective).toContain("'nonce-");
    expect(styleElementDirective).not.toContain("'unsafe-inline'");

    const dynamicStyle = await page.evaluate(() => {
      const nonce = document
        .querySelector('meta[property="csp-nonce"]')
        ?.getAttribute('content');
      const style = document.createElement('style');
      style.textContent = '.nonced-style-probe { color: rgb(4, 5, 6) }';
      document.head.append(style);
      const probe = document.createElement('span');
      probe.className = 'nonced-style-probe';
      document.body.append(probe);
      return {
        color: getComputedStyle(probe).color,
        nonce,
        styleNonce: style.nonce,
      };
    });
    expect(dynamicStyle.styleNonce).toBe(dynamicStyle.nonce);
    expect(dynamicStyle.color).toBe('rgb(4, 5, 6)');
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
});

test('reports a failed hydration chunk and shows a reload control', async ({
  page,
}) => {
  const reports: string[] = [];
  const reportStatuses: number[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  page.on('response', (response) => {
    if (response.url().endsWith('/api/telemetry/logs'))
      reportStatuses.push(response.status());
  });
  await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, (route) =>
    route.abort('failed')
  );
  await page.goto('/login', { waitUntil: 'load', timeout: 10_000 });
  await expect(page.getByRole('alert')).toContainText(
    'This page could not finish loading'
  );
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect
    .poll(() =>
      reports.some((body) => body.includes('client.hydration_failed'))
    )
    .toBe(true);
  await expect.poll(() => reportStatuses).toContain(202);
});

test('does not report a hydration chunk canceled by navigation', async ({
  page,
}) => {
  const releaseFirstChunk = Promise.withResolvers<void>();
  const reports: string[] = [];
  const hydrationChunkPattern = /\/assets\/hydrate-client-[^/]+\.js$/;
  let hydrationRequests = 0;
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  await page.route(hydrationChunkPattern, async (route) => {
    hydrationRequests += 1;
    if (hydrationRequests !== 1) {
      await route.continue();
      return;
    }

    await releaseFirstChunk.promise;
    await route.abort('failed').catch(() => undefined);
  });

  await page.goto('/login', { waitUntil: 'commit', timeout: 10_000 });
  await expect.poll(() => hydrationRequests).toBe(1);
  const navigation = page.goto('about:blank', {
    waitUntil: 'load',
    timeout: 10_000,
  });
  await navigation;
  releaseFirstChunk.resolve();
  await page.unroute(hydrationChunkPattern);
  expect(reports.some((body) => body.includes('client.hydration_failed'))).toBe(
    false
  );
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
  await captureSsrScreenshot(page, testInfo, 'manager-hydrated.png');
  await guard.assertNoUnexpectedIssues();
});

for (const nodeEnv of [undefined, 'development', 'production'])
  test(`rejects invalid production collector headers with NODE_ENV=${nodeEnv}`, async ({
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
        NODE_ENV: nodeEnv,
        SSR_FIXTURE_MODE: 'false',
        AUTH_TRUSTED_CLIENT_IP_HEADER: 'x-test-client-ip',
        OTEL_EXPORTER_OTLP_TRACES_HEADERS:
          'x-token=credential-sentinel%0Avalue',
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

for (const completion of ['no-content', 'download', 'document'] as const) {
  test(`keeps recovery quiet during a slow real navigation ending in ${completion}`, async ({
    page,
  }) => {
    const destinationRequested = Promise.withResolvers<void>();
    const releaseDestination = Promise.withResolvers<void>();
    const downloaded = Promise.withResolvers<void>();
    page.on('download', () => downloaded.resolve());
    await page.route('**/quiet-destination', async (route) => {
      destinationRequested.resolve();
      await releaseDestination.promise;
      if (completion === 'no-content') await route.fulfill({ status: 204 });
      else if (completion === 'download')
        await route.fulfill({
          status: 200,
          headers: {
            'Content-Disposition': 'attachment; filename="fixture.txt"',
          },
          body: 'fixture',
        });
      else
        await route.fulfill({
          status: 200,
          contentType: 'text/html',
          body: '<html><body>Destination</body></html>',
        });
    });
    try {
      await page.goto('/login', { waitUntil: 'load' });
      await expect(page.getByTestId('auth-login-form')).toHaveAttribute(
        'data-hydrated',
        'true'
      );
      const navigation = page
        .goto('/quiet-destination', { waitUntil: 'commit' })
        .catch((error: unknown) => {
          if (completion === 'document') throw error;
          // WebKit reports intercepted downloads through navigation failure,
          // without emitting the download event used by the other browsers.
          if (
            completion === 'download' &&
            error instanceof Error &&
            error.message.includes('Download is starting')
          )
            downloaded.resolve();
        });
      await destinationRequested.promise;
      // Specifically exceed the old one-second cancellation heuristic.
      await new Promise((resolve) => setTimeout(resolve, 1_200));
      releaseDestination.resolve();
      await navigation;
      if (completion === 'download') await downloaded.promise;
      if (completion === 'document')
        await expect(
          page.getByText('Destination', { exact: true })
        ).toBeVisible();
      else {
        await page
          .getByPlaceholder('Email', { exact: true })
          .fill('resume@example.test');
        await expect(
          page.getByPlaceholder('Email', { exact: true })
        ).toHaveValue('resume@example.test');
        await expect(page.getByRole('alert')).toHaveCount(0);
      }
    } finally {
      releaseDestination.resolve();
    }
  });
}

test('retains a chunk failure through a cancelled beforeunload dialog until interaction resumes', async ({
  page,
}) => {
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, async (route) => {
    requested.resolve();
    await release.promise;
    await route.abort('failed').catch(() => undefined);
  });
  const reports: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  await page.goto('/login', { waitUntil: 'commit' });
  await requested.promise;
  // Unhydrated controls are intentionally inert; use trusted viewport input.
  await page.mouse.click(8, 8);
  await page.evaluate(() =>
    window.addEventListener(
      'beforeunload',
      (event) => {
        event.preventDefault();
        event.returnValue = '';
      },
      { once: true }
    )
  );
  const dialog = page.waitForEvent('dialog').then((dialog) => dialog.dismiss());
  // A cancelled navigation has no load event. Initiate it from the document
  // so the test does not wait for a page.goto load that Firefox/WebKit retain.
  await page.evaluate(() => {
    setTimeout(() => window.location.assign('/quiet-cancelled-destination'), 0);
  });
  await dialog;
  expect(page.url()).toContain('/login');
  release.resolve();
  // The settled import failure is retained through a cancelled departure.
  await expect
    .poll(() => page.evaluate(() => document.readyState))
    .toBe('complete');
  // Unhydrated controls are intentionally inert; use trusted viewport input.
  await page.mouse.click(8, 8);
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect
    .poll(
      () =>
        reports.filter((body) => body.includes('client.hydration_failed'))
          .length
    )
    .toBe(1);
});
