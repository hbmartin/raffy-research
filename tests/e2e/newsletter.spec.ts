import { Result } from '@swan-io/boxed';
import { expect, test } from '@tests/e2e/utils';
import { installConsoleErrorGuard } from '@tests/e2e/utils/console-error-guard';
import { USER_FILE } from '@tests/e2e/utils/constants';
import { requireOk } from '@tests/support/newsletter';
import { seedNewsletterE2e } from '@tests/support/newsletter-e2e';
import { readFile } from 'node:fs/promises';

test.describe('Shared newsletter drafting', () => {
  test.use({ storageState: USER_FILE });

  test('selects, resumes after browser closure, versions, exports and warns about evidence', async ({
    page,
    browser,
  }, testInfo) => {
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
      const resumedContext = await browser.newContext({
        storageState: USER_FILE,
      });
      const reader = await resumedContext.newPage();
      const consoleGuard = installConsoleErrorGuard(reader, testInfo);
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
      await saved.getByText('Newsletter history', { exact: true }).click();
      await saved
        .getByRole('button', {
          name: 'Scheduling is becoming a conversation',
          exact: true,
        })
        .first()
        .click();
      await expect(
        saved.getByRole('button', { name: 'Export historical text' })
      ).toBeVisible();
      await fixture.db.$client.query(
        'update "sourceRecord" set "relevanceLabel"=$1 where "id"=$2',
        ['junk', fixture.sourceId]
      );
      await saved.getByRole('button', { name: 'Refresh newsletter' }).click();
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
      const historicalDownloadPromise = reader.waitForEvent('download');
      await saved
        .getByRole('button', { name: 'Export historical text' })
        .click();
      const historicalDownload = await historicalDownloadPromise;
      expect(
        await readFile((await historicalDownload.path())!, 'utf8')
      ).toContain('https://example.org/study');
      await reader.reload();
      await expect(
        saved.getByRole('heading', { name: 'Saved draft versions (2)' })
      ).toBeVisible();
      await saved.getByRole('button', { name: 'Abandon selection' }).click();
      await expect(
        saved.getByRole('button', { name: 'Abandon selection' })
      ).toHaveCount(0);
      await consoleGuard.assertNoUnexpectedIssues();
      await resumedContext.close();
    } finally {
      await fixture.close();
    }
  });

  test('preserves dirty settings, prepares explicitly and retries failed work as a new attempt', async ({
    page,
  }) => {
    test.setTimeout(60000);
    const fixture = await seedNewsletterE2e();
    try {
      await page.to('/app');
      const panel = page.getByRole('region', { name: 'Newsletter drafting' });
      await expect(
        panel.getByRole('button', { name: 'Prepare themes', exact: true })
      ).toBeEnabled();
      await panel.getByText('Newsletter settings', { exact: true }).click();
      await panel
        .getByLabel('House writing guidance')
        .fill('Retain this unsaved editorial preference.');
      await panel.getByRole('button', { name: 'Refresh newsletter' }).click();
      await expect(panel.getByLabel('House writing guidance')).toHaveValue(
        'Retain this unsaved editorial preference.'
      );
      await panel
        .getByRole('button', { name: 'Save newsletter settings' })
        .click();
      await expect
        .poll(
          async () =>
            requireOk(
              await fixture.repository.listJobs(fixture.report.workspaceId)
            ).length
        )
        .toBe(0);
      await panel
        .getByRole('button', { name: 'Prepare themes', exact: true })
        .click();
      await expect(panel.getByText(/Queued for local execution/)).toBeVisible();
      expect(await fixture.failNext()).toMatchObject({
        type: 'job_finished',
        status: 'failed',
      });
      const newest = requireOk(
        await fixture.repository.listJobs(fixture.report.workspaceId)
      ).find((job) => job.status === 'failed')!;
      requireOk(
        await fixture.repository.mutate(fixture.report.workspaceId, () =>
          Result.Ok({
            value: 'seeded',
            jobs: Array.from({ length: 8 }, (_, i) => ({
              ...newest,
              id: `old-failure-${i}`,
              key: `old-failure-${i}`,
              failure: `Old failure ${i}`,
              createdAt: new Date(newest.createdAt.getTime() - (8 - i) * 1000),
            })),
          })
        )
      );
      await panel.getByRole('button', { name: 'Refresh newsletter' }).click();
      await panel
        .getByText('Recent generation failures (9)', { exact: true })
        .click();
      await expect(
        panel.getByText(/Deterministic generation outage/)
      ).toBeVisible();
      await expect(
        panel.getByText('Old failure 0', { exact: true })
      ).toHaveCount(0);
      await panel
        .getByText('Audit and repair details', { exact: true })
        .first()
        .click();
      await expect(panel.getByText(/Context 128,000/)).toBeVisible();
      await panel
        .getByRole('button', { name: 'Retry failed work', exact: true })
        .first()
        .click();
      await expect(panel.getByText(/Queued for local execution/)).toBeVisible();
      await fixture.finish();
      await panel.getByRole('button', { name: 'Refresh newsletter' }).click();
      const jobs = requireOk(
        await fixture.repository.listJobs(fixture.report.workspaceId)
      );
      const failure = jobs.find((job) => job.id === newest.id)!;
      expect(
        jobs.find((job) => job.parentAttemptId === failure.id)
      ).toMatchObject({ status: 'succeeded' });
      expect(failure.failure).toContain('Deterministic generation outage');
      await panel.getByText('Newsletter history', { exact: true }).click();
      await expect(
        panel.getByRole('button', {
          name: 'Deterministic generation outage',
          exact: true,
        })
      ).toBeVisible();
      await panel.getByLabel('Generation runtime').selectOption('openai');
      await panel
        .getByLabel('Model', { exact: true })
        .fill('custom-hosted-model');
      await expect(panel.getByLabel('Response token cap')).toHaveValue('16384');
      await panel.getByLabel('Context window (tokens)').fill('64000');
      await panel.getByLabel('Response token cap').fill('8192');
      await panel.getByRole('button', { name: 'Refresh newsletter' }).click();
      await expect(panel.getByLabel('Response token cap')).toHaveValue('8192');
      await panel
        .getByLabel('Model', { exact: true })
        .fill('another-custom-model');
      await expect(panel.getByLabel('Context window (tokens)')).toHaveValue('');
      await page.assertNoUnexpectedConsoleErrors();
    } finally {
      await fixture.close();
    }
  });

  test('compares uncertain evidence, confirms equivalence and keeps a revision separate', async ({
    page,
  }) => {
    const fixture = await seedNewsletterE2e();
    try {
      const changedId = await fixture.seedPossibleDuplicate();
      await page.to('/app');
      const panel = page.getByRole('region', { name: 'Newsletter drafting' });
      await panel
        .getByText('Review possible duplicate evidence', { exact: true })
        .click();
      await panel
        .getByRole('button', { name: 'Compare captured text' })
        .click();
      await expect(
        panel.getByText('A material revision needs an editorial decision.', {
          exact: false,
        })
      ).toBeVisible();
      await expect(
        panel.getByRole('button', { name: 'Reverse decision' })
      ).toBeDisabled();
      await panel
        .getByRole('button', { name: 'Confirm equivalent content' })
        .click();
      await expect(panel.getByText('confirmed', { exact: true })).toBeVisible();
      await expect(
        panel.getByRole('button', { name: 'Reverse decision' })
      ).toBeEnabled();
      await panel
        .getByRole('button', { name: 'Keep versions separate' })
        .click();
      await expect(panel.getByText('separate', { exact: true })).toBeVisible();
      const result = await fixture.db.$client.query<{ count: string }>(
        'select count(*)::text as count from "evidenceEquivalenceDecision" where "workspaceId"=$1',
        [fixture.report.workspaceId]
      );
      expect(result.rows[0]?.count).toBe('2');
      const captures = await fixture.db.$client.query<{
        id: string;
        contentText: string;
      }>(
        'select id, "contentText" from "sourceRecord" where id=any($1::text[])',
        [[fixture.sourceId, changedId]]
      );
      expect(captures.rows).toHaveLength(2);
      expect(
        captures.rows.find((source) => source.id === changedId)?.contentText
      ).toContain('A material revision needs an editorial decision.');
      await page.assertNoUnexpectedConsoleErrors();
    } finally {
      await fixture.close();
    }
  });

  test('shows missing allocation, allows disabling and preserves remotely edited local ownership', async ({
    page,
  }) => {
    const fixture = await seedNewsletterE2e();
    try {
      const owner = fixture.state.profile!.runtime.localOperatorId;
      requireOk(
        await fixture.repository.mutate(fixture.report.workspaceId, (state) => {
          state.profile!.runtime = {
            mode: 'local',
            provider: 'ollama',
            model: 'custom-local',
            contextWindowTokens: 64000,
            localOperatorId: owner,
            contextLimit: {
              provider: 'ollama',
              model: 'custom-local',
              tokens: 128000,
              origin: 'discovered',
            },
          };
          return Result.Ok({ value: 'updated' });
        })
      );
      await page.to('/app');
      const panel = page.getByRole('region', { name: 'Newsletter drafting' });
      await expect(
        panel.getByRole('alert').filter({ hasText: 'OLLAMA_NUM_CTX' })
      ).toBeVisible();
      await panel.getByText('Newsletter settings', { exact: true }).click();
      await panel
        .getByLabel('Prepare themes automatically after published reports')
        .uncheck();
      await panel
        .getByRole('button', { name: 'Save newsletter settings' })
        .click();
      await expect(
        page.getByText('Newsletter settings saved', { exact: true }).last()
      ).toBeVisible();
      expect(
        requireOk(await fixture.repository.read(fixture.report.workspaceId))
          .profile!.enabled
      ).toBe(false);
      requireOk(
        await fixture.repository.mutate(fixture.report.workspaceId, (state) => {
          state.profile!.runtime.contextLimit!.operatorCeiling = 32000;
          return Result.Ok({ value: 'allocated' });
        })
      );
      await page.reload();
      await panel.getByText('Newsletter settings', { exact: true }).click();
      await panel
        .getByLabel('Newsletter readership')
        .fill('Remote editorial preference');
      await panel
        .getByRole('button', { name: 'Save newsletter settings' })
        .click();
      await expect(
        page.getByText('Newsletter settings saved', { exact: true }).last()
      ).toBeVisible();
      const saved = requireOk(
        await fixture.repository.read(fixture.report.workspaceId)
      ).profile!;
      expect(saved.audience).toBe('Remote editorial preference');
      expect(saved.runtime.localOperatorId).toBe(owner);
      expect(saved.runtime.contextLimit!.operatorCeiling).toBe(32000);
      await panel
        .getByRole('button', { name: 'Prepare themes', exact: true })
        .click();
      await expect(panel.getByText(/Queued for local execution/)).toBeVisible();
      expect(
        requireOk(
          await fixture.repository.listJobs(fixture.report.workspaceId)
        )[0]!.budget!.contextTokens
      ).toBe(32000);
      await page.setViewportSize({ width: 390, height: 844 });
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth
        )
      ).toBe(true);
      await page.assertNoUnexpectedConsoleErrors();
    } finally {
      await fixture.close();
    }
  });
});
