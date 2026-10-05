import { Result } from '@swan-io/boxed';
import { describe, expect, it } from 'vitest';

import { parseCommand } from '@/app/cli/commands';
import { serializeResult } from '@/app/cli/output';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { zPage } from '@/modules/operations';

describe('Raffy command and JSON contract', () => {
  it('keeps recoverable business conflicts successful and tagged', () => {
    expect(
      serializeResult(
        Result.Ok({ type: 'angle_unavailable', reportId: 'version-1' })
      )
    ).toMatchObject({
      schemaVersion: 1,
      kind: 'ok',
      outcome: { type: 'angle_unavailable' },
    });
  });
  it('never serializes causes or secret persistence details', () => {
    const json = JSON.stringify(
      serializeResult(
        Result.Error(
          new AppError({
            code: 'DATABASE_FAILED',
            category: 'system',
            status: 500,
            message: 'secret connection string',
            cause: new Error('secret token'),
            details: { token: 'secret' },
          })
        )
      )
    );
    expect(json).not.toContain('secret');
    expect(JSON.parse(json)).toMatchObject({
      kind: 'error',
      error: { code: 'DATABASE_FAILED', category: 'system' },
    });
  });
  it('keeps starts, selective diagnostics, and explicit human submissions focused', () => {
    expect(
      parseCommand([
        'lab',
        'workflow',
        '--workspace',
        'ws',
        '--key',
        'once',
        '--provider',
        'codex-cli',
      ])
    ).toMatchObject({
      group: 'lab',
      command: 'workflow',
      options: { key: 'once' },
    });
    expect(
      parseCommand([
        'operations',
        'diagnostics',
        '--id',
        'op',
        '--stage',
        'model:report:initial',
      ]).options.stage
    ).toBe('model:report:initial');
    expect(
      parseCommand([
        'research',
        'score',
        '--report',
        'r',
        '--input',
        'scores.json',
        '--human',
      ]).options.human
    ).toBe(true);
    expect(() =>
      parseCommand(['operations', 'execute', '--command', 'arbitrary'])
    ).toThrow();
    expect(() =>
      parseCommand(['pipeline', 'generate', '--secret', 'token'])
    ).toThrow();
  });
  it('accepts doctor flags without requiring the optional check word', () => {
    expect(parseCommand(['doctor', '--profile', 'local']).options.profile).toBe(
      'local'
    );
  });
  it('defaults to compact pagination and rejects excessive pages', () => {
    expect(zPage.parse({})).toEqual({ limit: 20 });
    expect(zPage.parse({ limit: '100' }).limit).toBe(100);
    expect(zPage.safeParse({ limit: 101 }).success).toBe(false);
  });
});
