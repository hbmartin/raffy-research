import { Result } from '@swan-io/boxed';
import { createPgliteTestDatabase } from '@tests/server/pglite';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { promisify } from 'node:util';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import {
  authDrizzleSchema,
  createMachineCredentials,
} from '@/modules/auth/testing';
import { intelligenceDrizzleSchema as schema } from '@/modules/intelligence/testing';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import { createOperationRepository } from '@/modules/operations/testing';

const execute = promisify(execFile);
const ok = <T>(result: Result<T, AppError>): T => {
  if (result.isError()) throw result.getError();
  return result.get();
};

describe('Repository CLI and detached worker with deterministic native model', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>,
    directory: string,
    environment: NodeJS.ProcessEnv;
  const cli = async (...args: string[]) => {
    const output = await execute(
      process.execPath,
      [resolve('run-jiti'), resolve('scripts/raffy.ts'), ...args],
      { env: environment, timeout: 30_000 }
    );
    return JSON.parse(output.stdout.trim());
  };
  beforeAll(async () => {
    database = await createPgliteTestDatabase();
    await database.truncate();
    directory = await mkdtemp(join(tmpdir(), 'raffy-cli-'));
    await mkdir(join(directory, 'bin'));
    await mkdir(join(directory, 'raffy'), { mode: 0o700 });
    const model = `#!/usr/bin/env node
if(process.argv.includes('--help')) { console.log('--tools --safe-mode --restricted --strict-mcp-config --setting-sources --no-session-persistence --permission-prompts'); process.exit(0); }
let prompt=''; for await (const chunk of process.stdin) prompt+=chunk;
const answer=prompt.includes('Evaluator prompt version') ? {scores:{claim_support:5,coverage:4,noise:5},violations:[],missed_signals:[],summary:'Fixture verdict'} : prompt.startsWith('Summarize this') ? {summary:'Preserved evidence summary',evidence_candidate:'The adoption study reports sustained buyer interest.'} : {title:'Fixture report',executive_summary:{bullets:['Evidence one','Evidence two','Evidence three']},source_library:[{source_id:'source-fixture',relation_type:'cited'}]};
console.log(JSON.stringify({type:'result',is_error:false,result:process.argv.includes('fixture-bad-judge') ? 'malformed judge response' : JSON.stringify(answer)}));
`;
    await writeFile(join(directory, 'bin', 'claude'), model, { mode: 0o700 });
    await database.db.insert(authDrizzleSchema.user).values({
      id: 'manager',
      name: 'Manager',
      email: 'manager@example.test',
      emailVerified: true,
      role: 'admin',
    });
    await database.db.insert(schema.workspace).values({
      id: 'ws-fixture',
      name: 'Fixture',
      companyName: 'Fixture',
      companyDescription: 'Evidence fixtures',
      subcategory: 'Software',
      timezone: 'UTC',
    });
    await database.db.insert(schema.sourceRecord).values({
      id: 'source-fixture',
      workspaceId: 'ws-fixture',
      providerName: 'exa',
      sourceType: 'web_page',
      title: 'Adoption study',
      contentText: 'The adoption study reports sustained buyer interest.',
      externalUrl: 'https://example.test/study',
      publishedAt: new Date('2026-10-01T12:00:00Z'),
    });
    const auth = createMachineCredentials(database.db),
      credential = ok(
        await auth.begin({
          name: 'Fixture worker',
          capabilities: ['research', 'newsletter', 'pipeline', 'lab'],
        })
      );
    await auth.approve({
      id: credential.id,
      code: credential.code,
      userId: 'manager',
      approve: true,
    });
    await writeFile(
      join(directory, 'raffy', 'fixture.json'),
      JSON.stringify({
        id: credential.id,
        secret: credential.secret,
        baseUrl: 'http://localhost:3000',
      }),
      { mode: 0o600 }
    );
    environment = {
      ...process.env,
      XDG_CONFIG_HOME: directory,
      DATABASE_URL: inject('pgliteTestDatabaseUrl'),
      DATABASE_DRIVER: 'node-pg',
      PATH: `${join(directory, 'bin')}:${process.env.PATH}`,
      LOCAL_AI_PROVIDER: 'claude-code',
      LOCAL_AI_MODEL: 'fixture-model',
      LOCAL_AI_RAW_OUTPUT_DIR: join(directory, 'raw'),
      NODE_ENV: 'test',
    };
  });
  afterAll(async () => {
    await cli('worker', 'stop', '--profile', 'fixture').catch(() => undefined);
    await delay(1500);
    await database?.close();
    await rm(directory, { recursive: true, force: true });
  });
  it('returns promptly, survives shell exit, publishes once, and evaluates its own version', async () => {
    const args = [
      'lab',
      'workflow',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture',
      '--period',
      '2026-10-04',
      '--source-ids',
      'source-fixture',
      '--key',
      'workflow-fixture',
    ];
    const started = await cli(...args);
    expect(started).toMatchObject({
      schemaVersion: 1,
      kind: 'ok',
      outcome: { type: 'operation_queued' },
    });
    const operationId = started.outcome.operationId;
    expect((await cli(...args)).outcome).toMatchObject({
      type: 'operation_exists',
      operationId,
    });
    const repository = createOperationRepository(database.db);
    let operation;
    for (let i = 0; i < 150; i++) {
      const found = ok(await repository.get('manager', operationId));
      if (found.type === 'operation_found') operation = found.operation;
      if (
        operation?.status === 'succeeded' ||
        operation?.status === 'failed' ||
        operation?.status === 'reconciliation_required'
      )
        break;
      await delay(100);
    }
    if (operation?.status !== 'succeeded')
      throw new Error(
        JSON.stringify({
          operation,
          log: await readFile(
            join(directory, 'raffy', 'fixture.worker.log'),
            'utf8'
          ),
        })
      );
    expect(operation.result).toMatchObject({
      type: 'workflow_completed',
      reportId: expect.any(String),
      evaluation: { reportId: operation.result?.reportId },
    });
    const reports = await database.db.select().from(schema.weeklyReport);
    expect(reports).toHaveLength(1);
    expect(reports[0]?.status).toBe('published');
    const summaries = await database.db.select().from(schema.sourceSummary);
    expect(summaries).toHaveLength(1);
    const judgments = await database.db.select().from(schema.judgmentRecord);
    expect(judgments).toHaveLength(1);
    expect(judgments[0]).toMatchObject({
      targetId: reports[0]!.id,
      provenance: { origin: 'automated' },
    });
    const listed = await cli(
      'research',
      'reports',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture'
    );
    expect(JSON.stringify(listed)).not.toContain('executive_summary');
    const detail = await cli(
      'research',
      'report',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture',
      '--report',
      reports[0]!.id,
      '--section',
      'executive_summary'
    );
    expect(detail.outcome.content.bullets).toHaveLength(3);
    const scoreFile = join(directory, 'scores.json');
    await writeFile(
      scoreFile,
      JSON.stringify({
        relevance: 4,
        accuracy: 5,
        novelty: 3,
        note: 'Assistant rationale',
      })
    );
    const recommended = await cli(
      'research',
      'recommend',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture',
      '--report',
      reports[0]!.id,
      '--input',
      scoreFile,
      '--agent',
      'fixture-agent'
    );
    expect(recommended.outcome.judgment.provenance.origin).toBe('assistant');
    expect(
      await database.db.select().from(schema.reportRubricScore)
    ).toHaveLength(0);
    await cli(
      'research',
      'promote',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture',
      '--id',
      recommended.outcome.judgment.id,
      '--human'
    );
    expect(
      await database.db.select().from(schema.reportRubricScore)
    ).toHaveLength(1);
    const history = await cli(
      'research',
      'judgments',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture',
      '--target',
      reports[0]!.id
    );
    expect(
      history.outcome.judgments.map(
        (item: { provenance: { origin: string } }) => item.provenance.origin
      )
    ).toEqual(['human', 'assistant', 'automated']);
    const invalid = await cli(
      'lab',
      'evaluate',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture',
      '--report',
      reports[0]!.id,
      '--model',
      'fixture-bad-judge',
      '--provider',
      'claude-code',
      '--key',
      'invalid-evaluation'
    );
    let invalidOperation;
    for (let i = 0; i < 150; i++) {
      const found = ok(
        await repository.get('manager', invalid.outcome.operationId)
      );
      if (found.type === 'operation_found') invalidOperation = found.operation;
      if (invalidOperation?.status === 'failed') break;
      await delay(100);
    }
    expect(invalidOperation).toMatchObject({
      status: 'failed',
      result: {
        type: 'evaluation_invalid',
        reportId: reports[0]!.id,
        rawOutput: 'malformed judge response',
      },
    });
    expect(await database.db.select().from(schema.judgmentRecord)).toHaveLength(
      3
    );
    const labeled = await cli(
      'research',
      'label',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture',
      '--source',
      'source-fixture',
      '--label',
      'junk',
      '--rationale',
      'Fixture editorial judgment'
    );
    expect(labeled.outcome.judgmentId).toEqual(expect.any(String));
    const labelHistory = await cli(
      'research',
      'judgments',
      '--profile',
      'fixture',
      '--workspace',
      'ws-fixture',
      '--target',
      'source-fixture'
    );
    expect(labelHistory.outcome.judgments).toHaveLength(1);
    expect(labelHistory.outcome.judgments[0].provenance).toMatchObject({
      origin: 'assistant',
      channel: 'cli',
      rationale: 'Fixture editorial judgment',
    });
  }, 60_000);
});
