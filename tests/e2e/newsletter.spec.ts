import { expect, test } from '@tests/e2e/utils';
import { USER_FILE } from '@tests/e2e/utils/constants';
import { seedNewsletterE2e } from '@tests/support/newsletter-e2e';
import { readFile } from 'node:fs/promises';

test.describe('Shared newsletter drafting', () => {
  test.use({ storageState: USER_FILE });
  test('selects, resumes after browser closure, versions, exports and warns about evidence', async ({
    page,
    context,
  }) => {
    test.setTimeout(60000);
    const fixture = await seedNewsletterE2e();
    try {
      await page.to('/app');
      const panel = page.getByRole('region', { name: 'Newsletter drafting' });
      await expect(panel.getByText('Supported', { exact: true })).toBeVisible();
      await panel.getByText('Evidence history (1)', { exact: true }).click();
      await expect(
        panel.getByRole('link', { name: 'Original source' })
      ).toHaveAttribute('href', 'https://example.org/study');
      await panel
        .getByRole('button', { name: 'Skip newsletter for this report' })
        .click();
      await expect(
        panel.getByText('Newsletter skipped for this report.')
      ).toBeVisible();
      await panel.getByRole('button', { name: 'Show themes' }).click();
      await panel
        .getByRole('button', { name: 'Draft this theme', exact: true })
        .click();
      await expect(panel.getByText(/Shared selection:/)).toBeVisible();
      await expect(panel.getByText(/Queued for local execution/)).toBeVisible();
      await page.close();
      await fixture.finish();
      const reader = await context.newPage();
      await reader.setViewportSize({ width: 390, height: 844 });
      await reader.goto('/app');
      const saved = reader.getByRole('region', { name: 'Newsletter drafting' });
      await expect(
        saved.getByRole('heading', { name: 'Saved draft versions (1)' })
      ).toBeVisible();
      await saved
        .getByText('Claim and synthesis audit', { exact: true })
        .click();
      await expect(
        saved.getByRole('link', { name: 'Supporting source' })
      ).toHaveAttribute('href', 'https://example.org/study');
      expect(
        await reader.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await saved
        .getByLabel('Feedback for a new version')
        .fill('Tighten the opening.');
      await saved
        .getByRole('button', { name: 'Regenerate with feedback' })
        .click();
      await expect(saved.getByText(/Queued for local execution/)).toBeVisible();
      await fixture.finish();
      await expect(
        saved.getByRole('heading', { name: 'Saved draft versions (2)' })
      ).toBeVisible();
      await fixture.db.$client.query(
        'update "sourceRecord" set "relevanceLabel"=$1 where "id"=$2',
        ['junk', fixture.sourceId]
      );
      await expect(
        saved.getByText(/marked Junk since this version/).first()
      ).toBeVisible();
      const downloadPromise = reader.waitForEvent('download');
      await saved
        .getByRole('button', { name: 'Export plain text' })
        .first()
        .click();
      const download = await downloadPromise;
      const exported = await readFile((await download.path())!, 'utf8');
      expect(exported).toContain(
        'Subject: Scheduling is becoming a conversation'
      );
      expect(exported).toContain('(https://example.org/study)');
      await reader.reload();
      await expect(
        saved.getByRole('heading', { name: 'Saved draft versions (2)' })
      ).toBeVisible();
      await saved.getByRole('button', { name: 'Abandon selection' }).click();
      await expect(
        saved.getByRole('button', { name: 'Abandon selection' })
      ).toHaveCount(0);
      await reader.close();
    } finally {
      await fixture.close();
    }
  });
});
