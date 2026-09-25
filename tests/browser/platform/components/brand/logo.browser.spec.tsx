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
});
