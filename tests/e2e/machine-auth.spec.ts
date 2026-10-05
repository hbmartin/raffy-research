import { expect, test } from '@tests/e2e/utils';
import { installConsoleErrorGuard } from '@tests/e2e/utils/console-error-guard';
import { USER_FILE } from '@tests/e2e/utils/constants';

import { createMachineCredentials } from '@/modules/auth/testing';
import { createDbClient } from '@/modules/kernel/infrastructure/db/client';

const requirePair = async (name: string) => {
  const db = createDbClient({ url: process.env.E2E_DATABASE_URL });
  const result = await createMachineCredentials(db).begin({
    name,
    capabilities: ['research', 'newsletter'],
  });
  await db.$close();
  if (result.isError()) throw result.getError();
  return result.get();
};

test.describe('Browser pairing for an app machine identity', () => {
  test.use({ storageState: USER_FILE });
  test('shows requested access and expiry at desktop/mobile widths, then records denial', async ({
    page,
  }, testInfo) => {
    const assertNoConsoleErrors = installConsoleErrorGuard(page, testInfo);
    const pair = await requirePair('Disposable machine approval fixture');
    await page.goto(`/app/cli-authorize?request=${pair.id}`);
    await expect(
      page.getByRole('heading', { name: 'Authorize Raffy CLI' })
    ).toBeVisible();
    await expect(page.getByText('Access: research, newsletter')).toBeVisible();
    await expect(page.getByText('Pairing approval deadline:')).toBeVisible();
    await expect(
      page.getByRole('button', { name: 'Approve machine' })
    ).toBeVisible();
    for (const viewport of [
      { width: 1280, height: 900 },
      { width: 390, height: 844 },
    ]) {
      await page.setViewportSize(viewport);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(`approval-${viewport.width}.png`),
        fullPage: true,
      });
    }
    await page.getByRole('button', { name: 'Deny', exact: true }).click();
    await expect(page.getByRole('status')).toHaveText('Request denied');
    await page.reload();
    await expect(page.getByRole('status')).toHaveText('Request denied');
    await assertNoConsoleErrors.assertNoUnexpectedIssues();
  });
  test('approves a disposable credential and respects subsequent revocation', async ({
    page,
  }) => {
    const pair = await requirePair('Disposable credential lifecycle');
    await page.goto(`/app/cli-authorize?request=${pair.id}`);
    await page.getByRole('button', { name: 'Approve machine' }).click();
    await expect(page.getByRole('status')).toHaveText('Machine authorized');
    const db = createDbClient({ url: process.env.E2E_DATABASE_URL });
    try {
      const auth = createMachineCredentials(db),
        identity = await auth.authenticate(pair.id, pair.secret);
      expect(identity.isOk()).toBe(true);
      if (identity.isError()) throw identity.getError();
      const value = identity.get();
      expect(value.type).toBe('machine_authenticated');
      if (value.type !== 'machine_authenticated')
        throw new Error('Approval missing');
      await auth.revoke(value.identity.userId, pair.id);
      const revoked = await auth.authenticate(pair.id, pair.secret);
      if (revoked.isError()) throw revoked.getError();
      expect(revoked.get().type).toBe('machine_unauthorized');
    } finally {
      await db.$close();
    }
  });
});
