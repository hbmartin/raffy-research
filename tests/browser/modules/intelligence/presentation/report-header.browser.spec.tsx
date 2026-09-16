import { page, render, setupUser } from '@tests/utils';
import { toast } from 'sonner';
import { afterEach, expect, test, vi } from 'vitest';

import type { WeeklyReport } from '@/modules/intelligence/domain/report';
import { validateReportData } from '@/modules/intelligence/domain/report-data';
import { ReportHeader } from '@/modules/intelligence/presentation/app/report-header';
import { formatReportAsMarkdown } from '@/modules/intelligence/presentation/report-markdown';
import { toWeeklyReportId, toWorkspaceId } from '@/modules/kernel';

const result = validateReportData({
  workspace_id: 'workspace-1',
  report_id: 'report-1',
  period_start: '2026-09-07',
  period_end: '2026-09-13',
  generated_at: '2026-09-14T10:00:00.000Z',
  timezone: 'America/Los_Angeles',
  title: 'Weekly Market Digest',
  executive_summary: { bullets: ['First', 'Second', 'Third'] },
});
if (result.type !== 'report_data_valid') {
  throw new Error(result.issues.join('\n'));
}

const now = new Date('2026-09-14T10:00:00.000Z');
const report: WeeklyReport = {
  id: toWeeklyReportId('report-1'),
  workspaceId: toWorkspaceId('workspace-1'),
  periodStart: now,
  periodEnd: now,
  timezone: 'America/Los_Angeles',
  status: 'published',
  generatedAt: now,
  publishedAt: now,
  title: null,
  reportData: result.data,
  modelMetadata: null,
  failureReason: null,
  createdAt: now,
  updatedAt: now,
};

afterEach(() => {
  vi.restoreAllMocks();
  toast.dismiss();
});

test('copies the full Markdown report and confirms success', async () => {
  const writeText = vi
    .spyOn(navigator.clipboard, 'writeText')
    .mockResolvedValue();
  const user = setupUser();
  render(<ReportHeader report={report} />);

  await user.click(page.getByRole('button', { name: 'Copy as Markdown' }));

  expect(writeText).toHaveBeenCalledWith(formatReportAsMarkdown(report));
  await expect
    .element(page.getByText('Report copied as Markdown'))
    .toBeInTheDocument();
});

test('shows an error when clipboard access fails', async () => {
  vi.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(
    new Error('clipboard unavailable')
  );
  const user = setupUser();
  render(<ReportHeader report={report} />);

  await user.click(page.getByRole('button', { name: 'Copy as Markdown' }));

  await expect
    .element(page.getByText('Could not copy report'))
    .toBeInTheDocument();
});

test('hides the action when a report has no content', async () => {
  render(<ReportHeader report={{ ...report, reportData: null }} />);

  await expect
    .element(page.getByRole('button', { name: 'Copy as Markdown' }))
    .not.toBeInTheDocument();
});

test('keeps the title and copy action within desktop and mobile viewports', async () => {
  render(<ReportHeader report={report} />);
  const button = page.getByRole('button', { name: 'Copy as Markdown' });

  for (const [width, height] of [
    [1280, 800],
    [390, 844],
  ] as const) {
    await page.viewport(width, height);
    await expect.element(button).toBeVisible();
    const header = document.querySelector('header') as HTMLElement;
    expect(header).toBeTruthy();
    expect(header.scrollWidth).toBeLessThanOrEqual(header.clientWidth);
    const copyButton = header.querySelector('button') as HTMLButtonElement;
    expect(copyButton).toBeTruthy();
    expect(copyButton.getBoundingClientRect().right).toBeLessThanOrEqual(width);
  }
});
