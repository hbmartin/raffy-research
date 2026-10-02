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

const watchRecoveryAlerts = async (page: Page) => {
  let seen = 0;
  page.on('console', (message) => {
    if (message.text() === '__ssr_recovery_alert__') seen++;
  });
  await page.evaluate(() => {
    const report = () => {
      if (document.getElementById('hydration-failure'))
        console.log('__ssr_recovery_alert__');
    };
    new MutationObserver(report).observe(document.documentElement, {
      childList: true,
      subtree: true,
    });
    report();
  });
  return () => seen;
};

const holdStartupRouteFailure = async (page: Page) => {
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const pattern = /\/assets\/login-[^/]+\.js$/;
  await page.route(pattern, async (route) => {
    requested.resolve();
    await release.promise;
    await route.abort('failed').catch(() => undefined);
  });
  await page.goto('/login', { waitUntil: 'commit' });
  await requested.promise;
  await expect
    .poll(() => page.evaluate(() => window.$_TSR?.initialized))
    .toBe(true);
  await page.evaluate(() => {
    // The router handles failed imports through its route boundary. Inject a
    // startup rejection when it resumes after those real route imports settle,
    // so this test also exercises the hydrateStart catch before React starts.
    Object.defineProperty(window.$_TSR!.router!.matches[0], 'b', {
      get: () => {
        document.documentElement.dataset.startupFailure = 'observed';
        throw new TypeError('Fixture startup failure after route loading');
      },
    });
    const probe = document.createElement('button');
    probe.textContent = 'Startup recovery probe';
    probe.style.cssText =
      'position:fixed;bottom:20px;right:20px;padding:12px;z-index:1';
    probe.addEventListener('click', () => {
      document.body.dataset.startupProbeClicks = String(
        Number(document.body.dataset.startupProbeClicks ?? '0') + 1
      );
    });
    document.body.append(probe);
  });
  return { release, pattern };
};

test('defers hydrateStart failure while route loading is canceled by document departure', async ({
  page,
}) => {
  const reports: string[] = [];
  const canceledRoutes: string[] = [];
  page.on('requestfailed', (request) => {
    if (/\/assets\/login-[^/]+\.js$/.test(request.url()))
      canceledRoutes.push(request.url());
  });
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  const { release, pattern } = await holdStartupRouteFailure(page);
  const destinationRequested = Promise.withResolvers<void>();
  const releaseDestination = Promise.withResolvers<void>();
  await page.route('**/quiet-startup-destination', async (route) => {
    destinationRequested.resolve();
    await releaseDestination.promise;
    await route.fulfill({
      contentType: 'text/html',
      body: '<html><body>Startup destination</body></html>',
    });
  });
  try {
    const recoveryAlerts = await watchRecoveryAlerts(page);
    await page.evaluate(() => {
      const link = document.createElement('a');
      link.href = '/quiet-startup-destination';
      link.textContent = 'Leave startup document';
      document.body.append(link);
    });
    await page
      .getByRole('link', { name: 'Leave startup document' })
      .click({ noWaitAfter: true });
    await destinationRequested.promise;
    release.resolve();
    // Chromium may stop startup execution entirely when it cancels route
    // loading for navigation. Either outcome must remain quiet during departure.
    await expect.poll(() => canceledRoutes.length).toBeGreaterThan(0);
    await new Promise((resolve) => setTimeout(resolve, 2_200));
    expect(recoveryAlerts()).toBe(0);
    expect(reports).toHaveLength(0);
    releaseDestination.resolve();
    await expect(
      page.getByText('Startup destination', { exact: true })
    ).toBeVisible();
    expect(reports).toHaveLength(0);
  } finally {
    release.resolve();
    releaseDestination.resolve();
    await page.unroute(pattern);
  }
});

test('recovers a deferred hydrateStart failure after canceled navigation without swallowing input', async ({
  page,
}, testInfo) => {
  const reports: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  const { release, pattern } = await holdStartupRouteFailure(page);
  try {
    await page.getByRole('button', { name: 'Startup recovery probe' }).click();
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
    const dialog = page
      .waitForEvent('dialog')
      .then((dialog) => dialog.dismiss());
    await page.evaluate(() =>
      setTimeout(() => window.location.assign('/quiet-startup-cancel'), 0)
    );
    await dialog;
    await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
    release.resolve();
    await expect(page.locator('html')).toHaveAttribute(
      'data-startup-failure',
      'observed'
    );
    expect(page.url()).toContain('/login');
    expect(reports).toHaveLength(0);
    await expect(page.locator('#hydration-failure')).toHaveCount(0);
    await page.getByRole('button', { name: 'Startup recovery probe' }).click();
    await expect(page.locator('body')).toHaveAttribute(
      'data-startup-probe-clicks',
      '2'
    );
    await expect(page.locator('#hydration-failure')).toContainText(
      'This page could not finish loading'
    );
    await expect
      .poll(
        () =>
          reports.filter((report) => report.includes('client.hydration_failed'))
            .length
      )
      .toBe(1);
    await captureSsrScreenshot(page, testInfo, 'startup-return-recovery.png');
  } finally {
    release.resolve();
    await page.unroute(pattern);
  }
});

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

test('serves HEAD through the built Nitro adapter without a response body', async ({
  page,
}) => {
  const response = await page.request.head('/login', { timeout: 10_000 });
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(await response.body()).toHaveLength(0);
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

test('reports a failed hydration chunk without interaction and shows a reload control', async ({
  page,
}, testInfo) => {
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
  const failedChunk = page.waitForEvent('requestfailed', {
    predicate: (request) =>
      /\/assets\/hydrate-client-[^/]+\.js$/.test(request.url()),
  });
  await page.goto('/login', { waitUntil: 'load', timeout: 10_000 });
  await failedChunk;
  await expect.poll(() => reports.length).toBeGreaterThan(0);
  await expect(page.getByRole('alert')).toContainText(
    'This page could not finish loading'
  );
  await expect(page.getByRole('button', { name: 'Reload page' })).toBeVisible();
  await expect.poll(() => reportStatuses).toContain(202);
  await captureSsrScreenshot(page, testInfo, 'hydration-recovery.png');
});

test('does not report a hydration chunk canceled by navigation', async ({
  page,
}) => {
  const releaseFirstChunk = Promise.withResolvers<void>();
  const destinationRequested = Promise.withResolvers<void>();
  const releaseDestination = Promise.withResolvers<void>();
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

  await page.route('**/quiet-destination', async (route) => {
    destinationRequested.resolve();
    await releaseDestination.promise;
    await route.fulfill({
      status: 200,
      contentType: 'text/html',
      body: '<html><body>Destination</body></html>',
    });
  });

  try {
    await page.goto('/login', { waitUntil: 'commit', timeout: 10_000 });
    await expect.poll(() => hydrationRequests).toBe(1);
    const recoveryAlerts = await watchRecoveryAlerts(page);
    const failedChunk = page.waitForEvent('requestfailed', {
      predicate: (request) => hydrationChunkPattern.test(request.url()),
    });
    const navigation = page.goto('/quiet-destination', {
      waitUntil: 'commit',
      timeout: 10_000,
    });
    await destinationRequested.promise;
    releaseFirstChunk.resolve();
    await failedChunk;
    await page.mouse.click(8, 8);
    expect(recoveryAlerts()).toBe(0);
    expect(reports).toHaveLength(0);
    releaseDestination.resolve();
    await navigation;
    await expect(page.getByText('Destination', { exact: true })).toBeVisible();
    expect(recoveryAlerts()).toBe(0);
    expect(reports).toHaveLength(0);
  } finally {
    releaseFirstChunk.resolve();
    releaseDestination.resolve();
    await page.unroute(hydrationChunkPattern);
  }
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
  test(`requires a production collector with NODE_ENV=${nodeEnv}`, async ({
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
        OTEL_COLLECTOR_URL: undefined,
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
      expect(output).toContain('OTEL_COLLECTOR_URL');
      expect(output).not.toContain('Listening on');
    } finally {
      clearTimeout(timer);
      child.kill('SIGKILL');
    }
  });

test('does not print collector credentials when startup rejects invalid headers', async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'ssr-desktop',
    'Startup output is checked once.'
  );
  const env = await readFixtureEnvironment();
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: {
      ...env,
      PORT: '3014',
      NODE_ENV: 'production',
      SSR_FIXTURE_MODE: 'false',
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

test('keeps Better Auth origin and CSRF checks in production', async ({
  browserName,
}, testInfo) => {
  test.skip(
    browserName !== 'chromium' || testInfo.project.name !== 'ssr-desktop',
    'The runtime auth boundary is checked once per environment.'
  );
  const port = '3019';
  const origin = `http://127.0.0.1:${port}`;
  const env = await readFixtureEnvironment();
  const child = spawn(process.execPath, ['.output/server/index.mjs'], {
    env: {
      ...env,
      AUTH_ALLOWED_HOSTS: `127.0.0.1:${port}`,
      NODE_ENV: 'production',
      TEST: undefined,
      PORT: port,
      SSR_FIXTURE_MODE: 'false',
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
  const signIn = (headers: Record<string, string>, callbackURL?: string) =>
    fetch(`${origin}/api/auth/sign-in/email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams({
        email: 'missing@example.test',
        password: 'invalid-password',
        ...(callbackURL ? { callbackURL } : {}),
      }),
    });
  try {
    await waitForHttpReady(`${origin}/login`, child, () => output);
    const crossSite = await signIn({
      Origin: 'https://evil.example',
      'Sec-Fetch-Site': 'cross-site',
      'Sec-Fetch-Mode': 'navigate',
    });
    expect(crossSite.status).toBe(403);
    await crossSite.arrayBuffer();
    const forgedCookie = await signIn({
      Cookie: 'probe=1',
      Origin: 'https://evil.example',
    });
    expect(forgedCookie.status).toBe(403);
    await forgedCookie.arrayBuffer();
    const untrustedRedirect = await signIn(
      { Origin: origin },
      'https://evil.example/after-login'
    );
    expect(untrustedRedirect.status).toBe(403);
    await untrustedRedirect.arrayBuffer();
    const sameOrigin = await signIn({ Origin: origin });
    expect(sameOrigin.status).not.toBe(403);
    await sameOrigin.arrayBuffer();
  } finally {
    if (child.exitCode === null && child.signalCode === null) {
      const exited = once(child, 'exit');
      child.kill('SIGTERM');
      await exited;
    }
  }
});

for (const completion of ['no-content', 'download', 'document'] as const) {
  test(`handles a pending chunk failure during a slow navigation ending in ${completion}`, async ({
    page,
  }) => {
    const chunkRequested = Promise.withResolvers<void>();
    const releaseChunk = Promise.withResolvers<void>();
    const destinationRequested = Promise.withResolvers<void>();
    const releaseDestination = Promise.withResolvers<void>();
    const downloaded = Promise.withResolvers<void>();
    const reports: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/telemetry/logs'))
        reports.push(request.postData() ?? '');
    });
    page.on('download', () => downloaded.resolve());
    await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, async (route) => {
      chunkRequested.resolve();
      await releaseChunk.promise;
      await route.abort('failed').catch(() => undefined);
    });
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
      await page.goto('/login', { waitUntil: 'commit' });
      await chunkRequested.promise;
      const recoveryAlerts = await watchRecoveryAlerts(page);
      await page.locator('body').evaluate((body) => {
        const probe = document.createElement('button');
        probe.type = 'button';
        probe.textContent = 'Recovery probe';
        probe.style.cssText = 'position:fixed;top:20px;right:20px;z-index:1';
        body.append(probe);
      });
      const failedChunk = page.waitForEvent('requestfailed', {
        predicate: (request) =>
          /\/assets\/hydrate-client-[^/]+\.js$/.test(request.url()),
      });
      releaseChunk.resolve();
      await failedChunk;
      // Let the import rejection reach the coordinator before navigation begins.
      await page.evaluate(
        () => new Promise<void>((resolve) => setTimeout(resolve, 0))
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
      // Exceed the import settling delay while navigation remains pending.
      await new Promise((resolve) => setTimeout(resolve, 3_200));
      expect(recoveryAlerts()).toBe(0);
      expect(reports).toHaveLength(0);
      releaseDestination.resolve();
      await navigation;
      if (completion === 'download') await downloaded.promise;
      if (completion === 'document') {
        await expect(
          page.getByText('Destination', { exact: true })
        ).toBeVisible();
        expect(recoveryAlerts()).toBe(0);
        expect(reports).toHaveLength(0);
      } else {
        await page.getByRole('button', { name: 'Recovery probe' }).click();
        await expect(page.getByRole('alert')).toContainText(
          'This page could not finish loading'
        );
        await expect.poll(() => reports.length).toBeGreaterThan(0);
      }
    } finally {
      releaseChunk.resolve();
      releaseDestination.resolve();
    }
  });
}

test('reports a chunk failure after a cancelled navigation without swallowing its click', async ({
  page,
  browserName,
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
  await page.locator('body').waitFor({ state: 'attached' });
  await page.evaluate((placeBelowNotice) => {
    const probe = document.createElement('button');
    probe.id = 'hydration-click-probe';
    probe.textContent = 'Activation probe';
    probe.style.cssText = placeBelowNotice
      ? 'position:fixed;bottom:20px;right:20px;z-index:1;padding:12px'
      : 'position:fixed;top:20px;right:20px;z-index:1;padding:12px';
    probe.addEventListener('click', () => {
      document.body.dataset.probeClicks = String(
        Number(document.body.dataset.probeClicks ?? '0') + 1
      );
    });
    document.body.append(probe);
  }, browserName === 'webkit');
  const failedChunk = page.waitForEvent('requestfailed', {
    predicate: (request) =>
      /\/assets\/hydrate-client-[^/]+\.js$/.test(request.url()),
  });
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
  // Reassert tentative departure after the dialog closes; Safari may still
  // emit a later focus event and recover before the next click.
  await page.evaluate(() => window.dispatchEvent(new Event('beforeunload')));
  release.resolve();
  await failedChunk;
  await expect
    .poll(() => page.evaluate(() => document.readyState))
    .toBe('complete');
  if (browserName !== 'webkit') {
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(reports).toHaveLength(0);
  }
  await page.getByRole('button', { name: 'Activation probe' }).click();
  await expect(page.locator('body')).toHaveAttribute('data-probe-clicks', '1');
  await expect(page.getByRole('alert')).toContainText(
    'This page could not finish loading'
  );
  await expect.poll(() => reports.length).toBeGreaterThan(0);
});

test('keeps the original page interactive after a cancelled navigation when its chunk loads', async ({
  page,
}) => {
  const requested = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, async (route) => {
    requested.resolve();
    await release.promise;
    await route.continue();
  });
  try {
    await page.goto('/login', { waitUntil: 'commit' });
    await requested.promise;
    await page.locator('body').waitFor({ state: 'attached' });
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
    const dialog = page.waitForEvent('dialog').then((item) => item.dismiss());
    await page.evaluate(() => {
      setTimeout(
        () => window.location.assign('/quiet-cancelled-destination'),
        0
      );
    });
    await dialog;
    release.resolve();
    await expect(page.getByTestId('auth-login-form')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    await page.getByPlaceholder('Email', { exact: true }).fill(ADMIN_EMAIL);
    await expect(page.getByPlaceholder('Email', { exact: true })).toHaveValue(
      ADMIN_EMAIL
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
  } finally {
    release.resolve();
  }
});

test('keeps recovery suppressed through Enter activation and a slow destination', async ({
  page,
}) => {
  const chunkRequested = Promise.withResolvers<void>();
  const releaseChunk = Promise.withResolvers<void>();
  const destinationRequested = Promise.withResolvers<void>();
  const releaseDestination = Promise.withResolvers<void>();
  const reports: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, async (route) => {
    chunkRequested.resolve();
    await releaseChunk.promise;
    await route.abort('failed').catch(() => undefined);
  });
  await page.route('**/keyboard-destination', async (route) => {
    destinationRequested.resolve();
    await releaseDestination.promise;
    await route.fulfill({
      contentType: 'text/html',
      body: '<html><body>Keyboard destination</body></html>',
    });
  });
  try {
    await page.goto('/login', { waitUntil: 'commit' });
    await chunkRequested.promise;
    const recoveryAlerts = await watchRecoveryAlerts(page);
    await page.locator('body').evaluate((body) => {
      const link = document.createElement('a');
      link.id = 'keyboard-destination-link';
      link.href = '/keyboard-destination';
      link.textContent = 'Keyboard destination';
      body.append(link);
      link.focus();
    });
    releaseChunk.resolve();
    await page.evaluate(
      () => new Promise<void>((resolve) => setTimeout(resolve, 0))
    );
    await page.keyboard.down('Enter');
    await destinationRequested.promise;
    await page.keyboard.up('Enter');
    await new Promise((resolve) => setTimeout(resolve, 3_200));
    expect(recoveryAlerts()).toBe(0);
    expect(reports).toHaveLength(0);
    releaseDestination.resolve();
    await expect(
      page.getByText('Keyboard destination', { exact: true })
    ).toBeVisible();
    expect(recoveryAlerts()).toBe(0);
    expect(reports).toHaveLength(0);
  } finally {
    releaseChunk.resolve();
    releaseDestination.resolve();
  }
});

for (const control of ['external', 'image'] as const) {
  test(`suppresses a chunk failure during a slow native ${control} form submission`, async ({
    page,
  }) => {
    const requested = Promise.withResolvers<void>();
    const releaseChunk = Promise.withResolvers<void>();
    const destinationRequested = Promise.withResolvers<void>();
    const releaseDestination = Promise.withResolvers<void>();
    const reports: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/telemetry/logs'))
        reports.push(request.postData() ?? '');
    });
    await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, async (route) => {
      requested.resolve();
      await releaseChunk.promise;
      await route.abort('failed').catch(() => undefined);
    });
    await page.route('**/native-form-destination*', async (route) => {
      destinationRequested.resolve();
      await releaseDestination.promise;
      await route.fulfill({
        status: 200,
        contentType: 'text/html',
        body: '<html><body>Form destination</body></html>',
      });
    });
    try {
      await page.goto('/login', { waitUntil: 'commit' });
      await requested.promise;
      const recoveryAlerts = await watchRecoveryAlerts(page);
      await page.locator('body').evaluate((body, kind) => {
        const form = document.createElement('form');
        form.id = 'native-form-probe';
        form.action = '/native-form-destination';
        body.append(form);
        if (kind === 'external') {
          const button = document.createElement('button');
          button.setAttribute('form', form.id);
          button.textContent = 'Native submit';
          button.style.cssText = 'position:fixed;top:20px;right:20px;z-index:1';
          body.append(button);
        } else {
          const image = document.createElement('input');
          image.type = 'image';
          image.alt = 'Native image submit';
          image.src =
            "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='80' height='30'%3E%3Crect width='80' height='30'/%3E%3C/svg%3E";
          image.style.cssText = 'position:fixed;top:20px;right:20px;z-index:1';
          form.append(image);
        }
      }, control);
      releaseChunk.resolve();
      await page.evaluate(
        () => new Promise<void>((resolve) => setTimeout(resolve, 0))
      );
      const activation =
        control === 'external'
          ? page
              .getByRole('button', { name: 'Native submit' })
              .click({ noWaitAfter: true })
          : page
              .getByAltText('Native image submit')
              .click({ noWaitAfter: true });
      await destinationRequested.promise;
      await activation;
      await new Promise((resolve) => setTimeout(resolve, 3_200));
      expect(recoveryAlerts()).toBe(0);
      expect(reports).toHaveLength(0);
      releaseDestination.resolve();
      await expect(
        page.getByText('Form destination', { exact: true })
      ).toBeVisible();
      expect(reports).toHaveLength(0);
    } finally {
      releaseChunk.resolve();
      releaseDestination.resolve();
    }
  });
}

for (const signal of ['focus', 'visibility'] as const) {
  test(`automatically reconciles a surviving document after ${signal} returns`, async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      Object.defineProperty(document, 'visibilityState', {
        configurable: true,
        get: () =>
          document.documentElement?.dataset.testVisibility === 'hidden'
            ? 'hidden'
            : 'visible',
      });
    });
    const requested = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const reports: string[] = [];
    page.on('request', (request) => {
      if (request.url().endsWith('/api/telemetry/logs'))
        reports.push(request.postData() ?? '');
    });
    await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, async (route) => {
      requested.resolve();
      await release.promise;
      await route.abort('failed').catch(() => undefined);
    });
    try {
      await page.goto('/login', { waitUntil: 'commit' });
      await requested.promise;
      await page.evaluate(() =>
        window.dispatchEvent(new Event('beforeunload'))
      );
      release.resolve();
      await page.evaluate(
        () => new Promise<void>((resolve) => setTimeout(resolve, 0))
      );
      await page.evaluate((kind) => {
        if (kind === 'focus') {
          window.dispatchEvent(new Event('blur'));
          window.dispatchEvent(new Event('focus'));
        } else {
          document.documentElement.dataset.testVisibility = 'hidden';
          document.dispatchEvent(new Event('visibilitychange'));
          document.documentElement.dataset.testVisibility = 'visible';
          document.dispatchEvent(new Event('visibilitychange'));
        }
      }, signal);
      await expect(page.getByRole('alert')).toHaveCount(0);
      expect(reports).toHaveLength(0);
      await expect(page.getByRole('alert')).toContainText(
        'This page could not finish loading'
      );
      await expect.poll(() => reports.length).toBeGreaterThan(0);
      await captureSsrScreenshot(
        page,
        testInfo,
        `automatic-${signal}-recovery.png`
      );
    } finally {
      release.resolve();
    }
  });
}

test('reloads an uncommitted document on a persisted cache restoration', async ({
  page,
}) => {
  const release = Promise.withResolvers<void>();
  const reports: string[] = [];
  let pending = true;
  await page.addInitScript(() => {
    const register = window.addEventListener.bind(window);
    Object.defineProperty(window, 'addEventListener', {
      value: (...args: Parameters<Window['addEventListener']>) => {
        register(...args);
        if (args[0] === 'pageshow')
          document.documentElement.dataset.cacheCoordinator = 'ready';
      },
    });
  });
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, async (route) => {
    if (pending) await release.promise;
    await route.continue().catch(() => undefined);
  });
  try {
    await page.goto('/login', { waitUntil: 'commit' });
    // A preload request can precede installation of the recovery coordinator.
    await expect(page.locator('html')).toHaveAttribute(
      'data-cache-coordinator',
      'ready'
    );
    const reloaded = page.waitForEvent(
      'framenavigated',
      (frame) => frame === page.mainFrame()
    );
    pending = false;
    // Exercise the cache lifecycle contract independently of browser cache policy.
    await page.evaluate(() => {
      window.dispatchEvent(
        new PageTransitionEvent('pagehide', { persisted: true })
      );
      window.dispatchEvent(
        new PageTransitionEvent('pageshow', { persisted: true })
      );
    });
    release.resolve();
    await reloaded;
    await expect(page.getByTestId('auth-login-form')).toHaveAttribute(
      'data-hydrated',
      'true'
    );
    await expect(page.getByRole('alert')).toHaveCount(0);
    expect(reports).toHaveLength(0);
  } finally {
    release.resolve();
  }
});

test('keeps a committed document interactive on a persisted cache restoration', async ({
  page,
}) => {
  const reports: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  await page.goto('/login');
  await expect(page.getByTestId('auth-login-form')).toHaveAttribute(
    'data-hydrated',
    'true'
  );
  await page.evaluate(() => {
    document.documentElement.dataset.cacheFixture = 'retained';
    window.dispatchEvent(
      new PageTransitionEvent('pagehide', { persisted: true })
    );
    window.dispatchEvent(
      new PageTransitionEvent('pageshow', { persisted: true })
    );
  });
  await page.getByPlaceholder('Email', { exact: true }).fill(ADMIN_EMAIL);
  await page
    .getByPlaceholder('Password', { exact: true })
    .fill(SSR_SEED_PASSWORD);
  await expect(page.locator('button[type="submit"]')).toBeEnabled();
  await expect(page.locator('html')).toHaveAttribute(
    'data-cache-fixture',
    'retained'
  );
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(reports).toHaveLength(0);
});

test('recovers an initially hidden document when visibility returns', async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(document, 'visibilityState', {
      configurable: true,
      get: () =>
        document.documentElement?.dataset.testVisibility === 'visible'
          ? 'visible'
          : 'hidden',
    });
  });
  const reports: string[] = [];
  page.on('request', (request) => {
    if (request.url().endsWith('/api/telemetry/logs'))
      reports.push(request.postData() ?? '');
  });
  await page.route(/\/assets\/hydrate-client-[^/]+\.js$/, (route) =>
    route.abort('failed')
  );
  await page.goto('/login', { waitUntil: 'load' });
  await new Promise((resolve) => setTimeout(resolve, 2_200));
  expect(reports).toHaveLength(0);
  await expect(page.locator('#hydration-failure')).toHaveCount(0);
  await page.evaluate(() => {
    document.documentElement.dataset.testVisibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
  });
  await expect(page.locator('#hydration-failure')).toBeVisible();
  await expect.poll(() => reports.length).toBeGreaterThan(0);
});
