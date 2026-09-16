import { defineConfig, devices } from '@playwright/test';

import { SSR_BASE_URL } from './tests/support/ssr-e2e';

export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /(?:^|[/\\])ssr\.spec\.ts$/,
  forbidOnly: !!process.env.CI,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  // Browser process startup is separate from each ten-second HTTP deadline.
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report/ssr' }],
  ],
  outputDir: 'test-results/ssr',
  use: {
    baseURL: SSR_BASE_URL,
    locale: 'en',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    {
      name: 'ssr-desktop',
      use: {
        ...devices['Desktop Chrome'],
      },
    },
    {
      name: 'ssr-firefox',
      use: {
        ...devices['Desktop Firefox'],
      },
    },
    {
      name: 'ssr-webkit',
      use: {
        ...devices['iPhone 13'],
      },
    },
    {
      name: 'ssr-mobile',
      use: {
        ...devices['iPhone 13'],
        defaultBrowserType: 'chromium',
      },
    },
  ],
  webServer: {
    command: 'pnpm e2e:ssr:webserver',
    url: `${SSR_BASE_URL}/login`,
    timeout: 120_000,
    reuseExistingServer: false,
    // Use Playwright's default process-group termination for this disposable
    // in-memory fixture so the app and its database always stop together.
  },
});
