import { expect, test } from '@tests/e2e/utils';
import { ADMIN_FILE } from '@tests/e2e/utils/constants';
import { randomUUID } from 'node:crypto';
import { Client } from 'pg';

test.describe('Manager scheduled jobs', () => {
  test.use({ storageState: ADMIN_FILE });

  test('shows partial and pre-workspace failures at desktop and mobile sizes', async ({
    page,
  }) => {
    const client = new Client({
      connectionString:
        'postgresql://postgres:postgres@127.0.0.1:54329/postgres',
    });
    const partialId = randomUUID();
    const globalId = randomUUID();
    const succeededId = randomUUID();
    const skippedId = randomUUID();
    await client.connect();
    try {
      const { rows } = await client.query<{ id: string }>(
        'select "id" from "workspace" limit 1'
      );
      const workspaceId = rows[0]?.id;
      if (!workspaceId) throw new Error('Expected seeded workspace');
      await client.query(
        'insert into "scheduledJobRun" ("id", "kind", "status", "startedAt", "finishedAt", "total", "partial", "items") values ($1, $2, $3, $4, $4, 1, 1, 5)',
        [partialId, 'daily_ingest', 'partial', '2026-06-02T14:00:00.000Z']
      );
      await client.query(
        'insert into "scheduledJobWorkspaceRun" ("id", "jobRunId", "workspaceId", "status", "startedAt", "finishedAt", "succeeded", "partial", "items", "failureCode") values ($1, $2, $3, $4, $5, $5, 1, 1, 5, $6)',
        [
          randomUUID(),
          partialId,
          workspaceId,
          'partial',
          '2026-06-02T14:00:00.000Z',
          'PROVIDER_REQUEST_FAILED',
        ]
      );
      await client.query(
        'insert into "scheduledJobRun" ("id", "kind", "status", "startedAt", "finishedAt", "failed", "failureCode") values ($1, $2, $3, $4, $4, 1, $5)',
        [
          globalId,
          'weekly_reports',
          'failed',
          '2026-06-03T15:00:00.000Z',
          'WORKSPACE_LIST_ERROR',
        ]
      );

      for (const [id, status] of [
        [succeededId, 'succeeded'],
        [skippedId, 'skipped'],
      ] as const) {
        await client.query(
          'insert into "scheduledJobRun" ("id", "kind", "status", "startedAt", "finishedAt", "total", "succeeded", "failed") values ($1, $2, $3, $4, $4, 2, 1, 1)',
          [id, 'weekly_reports', 'partial', '2026-06-04T15:00:00.000Z']
        );
        await client.query(
          'insert into "scheduledJobWorkspaceRun" ("id", "jobRunId", "workspaceId", "status", "startedAt", "finishedAt", "succeeded", "skipped", "items") values ($1, $2, $3, $4, $5, $5, $6, $7, $6)',
          [
            randomUUID(),
            id,
            workspaceId,
            status,
            '2026-06-04T15:00:00.000Z',
            Number(status === 'succeeded'),
            Number(status === 'skipped'),
          ]
        );
      }
      await page.setViewportSize({ width: 1440, height: 900 });
      await page.to('/manager/workspaces');
      await page.getByRole('link', { name: /Aperture Dental Cloud/ }).click();
      const heading = page.getByText('Scheduled jobs', { exact: true });
      await expect(heading).toBeVisible();
      await expect(
        page.getByText('Failed before workspace processing')
      ).toBeVisible();
      await expect(page.getByText('PROVIDER_REQUEST_FAILED')).toBeVisible();
      await expect(
        page
          .locator('li')
          .filter({ hasText: succeededId })
          .getByText('succeeded', { exact: true })
      ).toHaveAttribute('data-variant', 'positive');
      await expect(
        page
          .locator('li')
          .filter({ hasText: skippedId })
          .getByText('skipped', { exact: true })
      ).toHaveAttribute('data-variant', 'secondary');
      await heading.scrollIntoViewIfNeeded();
      await heading
        .locator('xpath=ancestor::*[@data-slot="card"][1]')
        .screenshot({
          path: 'test-results/task-verification/2026-10-01-job-recovery-fixes/jobs-badges.png',
          caret: 'initial',
        });
      await page.screenshot({
        path: 'test-results/scheduled-jobs-desktop.png',
        fullPage: true,
        caret: 'initial',
      });

      await page.setViewportSize({ width: 390, height: 844 });
      await expect(heading).toBeVisible();
      await heading.scrollIntoViewIfNeeded();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await page.screenshot({
        path: 'test-results/scheduled-jobs-mobile.png',
        fullPage: true,
        caret: 'initial',
      });
    } finally {
      await client.query(
        'delete from "scheduledJobRun" where "id" in ($1, $2, $3, $4)',
        [partialId, globalId, succeededId, skippedId]
      );
      await client.end();
    }
  });
});
