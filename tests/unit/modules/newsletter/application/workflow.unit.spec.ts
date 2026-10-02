import { Result } from '@swan-io/boxed';
import {
  archiveFixture,
  articleFixture,
  auditFixture,
  finishNewsletter,
  memoryRepository,
  newsletterIds,
  newsletterNow,
  requireOk,
  sourceFixture,
  stateFixture,
} from '@tests/support/newsletter';
import { describe, expect, it, vi } from 'vitest';

import { toUserId } from '@/modules/kernel';
import { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { NewsletterModel } from '@/modules/newsletter';
import {
  createNewsletterUseCases,
  createNewsletterWorker,
} from '@/modules/newsletter/testing';

const actor = { workspaceId: 'ws-1', userId: toUserId('reader') };
const permissionChecker = {
  async hasPermission() {
    return Result.Ok({ type: 'permission_granted' as const });
  },
};
function setup(initial = stateFixture()) {
  const memory = memoryRepository(initial);
  const idGenerator = newsletterIds();
  const clock = { now: () => newsletterNow };
  const useCases = createNewsletterUseCases({
    repository: memory.repository,
    archive: archiveFixture,
    permissionChecker,
    idGenerator,
    clock,
  });
  return { ...memory, useCases, idGenerator, clock };
}
describe('Newsletter shared workflow', () => {
  it('gives one reader the shared selection and pins its local runtime', async () => {
    const s = setup();
    const results = await Promise.all([
      s.useCases.select({ ...actor, reportId: 'report-1', angleId: 'angle-1' }),
      s.useCases.select({ ...actor, reportId: 'report-1', angleId: 'angle-1' }),
    ]);
    expect(results.map((r) => requireOk(r).type).sort()).toEqual([
      'queued',
      'selection_conflict',
    ]);
    expect(s.getJobs()).toHaveLength(1);
    expect(s.getJobs()[0]!.runtime.provider).toBe('codex-cli');
  });
  it('checks report-reader authorization and latest-report eligibility', async () => {
    const s = setup();
    expect(
      requireOk(
        await s.useCases.select({
          ...actor,
          reportId: 'old-report',
          angleId: 'angle-1',
        })
      ).type
    ).toBe('latest_report_required');
    const denied = createNewsletterUseCases({
      repository: s.repository,
      archive: archiveFixture,
      clock: s.clock,
      idGenerator: s.idGenerator,
      permissionChecker: {
        async hasPermission() {
          return Result.Ok({ type: 'permission_denied' as const });
        },
      },
    });
    expect(
      requireOk(
        await denied.saveProfile({ ...actor, profile: stateFixture().profile! })
      ).type
    ).toBe('forbidden');
    expect(s.getJobs()).toHaveLength(0);
  });
  it('retains prior snooze history on overrides and abandonment', async () => {
    const s = setup();
    await s.useCases.select({
      ...actor,
      reportId: 'report-1',
      angleId: 'angle-1',
    });
    const selected = s.getState().selections[0]!;
    expect(
      requireOk(
        await s.useCases.select({
          ...actor,
          reportId: 'report-1',
          angleId: 'angle-1',
          replace: true,
        })
      ).type
    ).toBe('override_required');
    await s.useCases.abandon({ ...actor, selectionId: selected.id });
    expect(s.getState().selections[0]!.status).toBe('abandoned');
    expect(
      requireOk(
        await s.useCases.select({
          ...actor,
          reportId: 'report-1',
          angleId: 'angle-1',
        })
      ).type
    ).toBe('queued');
  });
  it('runs a local draft and separate audit, preserving immutable versions', async () => {
    const s = setup();
    await s.useCases.select({
      ...actor,
      reportId: 'report-1',
      angleId: 'angle-1',
    });
    const generate = vi
      .fn<NewsletterModel['generate']>()
      .mockImplementation(async ({ stage }) =>
        Result.Ok(
          JSON.stringify(stage === 'audit' ? auditFixture : articleFixture)
        )
      );
    const worker = createNewsletterWorker({
      repository: s.repository,
      archive: archiveFixture,
      clock: s.clock,
      idGenerator: s.idGenerator,
      model: { generate },
    });
    expect(requireOk(await worker.runNext('hosted')).type).toBe('queue_empty');
    await finishNewsletter(worker);
    expect(generate.mock.calls.map(([c]) => c.stage)).toEqual([
      'drafting',
      'audit',
    ]);
    expect(s.getState().drafts).toHaveLength(1);
    const snooze = s.getState().selections[0]!.snoozedUntil;
    await s.useCases.regenerate({
      ...actor,
      selectionId: s.getState().selections[0]!.id,
      feedback: 'Tighten the opening.',
    });
    await finishNewsletter(worker);
    expect(s.getState().drafts).toHaveLength(2);
    expect(s.getState().selections[0]!.snoozedUntil).toBe(snooze);
    expect(s.getState().drafts[1]!.feedback).toBe('Tighten the opening.');
  });
  it('rejects recap-only drafts after two repairs and releases only initial failures', async () => {
    const s = setup();
    await s.useCases.select({
      ...actor,
      reportId: 'report-1',
      angleId: 'angle-1',
    });
    const generate = vi
      .fn<NewsletterModel['generate']>()
      .mockImplementation(async ({ stage }) =>
        Result.Ok(
          JSON.stringify(
            stage === 'audit'
              ? {
                  ...auditFixture,
                  meaningfulSynthesis: false,
                  issues: ['Recap without meaningful synthesis'],
                }
              : articleFixture
          )
        )
      );
    const worker = createNewsletterWorker({
      repository: s.repository,
      archive: archiveFixture,
      clock: s.clock,
      idGenerator: s.idGenerator,
      model: { generate },
    });
    await finishNewsletter(worker);
    expect(
      generate.mock.calls.filter(([c]) => c.stage === 'repair')
    ).toHaveLength(2);
    expect(s.getState().drafts).toHaveLength(0);
    expect(s.getState().selections[0]!.status).toBe('failed');
    const view = requireOk(await s.useCases.get(actor));
    if (view.type !== 'newsletter_found')
      throw new Error('Expected newsletter');
    expect(view.jobs[0]!.audits).toHaveLength(3);
    expect(view.jobs[0]!.audits[0]!.issues).toContain(
      'Recap without meaningful synthesis'
    );
  });
  it('preserves ready versions and snoozes when regeneration fails', async () => {
    const s = setup();
    await s.useCases.select({
      ...actor,
      reportId: 'report-1',
      angleId: 'angle-1',
    });
    let fail = false;
    const worker = createNewsletterWorker({
      repository: s.repository,
      archive: archiveFixture,
      clock: s.clock,
      idGenerator: s.idGenerator,
      model: {
        async generate({ stage }) {
          return fail
            ? Result.Error(
                new AppError({
                  code: 'UNAVAILABLE',
                  category: 'system',
                  status: 503,
                })
              )
            : Result.Ok(
                JSON.stringify(
                  stage === 'audit' ? auditFixture : articleFixture
                )
              );
        },
      },
    });
    await finishNewsletter(worker);
    const before = s.getState();
    await s.useCases.regenerate({
      ...actor,
      selectionId: before.selections[0]!.id,
      feedback: 'Try again',
    });
    fail = true;
    await finishNewsletter(worker);
    expect(s.getState().selections[0]).toEqual(before.selections[0]);
    expect(s.getState().drafts).toEqual(before.drafts);
  });
  it('researches weak selections within the Workspace budget and stops for unresolved claims', async () => {
    const state = stateFixture();
    state.angles[0]!.verified = false;
    state.angles[0]!.gaps = ['Independent adoption evidence missing'];
    const s = setup(state);
    await s.useCases.select({
      ...actor,
      reportId: 'report-1',
      angleId: 'angle-1',
    });
    const research = vi
      .fn<typeof archiveFixture.research>()
      .mockResolvedValue(Result.Ok([]));
    const worker = createNewsletterWorker({
      repository: s.repository,
      archive: { ...archiveFixture, research },
      clock: s.clock,
      idGenerator: s.idGenerator,
      model: {
        async generate({ stage }) {
          if (stage === 'research-planning')
            return Result.Ok(JSON.stringify({ queries: ['primary evidence'] }));
          return Result.Ok(
            JSON.stringify({
              topics: state.topics,
              angles: state.angles,
              sourceAssessments: [],
            })
          );
        },
      },
    });
    await finishNewsletter(worker);
    expect(research).toHaveBeenCalledWith(
      expect.objectContaining({ pages: 10, timeoutMs: 300000 })
    );
    expect(s.getJobs()[0]!.failure).toContain(
      'Independent adoption evidence missing'
    );
    expect(s.getState().drafts).toHaveLength(0);
    expect(s.getState().selections[0]!.status).toBe('failed');
  });
  it('preserves angle ids and selection history when topics are renamed, split and merged', async () => {
    const s = setup();
    await s.useCases.select({
      ...actor,
      reportId: 'report-1',
      angleId: 'angle-1',
    });
    const selection = s.getState().selections[0]!;
    await s.useCases.correctTopic({
      ...actor,
      topicId: 'topic-1',
      action: 'rename',
      title: 'Patient-intent workflows',
    });
    await s.useCases.correctTopic({
      ...actor,
      topicId: 'topic-1',
      action: 'split',
      title: 'Scheduling',
      sourceIds: ['source-1'],
    });
    const split = s.getState().topics.find((t) => t.id !== 'topic-1')!;
    expect(s.getState().angles[0]!.topicId).toBe(split.id);
    await s.useCases.correctTopic({
      ...actor,
      topicId: split.id,
      action: 'merge',
      targetId: 'topic-1',
    });
    expect(s.getState().angles[0]!.id).toBe('angle-1');
    expect(s.getState().selections[0]).toEqual(selection);
  });
});

describe('Newsletter runtime and history guarantees', () => {
  it('retains captured research in the topic library when acquisition stops with a provider error', async () => {
    const initial = stateFixture();
    initial.angles[0]!.verified = false;
    const s = setup(initial);
    requireOk(
      await s.useCases.select({
        ...actor,
        reportId: 'report-1',
        angleId: 'angle-1',
      })
    );
    const captured = {
      ...sourceFixture,
      id: 'partial-public-capture',
      identity: 'new-public-source',
      newsletterResearch: true,
      researchJobId: s.getJobs()[0]!.id,
    };
    const archive = {
      ...archiveFixture,
      async read() {
        const data = requireOk(await archiveFixture.read('ws-1'));
        if ('type' in data) return Result.Ok(data);
        return Result.Ok({ ...data, sources: [...data.sources, captured] });
      },
      async research() {
        return Result.Error(
          new AppError({
            code: 'PROVIDER_TIMEOUT',
            category: 'system',
            status: 502,
            message: 'Research time limit reached',
          })
        );
      },
    };
    const worker = createNewsletterWorker({
      repository: s.repository,
      archive,
      clock: s.clock,
      idGenerator: s.idGenerator,
      model: {
        async generate() {
          return Result.Ok(JSON.stringify({ queries: ['primary evidence'] }));
        },
      },
    });
    await finishNewsletter(worker);
    expect(s.getState().sources).toContainEqual(captured);
    expect(s.getState().topics[0]!.sourceIds).toContain(captured.id);
    expect(s.getState().drafts).toHaveLength(0);
    expect(s.getState().selections[0]!.status).toBe('failed');
  });
  it('resumes an exhausted repair checkpoint without making a third repair', async () => {
    const s = setup();
    requireOk(
      await s.useCases.select({
        ...actor,
        reportId: 'report-1',
        angleId: 'angle-1',
      })
    );
    const claimed = requireOk(
      await s.repository.claim('local', newsletterNow, 'interrupted')
    );
    if (claimed.type !== 'job_claimed') throw new Error('Expected claimed job');
    requireOk(
      await s.repository.checkpoint(
        claimed.job,
        {
          status: 'queued',
          checkpoint: { ...claimed.job.checkpoint, repairs: 3 },
        },
        'interrupted'
      )
    );
    const generate = vi.fn<NewsletterModel['generate']>();
    const worker = createNewsletterWorker({
      repository: s.repository,
      archive: archiveFixture,
      clock: s.clock,
      idGenerator: s.idGenerator,
      model: { generate },
    });
    await finishNewsletter(worker);
    expect(generate).not.toHaveBeenCalled();
    expect(s.getJobs()[0]!.status).toBe('failed');
    expect(s.getState().drafts).toHaveLength(0);
  });
  it('enriches weak themes with public research and retains counterevidence in an audited version', async () => {
    const initial = stateFixture();
    initial.angles[0]!.verified = false;
    initial.angles[0]!.gaps = ['Evidence of limitations needed'];
    const s = setup(initial);
    requireOk(
      await s.useCases.select({
        ...actor,
        reportId: 'report-1',
        angleId: 'angle-1',
      })
    );
    const limitation =
      'The observed result was limited to participating clinics; effects outside this cohort were not measured.';
    const captured = {
      ...sourceFixture,
      id: 'public-counterevidence',
      identity: 'independent-limitations',
      url: 'https://example.org/limitations',
      content: limitation,
      reportIds: [],
      newsletterResearch: true,
    };
    const claim = {
      text: limitation,
      sourceIds: [captured.id],
      excerpts: [{ sourceId: captured.id, text: limitation }],
      kind: 'fact' as const,
    };
    const article = {
      ...articleFixture,
      markdown:
        articleFixture.markdown +
        `\n\n[Study limitations](${captured.url}): ${limitation}`,
      claims: [...articleFixture.claims, claim],
    };
    const audit = {
      ...auditFixture,
      claimChecks: [
        ...auditFixture.claimChecks,
        {
          text: limitation,
          supported: true,
          explanation: 'Captured study limitations.',
        },
      ],
    };
    let researched = false;
    const archive = {
      ...archiveFixture,
      async read() {
        const data = requireOk(await archiveFixture.read('ws-1'));
        if ('type' in data) return Result.Ok(data);
        return Result.Ok({
          ...data,
          sources: researched ? [...data.sources, captured] : data.sources,
        });
      },
      async research() {
        researched = true;
        return Result.Ok([captured]);
      },
    };
    const stages: string[] = [];
    const worker = createNewsletterWorker({
      repository: s.repository,
      archive,
      clock: s.clock,
      idGenerator: s.idGenerator,
      model: {
        async generate({ stage, prompt }) {
          stages.push(stage);
          if (stage === 'research-planning')
            return Result.Ok(
              JSON.stringify({ queries: ['primary study limitations'] })
            );
          if (stage === 'research-assessment')
            return Result.Ok(
              JSON.stringify({
                topics: initial.topics,
                angles: [
                  {
                    ...initial.angles[0],
                    takeaway:
                      'Intent-aware reminders changed outcomes within participating clinics.',
                    claims: article.claims,
                    sourceIds: ['source-1', captured.id],
                    gaps: [],
                    counterevidence: [limitation],
                  },
                ],
                sourceAssessments: [],
              })
            );
          if (stage === 'research-audit')
            expect(prompt).toContain('Original selection:');
          return Result.Ok(
            JSON.stringify(stage.includes('audit') ? audit : article)
          );
        },
      },
    });
    await finishNewsletter(worker);
    expect(stages).toEqual([
      'research-planning',
      'research-assessment',
      'research-audit',
      'drafting',
      'audit',
    ]);
    expect(s.getState().sources).toEqual(expect.arrayContaining([captured]));
    expect(s.getState().drafts[0]!.claims).toContainEqual(claim);
    expect(s.getState().drafts[0]!.audit.counterevidenceRepresented).toBe(true);
    expect(s.getState().selections[0]!.angleSnapshot!.takeaway).toBe(
      initial.angles[0]!.takeaway
    );
  });
  it.each(['local', 'hosted'] as const)(
    'persists equivalent audited outcomes through the %s runtime with pinned style',
    async (mode) => {
      const state = stateFixture();
      state.profile!.runtime =
        mode === 'local'
          ? { mode, provider: 'claude-code', model: 'fixture-model' }
          : { mode, provider: 'openai', model: 'fixture-model' };
      const s = setup(state);
      requireOk(
        await s.useCases.select({
          ...actor,
          reportId: 'report-1',
          angleId: 'angle-1',
        })
      );
      const profile = structuredClone(state.profile!);
      requireOk(
        await s.repository.mutate('ws-1', (current) => {
          current.profile!.guidance = 'Changed after queueing';
          return Result.Ok({ value: { type: 'changed' } });
        })
      );
      const calls: string[] = [];
      const worker = createNewsletterWorker({
        repository: s.repository,
        archive: archiveFixture,
        clock: s.clock,
        idGenerator: s.idGenerator,
        model: {
          async generate({ stage, runtime, prompt }) {
            calls.push(stage);
            expect(runtime).toEqual(profile.runtime);
            expect(prompt).not.toContain('Changed after queueing');
            return Result.Ok(
              JSON.stringify(stage === 'audit' ? auditFixture : articleFixture)
            );
          },
        },
      });
      await worker.runNext(mode);
      expect(s.getState().drafts).toHaveLength(0);
      expect(s.getJobs()[0]!.checkpoint.article).toEqual(articleFixture);
      // A new worker has no in-memory article or browser state.
      const resumed = createNewsletterWorker({
        repository: s.repository,
        archive: archiveFixture,
        clock: s.clock,
        idGenerator: s.idGenerator,
        model: {
          async generate({ stage }) {
            calls.push(stage);
            return Result.Ok(JSON.stringify(auditFixture));
          },
        },
      });
      await finishNewsletter(resumed, mode);
      expect(calls).toEqual(['drafting', 'audit']);
      expect(s.getState().drafts[0]).toMatchObject({
        ...articleFixture,
        profile,
        runtime: profile.runtime,
      });
    }
  );
  it('backfills idempotently and preserves semantic angle ids through rephrased titles', async () => {
    const initial = stateFixture();
    initial.processedReports = [];
    const s = setup(initial);
    const generation = vi
      .fn<NewsletterModel['generate']>()
      .mockImplementation(async ({ stage }) =>
        Result.Ok(
          JSON.stringify(
            stage === 'theme-audit'
              ? auditFixture
              : {
                  topics: initial.topics,
                  angles: [
                    {
                      ...initial.angles[0],
                      title: 'Intent-aware reminder workflows',
                    },
                  ],
                  sourceAssessments: [
                    {
                      sourceId: 'source-1',
                      authority: 1,
                      explanation: 'Original primary evidence',
                    },
                  ],
                }
          )
        )
      );
    const worker = createNewsletterWorker({
      repository: s.repository,
      archive: archiveFixture,
      clock: s.clock,
      idGenerator: s.idGenerator,
      model: { generate: generation },
    });
    await worker.reconcile('ws-1');
    await worker.reconcile('ws-1');
    expect(s.getJobs()).toHaveLength(1);
    await finishNewsletter(worker);
    expect(s.getState().angles).toHaveLength(1);
    expect(s.getState().angles[0]!.id).toBe('angle-1');
    expect(s.getState().sources[0]!.authorityExplanation).toBe(
      'Original primary evidence'
    );
    expect(s.getState().offerHistory?.[0]!.themes[0]!.policy).toBe(
      'verified-support-momentum-v1'
    );
    await worker.reconcile('ws-1');
    await finishNewsletter(worker);
    expect(generation).toHaveBeenCalledTimes(2);
  });
  it('keeps a separate angle eligible and a previous successful snooze intact after an abandoned override', async () => {
    const state = stateFixture();
    state.angles.push({
      ...state.angles[0]!,
      id: 'another-angle',
      takeaway: 'A different mechanism',
    });
    state.selections.push({
      id: 'earlier',
      reportId: 'older',
      angleId: 'angle-1',
      status: 'ready',
      selectedAt: newsletterNow.toISOString(),
      snoozedUntil: new Date(
        newsletterNow.getTime() + 30 * 86400000
      ).toISOString(),
      overrideReason: '',
      evidenceIdentities: ['original-study'],
      selectedBy: 'reader',
    });
    const s = setup(state);
    const view = requireOk(await s.useCases.get(actor));
    expect(view.type).toBe('newsletter_found');
    if (view.type !== 'newsletter_found')
      throw new Error('Expected newsletter');
    expect(view.state.offers.map((a) => a.id)).toEqual(['another-angle']);
    requireOk(
      await s.useCases.select({
        ...actor,
        reportId: 'report-1',
        angleId: 'angle-1',
        overrideReason: 'Major timely development',
      })
    );
    await s.useCases.abandon({
      ...actor,
      selectionId: s.getState().selections[1]!.id,
    });
    expect(s.getState().selections[0]!.status).toBe('ready');
    expect(
      requireOk(
        await s.useCases.select({
          ...actor,
          reportId: 'report-1',
          angleId: 'angle-1',
        })
      ).type
    ).toBe('override_required');
  });
});
