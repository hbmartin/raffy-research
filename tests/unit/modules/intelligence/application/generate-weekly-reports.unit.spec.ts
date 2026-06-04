import { describe, expect, it, vi } from 'vitest';

import type {
  IntelligenceRepository,
  ReportGenerator,
} from '@/modules/intelligence';
import { createGenerateWeeklyReportsUseCase } from '@/modules/intelligence/application/use-cases/generate-weekly-reports';
import { toGeneratedId } from '@/modules/kernel';
import type {
  WeeklyReport,
  Workspace,
} from '@/modules/kernel/infrastructure/db/schema';

const workspace = {
  id: 'workspace-1',
  name: 'Raffy',
  companyName: 'Raffy',
  companyDescription: 'Market intelligence',
  subcategory: 'AI',
  timezone: 'America/Los_Angeles',
} as Workspace;

describe('generateWeeklyReports', () => {
  it('does not overwrite a successful frozen report', async () => {
    const reportGenerator = {
      generate: vi.fn(),
    } as unknown as ReportGenerator;
    const repository = {
      listWorkspaces: vi.fn(async () => [workspace]),
      findReportByPeriod: vi.fn(
        async () =>
          ({
            id: 'report-1',
            status: 'published',
          }) as WeeklyReport
      ),
      listSourceRecordsForPeriod: vi.fn(),
      updateWeeklyReport: vi.fn(),
      insertWeeklyReport: vi.fn(),
    } as unknown as IntelligenceRepository;

    const generate = createGenerateWeeklyReportsUseCase({
      clock: { now: () => new Date('2026-06-08T15:00:00.000Z') },
      fetch: vi.fn<typeof fetch>(),
      idGenerator: { createId: () => toGeneratedId('generated-id') },
      repository,
      reportGenerator,
      runtimeConfig: {
        openAiModel: 'gpt-5.4-mini',
        providerCredentials: {},
      },
    });

    const summary = await generate();

    expect(summary.skippedFrozen).toBe(1);
    expect(reportGenerator.generate).not.toHaveBeenCalled();
    expect(repository.updateWeeklyReport).not.toHaveBeenCalled();
    expect(repository.insertWeeklyReport).not.toHaveBeenCalled();
  });

  it('records a failed report and sends a Slack alert when configured', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => new Response(null));
    const repository = {
      listWorkspaces: vi.fn(async () => [workspace]),
      findReportByPeriod: vi.fn(async () => null),
      listSourceRecordsForPeriod: vi.fn(async () => []),
      insertWeeklyReport: vi.fn(async (input) => input as WeeklyReport),
      insertWeeklyReportSources: vi.fn(),
      insertSourceSummary: vi.fn(),
    } as unknown as IntelligenceRepository;
    const reportGenerator = {
      generate: vi.fn(async () => {
        throw new Error('OpenAI unavailable');
      }),
    } as unknown as ReportGenerator;

    const generate = createGenerateWeeklyReportsUseCase({
      clock: { now: () => new Date('2026-06-08T15:00:00.000Z') },
      fetch: fetchMock,
      idGenerator: { createId: () => toGeneratedId('report-1') },
      repository,
      reportGenerator,
      runtimeConfig: {
        openAiModel: 'gpt-5.4-mini',
        providerCredentials: {},
        slackAlertWebhookUrl: 'https://hooks.slack.example/alert',
      },
    });

    const summary = await generate();

    expect(summary.failed).toBe(1);
    expect(repository.insertWeeklyReport).toHaveBeenCalledWith(
      expect.objectContaining({
        failureReason: 'OpenAI unavailable',
        status: 'failed',
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      'https://hooks.slack.example/alert',
      expect.objectContaining({ method: 'POST' })
    );
  });
});
