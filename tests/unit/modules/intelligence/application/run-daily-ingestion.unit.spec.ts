import { describe, expect, it, vi } from 'vitest';

import type { IntelligenceRepository } from '@/modules/intelligence';
import { createRunDailyIngestionUseCase } from '@/modules/intelligence/application/use-cases/run-daily-ingestion';
import { providerAdapters } from '@/modules/intelligence/infrastructure/providers/provider-registry';
import { toGeneratedId } from '@/modules/kernel';
import type {
  ProviderConfig,
  Workspace,
} from '@/modules/kernel/infrastructure/db/schema';

describe('runDailyIngestion', () => {
  it('skips an enabled provider without configured credentials and records the run', async () => {
    const ingestionRuns: unknown[] = [];
    const workspace = {
      id: 'workspace-1',
      name: 'Raffy',
      companyName: 'Raffy',
      companyDescription: 'Market intelligence',
      subcategory: 'AI',
      timezone: 'America/Los_Angeles',
    } as Workspace;
    const providerConfig = {
      id: 'provider-1',
      workspaceId: workspace.id,
      providerName: 'exa',
      enabled: true,
      credentialsRef: 'EXA_API_KEY',
      config: {},
    } as ProviderConfig;
    const repository = {
      listWorkspaces: vi.fn(async () => [workspace]),
      listEnabledProviderConfigs: vi.fn(async () => [providerConfig]),
      insertIngestionRun: vi.fn(async (input) => {
        ingestionRuns.push(input);
      }),
    } as unknown as IntelligenceRepository;

    const run = createRunDailyIngestionUseCase({
      adapters: providerAdapters,
      clock: { now: () => new Date('2026-06-03T14:00:00.000Z') },
      fetch: vi.fn<typeof fetch>(),
      idGenerator: {
        createId: () => toGeneratedId(`id-${ingestionRuns.length + 1}`),
      },
      repository,
      runtimeConfig: {
        openAiModel: 'gpt-5.4-mini',
        providerCredentials: {},
      },
    });

    const summary = await run();

    expect(summary.providersSkipped).toBe(1);
    expect(summary.providersCompleted).toBe(0);
    expect(repository.insertIngestionRun).toHaveBeenCalledWith(
      expect.objectContaining({
        providerName: 'exa',
        status: 'skipped',
        failureReason: 'missing_provider_credentials',
      })
    );
  });
});
