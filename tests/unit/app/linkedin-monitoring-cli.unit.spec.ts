import { Result } from '@swan-io/boxed';
import { describe, expect, it, vi } from 'vitest';

import {
  parseLinkedinMonitoringArgs,
  runLinkedinMonitoringCli,
} from '@/app/linkedin-monitoring/cli';
import type { createLinkedinMonitoring } from '@/modules/intelligence';
import { AppError } from '@/modules/kernel/domain/errors/app-error';

describe('LinkedIn monitoring CLI contract', () => {
  it('requires explicit workspace and input only for selection commands', () => {
    expect(
      parseLinkedinMonitoringArgs([
        'add',
        '--workspace=ws',
        '--input=selection.json',
      ])
    ).toMatchObject({
      type: 'arguments_valid',
      command: 'add',
      workspaceId: 'ws',
      inputPath: 'selection.json',
    });
    for (const args of [
      ['context'],
      ['add', '--workspace', 'ws'],
      ['verify', '--workspace', 'ws', '--input', 'x'],
      ['remove', '--workspace', 'ws'],
    ])
      expect(parseLinkedinMonitoringArgs(args).type).toBe('invalid_arguments');
    expect(parseLinkedinMonitoringArgs(['--help']).type).toBe('help');
    expect(
      parseLinkedinMonitoringArgs([
        'context',
        '--workspace',
        'ws',
        '--secret',
        'token',
      ]).type
    ).toBe('invalid_arguments');
  });
  const service = (): ReturnType<typeof createLinkedinMonitoring> => ({
    context: vi.fn(),
    plan: vi.fn(),
    add: vi.fn(),
    sync: vi.fn(),
    verify: vi.fn(),
  });
  it('leaves read-only commands without audit writes and returns review-required differences', async () => {
    const api = service();
    vi.mocked(api.verify).mockResolvedValue(
      Result.Ok({
        type: 'target_drift',
        databaseTargets: [],
        remoteTargets: ['https://www.linkedin.com/in/alice/'],
      })
    );
    const io = { readInput: vi.fn(), createAudit: vi.fn() };
    const response = await runLinkedinMonitoringCli(
      { command: 'verify', workspaceId: 'ws' },
      api,
      io
    );
    expect(response.exitCode).toBe(2);
    expect(response.summary).toMatchObject({
      schemaVersion: 1,
      command: 'verify',
      outcome: { type: 'target_drift' },
    });
    expect(io.createAudit).not.toHaveBeenCalled();
    expect(api.add).not.toHaveBeenCalled();
  });
  it('reserves audit before mutation, records authorized selection and sanitizes errors', async () => {
    const api = service();
    const error = new AppError({
      code: 'PROVIDER_HTTP_ERROR',
      category: 'system',
      status: 502,
      message: 'Apify request failed',
      cause: 'private-token',
      details: { unsafe: 'private-token' },
    });
    vi.mocked(api.add).mockResolvedValue(Result.Error(error));
    vi.mocked(api.context).mockResolvedValue(
      Result.Ok({ type: 'workspace_not_found' })
    );
    const write = vi.fn();
    const createAudit = vi.fn(async () => ({ path: '/tmp/audit.json', write }));
    const io = {
      readInput: vi.fn(async () => ({
        workspaceId: 'ws',
        profiles: [{ url: 'http://linkedin.com/in/ALICE?trk=1' }],
      })),
      createAudit,
    };
    const response = await runLinkedinMonitoringCli(
      { command: 'add', workspaceId: 'ws', inputPath: 'selection.json' },
      api,
      io
    );
    expect(createAudit.mock.invocationCallOrder[0]!).toBeLessThan(
      vi.mocked(api.add).mock.invocationCallOrder[0]!
    );
    expect(response.exitCode).toBe(1);
    expect(response.summary).toMatchObject({
      auditPath: '/tmp/audit.json',
      pendingSync: { status: 'unknown' },
      recoveryCommand: 'pnpm linkedin:monitoring sync --workspace ws',
    });
    expect(write).toHaveBeenCalledWith(
      expect.objectContaining({
        selectedProfiles: [{ url: 'https://www.linkedin.com/in/alice/' }],
      })
    );
    expect(JSON.stringify(response.summary)).not.toContain('private-token');
  });
  it('does not mutate if the audit location cannot be reserved', async () => {
    const api = service();
    await expect(
      runLinkedinMonitoringCli({ command: 'sync', workspaceId: 'ws' }, api, {
        readInput: vi.fn(),
        createAudit: vi.fn().mockRejectedValue(new Error('disk unavailable')),
      })
    ).rejects.toThrow('disk unavailable');
    expect(api.sync).not.toHaveBeenCalled();
  });
});
