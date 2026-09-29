import '@/platform/styles/app.css';
import { page, render } from '@tests/utils';
import { expect, test } from 'vitest';

import { Logo } from '@/platform/components/brand/logo';

test('keeps a name on the collapsed logo link', async () => {
  render(
    <div className="group" data-collapsible="icon">
      <a href="/">
        <Logo />
      </a>
    </div>
  );

  await expect
    .element(page.getByRole('link', { name: 'Raffy Research' }))
    .toBeVisible();
  const text = page.getByText('Raffy Research').element();
  const style = getComputedStyle(text);
  expect(style.position).toBe('absolute');
  expect(style.width).toBe('1px');
  expect(style.height).toBe('1px');
  expect(style.overflow).toBe('hidden');
  expect(style.clipPath).toBe('inset(50%)');
});
