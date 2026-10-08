import { Result } from '@swan-io/boxed';
import { createPgliteTestDatabase } from '@tests/server/pglite';
import { eq } from 'drizzle-orm';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { runLinkedinMonitoringCli } from '@/app/linkedin-monitoring/cli';
import {
  createLinkedinMonitoring,
  type LinkedinProviderTask,
  type LinkedinWatchlistRepository,
} from '@/modules/intelligence';
import {
  createLinkedinWatchlistRepository,
  intelligenceDrizzleSchema as schema,
} from '@/modules/intelligence/testing';
import { AppError } from '@/modules/kernel/domain/errors/app-error';

const workspaceId = 'linkedin-ws';
const company = 'https://www.linkedin.com/company/acme/';
const person = 'https://www.linkedin.com/in/alice/';
const selection = {
  workspaceId,
  profiles: [
    {
      url: person,
      name: 'Alice',
      reason: 'Buyer insight',
      evidence: [
        {
          url: 'https://www.linkedin.com/posts/alice-1',
          note: 'Observed discussion',
        },
      ],
    },
  ],
};
const failure = () =>
  new AppError({
    code: 'PROVIDER_HTTP_ERROR',
    category: 'system',
    status: 502,
    message: 'Apify request failed',
  });
function requireOk<T>(result: Result<T, AppError>): T {
  if (result.isError()) throw result.getError();
  return result.get();
}

describe('LinkedIn watchlist transactions and recovery', () => {
  let database: Awaited<ReturnType<typeof createPgliteTestDatabase>>;
  let repository: LinkedinWatchlistRepository;
  let remote: string[];
  let updateCalls: number;
  let failUpdate: boolean;
  let failAfterUpdate: boolean;
  let providerTask: LinkedinProviderTask;

  beforeAll(async () => {
    database = await createPgliteTestDatabase();
  });
  afterAll(async () => {
    await database?.close();
  });
  beforeEach(async () => {
    await database.truncate();
    await database.db.insert(schema.workspace).values({
      id: workspaceId,
      name: 'Buyer coverage',
      companyName: 'Acme',
      companyDescription: 'Medical training',
      subcategory: 'Training',
      icp: 'Medical Affairs leaders',
      gtmFocus: 'AI adoption',
    });
    await database.db.insert(schema.providerConfig).values({
      workspaceId,
      providerName: 'apify',
      enabled: true,
      credentialsRef: 'APIFY_TOKEN',
      config: {
        taskId: 'task-1',
        scheduleId: 'schedule-1',
        maxTotalChargeUsd: 1,
        targetCount: 1,
        historicalRun: 'preserve',
      },
    });
    await database.db.insert(schema.workspaceSocialAccount).values({
      workspaceId,
      platform: 'linkedin',
      profileUrl: company,
      metadata: { original: 'keep' },
    });
    repository = createLinkedinWatchlistRepository({ db: database.db });
    remote = [company];
    updateCalls = 0;
    failUpdate = false;
    failAfterUpdate = false;
    providerTask = {
      inspect: async () => {
        if (failAfterUpdate && updateCalls > 0) return Result.Error(failure());
        return Result.Ok({
          type: 'task_inspected',
          state: { targets: [...remote] },
        });
      },
      updateTargets: async (_reference, targets) => {
        updateCalls++;
        if (failUpdate) return Result.Error(failure());
        remote = [...targets];
        return Result.Ok({ type: 'targets_updated' });
      },
    };
  });
  const service = () =>
    createLinkedinMonitoring({
      repository,
      providerTask,
      clock: { now: () => new Date('2026-10-04T21:00:00Z') },
    });
  const providerConfig = async () =>
    (
      await database.db
        .select()
        .from(schema.providerConfig)
        .where(eq(schema.providerConfig.workspaceId, workspaceId))
    )[0]!.config;
  const accounts = () =>
    database.db
      .select()
      .from(schema.workspaceSocialAccount)
      .where(eq(schema.workspaceSocialAccount.workspaceId, workspaceId));

  it('reads context and plans without changing persistence or remote targets', async () => {
    await database.db
      .insert(schema.workspaceKeyword)
      .values({ workspaceId, keywordString: 'AI training' });
    await database.db
      .insert(schema.workspaceCompetitor)
      .values({ workspaceId, name: 'Competitor' });
    const before = await providerConfig();
    expect(requireOk(await service().context(workspaceId))).toMatchObject({
      type: 'monitoring_context',
      keywords: ['AI training'],
      competitors: [{ name: 'Competitor' }],
      workspace: { icp: 'Medical Affairs leaders' },
    });
    expect(
      requireOk(await service().plan(workspaceId, selection))
    ).toMatchObject({
      type: 'addition_planned',
      profiles: [{ url: person, action: 'add' }],
    });
    expect(await accounts()).toHaveLength(1);
    expect(await providerConfig()).toEqual(before);
    expect(updateCalls).toBe(0);
  });
  it('adds and reuses accounts while preserving companies, configuration and provenance', async () => {
    expect(requireOk(await service().add(workspaceId, selection)).type).toBe(
      'synchronized'
    );
    expect(requireOk(await service().add(workspaceId, selection)).type).toBe(
      'synchronized'
    );
    const rows = await accounts();
    expect(rows).toHaveLength(2);
    expect(rows.find((row) => row.profileUrl === company)!.metadata).toEqual({
      original: 'keep',
    });
    expect(
      rows.find((row) => row.profileUrl === person)!.metadata
        .linkedinMonitoringSelections
    ).toHaveLength(2);
    expect(await providerConfig()).toMatchObject({
      maxTotalChargeUsd: 1,
      targetCount: 2,
      historicalRun: 'preserve',
      linkedinMonitoringPending: null,
    });
    expect(updateCalls).toBe(1);
    expect(requireOk(await service().verify(workspaceId))).toMatchObject({
      type: 'targets_verified',
    });
  });
  it('reactivates canonical matches and retains unrelated metadata', async () => {
    await database.db.insert(schema.workspaceSocialAccount).values({
      workspaceId,
      platform: 'LinkedIn',
      profileUrl: 'http://linkedin.com/in/ALICE?trk=1',
      active: false,
      metadata: { original: 'keep' },
    });
    expect(
      requireOk(await service().plan(workspaceId, selection))
    ).toMatchObject({ profiles: [{ action: 'reactivate' }] });
    requireOk(await service().add(workspaceId, selection));
    const alice = (await accounts()).find((row) => row.profileUrl === person)!;
    expect(alice.active).toBe(true);
    expect(alice.metadata).toMatchObject({
      original: 'keep',
      linkedinMonitoringSelections: [
        { reason: 'Buyer insight', evidence: selection.profiles[0]!.evidence },
      ],
    });
    expect(await accounts()).toHaveLength(2);
  });
  it('commits pending additions before provider failures and refuses new batches until retry', async () => {
    failUpdate = true;
    expect((await service().add(workspaceId, selection)).isError()).toBe(true);
    expect(await accounts()).toHaveLength(2);
    expect(await providerConfig()).toMatchObject({
      linkedinMonitoringPending: {
        baseline: [company],
        intended: [company, person],
        failureCode: 'PROVIDER_HTTP_ERROR',
      },
    });
    expect(requireOk(await service().add(workspaceId, selection)).type).toBe(
      'pending_sync'
    );
    expect(requireOk(await service().verify(workspaceId)).type).toBe(
      'target_drift'
    );
    failUpdate = false;
    expect(requireOk(await service().sync(workspaceId)).type).toBe(
      'synchronized'
    );
    expect(await accounts()).toHaveLength(2);
    expect((await providerConfig()).linkedinMonitoringPending).toBeNull();
  });
  it('recognizes a remote update that succeeded before verification timed out', async () => {
    failAfterUpdate = true;
    expect((await service().add(workspaceId, selection)).isError()).toBe(true);
    expect(remote).toContain(person);
    failAfterUpdate = false;
    expect(requireOk(await service().sync(workspaceId)).type).toBe(
      'synchronized'
    );
    expect(updateCalls).toBe(1);
  });
  it('recovers when remote success was followed by a failed completion transaction', async () => {
    const realRepository = repository;
    repository = {
      ...realRepository,
      withWorkspaceLock: (id, work) =>
        realRepository.withWorkspaceLock(id, (snapshot, writer) =>
          work(snapshot, {
            ...writer,
            saveProviderConfig: (config) =>
              config.linkedinMonitoringPending === null
                ? Promise.resolve(
                    Result.Error(
                      new AppError({
                        code: 'TEST_COMPLETION_FAILED',
                        category: 'system',
                        status: 500,
                      })
                    )
                  )
                : writer.saveProviderConfig(config),
          })
        ),
    };
    expect((await service().add(workspaceId, selection)).isError()).toBe(true);
    expect(remote).toContain(person);
    expect((await providerConfig()).linkedinMonitoringPending).not.toBeNull();
    repository = realRepository;
    expect(requireOk(await service().sync(workspaceId)).type).toBe(
      'synchronized'
    );
    expect(updateCalls).toBe(1);
  });
  it('detects initial and pending drift without overwriting external changes', async () => {
    remote = [company, 'https://www.linkedin.com/in/bob/'];
    expect(requireOk(await service().add(workspaceId, selection)).type).toBe(
      'target_drift'
    );
    expect(await accounts()).toHaveLength(1);
    expect(updateCalls).toBe(0);
    remote = [company];
    failUpdate = true;
    await service().add(workspaceId, selection);
    failUpdate = false;
    remote = [company, 'https://www.linkedin.com/in/bob/'];
    expect(requireOk(await service().sync(workspaceId)).type).toBe(
      'target_drift'
    );
    expect(remote).not.toContain(person);
    expect(updateCalls).toBe(1);
  });
  it('stops on ambiguous accounts, missing workspaces and invalid selections', async () => {
    await database.db.insert(schema.workspaceSocialAccount).values({
      workspaceId,
      platform: 'linkedin',
      profileUrl: 'http://linkedin.com/company/ACME?trk=1',
      active: false,
    });
    expect(requireOk(await service().add(workspaceId, selection)).type).toBe(
      'ambiguous_accounts'
    );
    expect(requireOk(await service().verify('missing')).type).toBe(
      'workspace_not_found'
    );
    expect(requireOk(await service().add('other', selection)).type).toBe(
      'workspace_mismatch'
    );
    expect(
      requireOk(
        await service().add(workspaceId, { ...selection, profiles: [] })
      ).type
    ).toBe('invalid_selection');
    expect(updateCalls).toBe(0);
  });
  it('isolates account writes by workspace', async () => {
    await database.db.insert(schema.workspace).values({
      id: 'other',
      name: 'Other',
      companyName: 'Other',
      companyDescription: 'Other',
      subcategory: 'Other',
    });
    await database.db
      .insert(schema.workspaceSocialAccount)
      .values({ workspaceId: 'other', profileUrl: person, active: false });
    requireOk(await service().add(workspaceId, selection));
    expect(
      (
        await database.db
          .select()
          .from(schema.workspaceSocialAccount)
          .where(eq(schema.workspaceSocialAccount.workspaceId, 'other'))
      )[0]!.active
    ).toBe(false);
  });
  it('serializes concurrent retries and additions with no duplicated account or remote dispatch', async () => {
    failUpdate = true;
    await service().add(workspaceId, selection);
    failUpdate = false;
    const attempts = await Promise.all([
      service().sync(workspaceId),
      service().sync(workspaceId),
      service().add(workspaceId, selection),
    ]);
    expect(attempts.every((attempt) => attempt.isOk())).toBe(true);
    expect(await accounts()).toHaveLength(2);
    expect(updateCalls).toBe(2); // One failed attempt and one successful update.
    expect(requireOk(await service().verify(workspaceId)).type).toBe(
      'targets_verified'
    );
  });
  it('rolls back account writes if pending-state persistence fails', async () => {
    const realRepository = repository;
    repository = {
      ...realRepository,
      withWorkspaceLock: (id, work) =>
        realRepository.withWorkspaceLock(id, (snapshot, writer) =>
          work(snapshot, {
            ...writer,
            saveProviderConfig: () =>
              Promise.resolve(
                Result.Error(
                  new AppError({
                    code: 'TEST_STAGE_FAILED',
                    category: 'system',
                    status: 500,
                  })
                )
              ),
          })
        ),
    };
    expect((await service().add(workspaceId, selection)).isError()).toBe(true);
    expect(await accounts()).toHaveLength(1);
    expect(updateCalls).toBe(0);
  });

  it('runs the CLI contract against local persistence and writes a reviewable audit artifact', async () => {
    const directory = await mkdtemp(
      path.join(tmpdir(), 'linkedin-cli-fixture-')
    );
    const inputPath = path.join(directory, 'selection.json');
    const auditPath = path.join(directory, 'add.json');
    try {
      await writeFile(inputPath, JSON.stringify(selection));
      const io = {
        readInput: async (file: string) =>
          JSON.parse(await readFile(file, 'utf8')) as unknown,
        createAudit: async () => ({
          path: auditPath,
          write: (value: unknown) =>
            writeFile(auditPath, JSON.stringify(value)),
        }),
      };
      const planned = await runLinkedinMonitoringCli(
        { command: 'plan', workspaceId, inputPath },
        service(),
        io
      );
      expect(planned.exitCode).toBe(0);
      expect(await accounts()).toHaveLength(1);
      const added = await runLinkedinMonitoringCli(
        { command: 'add', workspaceId, inputPath },
        service(),
        io
      );
      expect(added.exitCode).toBe(0);
      const audit = JSON.parse(await readFile(auditPath, 'utf8'));
      expect(audit).toMatchObject({
        schemaVersion: 1,
        workspaceId,
        outcome: { type: 'synchronized' },
        selectedProfiles: selection.profiles,
      });
      expect(audit).not.toHaveProperty('credentials');
      expect(
        (
          await runLinkedinMonitoringCli(
            { command: 'verify', workspaceId },
            service(),
            io
          )
        ).exitCode
      ).toBe(0);
      failUpdate = true;
      await writeFile(
        inputPath,
        JSON.stringify({
          workspaceId,
          profiles: [{ url: 'https://www.linkedin.com/in/bob/' }],
        })
      );
      const failed = await runLinkedinMonitoringCli(
        { command: 'add', workspaceId, inputPath },
        service(),
        io
      );
      expect(failed.exitCode).toBe(1);
      expect(failed.summary).toMatchObject({
        pendingSync: {
          status: 'pending',
          record: { failureCode: 'PROVIDER_HTTP_ERROR' },
        },
      });
      expect(
        (
          await runLinkedinMonitoringCli(
            { command: 'verify', workspaceId },
            service(),
            io
          )
        ).exitCode
      ).toBe(2);
      failUpdate = false;
      expect(
        (
          await runLinkedinMonitoringCli(
            { command: 'sync', workspaceId },
            service(),
            io
          )
        ).exitCode
      ).toBe(0);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
