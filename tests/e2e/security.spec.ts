import { expect, test } from '@tests/e2e/utils';

test('E2E HTML uses the intended style directives', async ({ page }) => {
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

  if (process.env.VITE_VISUAL_TEST === 'true') {
    expect(style).toContain("'unsafe-inline'");
    expect(styleElement).toContain("'unsafe-inline'");
    expect(style).not.toContain("'nonce-");
    expect(styleElement).not.toContain("'nonce-");
  } else {
    expect(style).toContain("'nonce-");
    expect(styleElement).toContain("'nonce-");
    expect(style).not.toContain("'unsafe-inline'");
    expect(styleElement).not.toContain("'unsafe-inline'");
  }
});
