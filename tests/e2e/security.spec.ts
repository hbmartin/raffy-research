import { expect, test } from '@tests/e2e/utils';

test('ordinary E2E HTML keeps strict style directives', async ({ page }) => {
  const response = await page.request.get('/login');
  expect(response.status()).toBe(200);
  const policy = response.headers()['content-security-policy'] ?? '';
  const directives = policy.split(';').map((directive) => directive.trim());
  const style = directives.find((directive) =>
    directive.startsWith('style-src ')
  );
  const styleElement = directives.find((directive) =>
    directive.startsWith('style-src-elem ')
  );

  expect(style).toContain("'nonce-");
  expect(style).not.toContain("'unsafe-inline'");
  expect(styleElement).toContain("'nonce-");
  expect(styleElement).not.toContain("'unsafe-inline'");
});
