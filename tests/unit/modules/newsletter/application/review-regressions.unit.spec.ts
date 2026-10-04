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
import type {
  NewsletterJob,
  NewsletterModel,
  ResearchArchive,
} from '@/modules/newsletter';
import { normalizeCheckpoint } from '@/modules/newsletter/domain/checkpoint';
import { processingSignature } from '@/modules/newsletter/domain/processing';
import {
  createNewsletterUseCases,
  createNewsletterWorker,
  zProfile,
} from '@/modules/newsletter/testing';

const actor = { workspaceId: 'ws-1', userId: toUserId('reader') };
function setup(
  initial = stateFixture(),
  archive: ResearchArchive = archiveFixture,
  clock = { now: () => newsletterNow }
) {
  const memory = memoryRepository(initial),
    idGenerator = newsletterIds();
  const useCases = createNewsletterUseCases({
    repository: memory.repository,
    archive,
    clock,
    idGenerator,
    permissionChecker: {
      async hasPermission() {
        return Result.Ok({ type: 'permission_granted' as const });
      },
    },
  });
  const worker = (generate: NewsletterModel['generate']) =>
    createNewsletterWorker({
      repository: memory.repository,
      archive,
      clock,
      idGenerator,
      localOperatorId: 'reader',
      model: { generate },
    });
  const select = () =>
    useCases.select({
      ...actor,
      reportId: 'report-1',
      angleId: 'angle-1',
      overrideReason: 'Approved research scope',
    });
  const checkpoint = async (values: Partial<NewsletterJob>) => {
    const claimed = requireOk(
      await memory.repository.claim(
        'local',
        newsletterNow,
        'seed-checkpoint',
        'reader'
      )
    );
    if (claimed.type !== 'job_claimed') throw new Error('Expected job');
    requireOk(
      await memory.repository.checkpoint(
        claimed.job,
        {
          status: 'queued',
          stage: values.stage ?? claimed.job.stage,
          checkpoint: { ...claimed.job.checkpoint, ...values.checkpoint },
        },
        'seed-checkpoint'
      )
    );
  };
  return { ...memory, useCases, worker, select, checkpoint };
}
const passing: NewsletterModel['generate'] = async ({ stage }) =>
  Result.Ok(
    JSON.stringify(
      stage === 'audit' || stage === 'research-audit'
        ? auditFixture
        : articleFixture
    )
  );
const failure = () =>
  Result.Error(
    new AppError({
      code: 'FIXTURE_FAILURE',
      category: 'system',
      status: 502,
      message: 'Deterministic failure',
    })
  );

describe('Validated review regressions', () => {
  it('excludes a candidate when its final evidence-processing repair is interrupted', async () => {
    let now = newsletterNow;
    const initial = stateFixture();
    initial.sources[0]!.content = sourceFixture.content.repeat(1800);
    initial.angles.push({ ...initial.angles[0]!, id: 'usable-angle' });
    const archive: ResearchArchive = {
      ...archiveFixture,
      async read() {
        const data = requireOk(await archiveFixture.read('ws-1'));
        return Result.Ok(
          'type' in data ? data : { ...data, sources: initial.sources }
        );
      },
    };
    const s = setup(initial, archive, { now: () => now });
    requireOk(await s.useCases.prepareThemes(actor));
    await s.checkpoint({
      checkpoint: { version: 2, processingBatches: [], refreshCompleted: true },
    });
    requireOk(await s.worker(async () => Result.Ok('{')).runNext('local'));
    const [unit, state] = Object.entries(
      s.getJobs()[0]!.checkpoint.repairUnits!
    ).find(([name]) => name.startsWith('evidence:'))!;
    expect(state.candidateId).toBe('angle-1');
    await s.checkpoint({
      checkpoint: { repairUnits: { [unit]: { ...state, repairsUsed: 1 } } },
    });
    const deadline = new Date(now.getTime() + 630000);
    const generate = vi.fn<NewsletterModel['generate']>(async ({ stage }) => {
      expect(stage).toBe('evidence-processing');
      now = new Date(deadline.getTime() + 1);
      return failure();
    });
    expect(
      requireOk(await s.worker(generate).runNext('local', { deadline }))
    ).toMatchObject({ status: 'queued' });
    expect(s.getState().angles[0]!.failed).toBe(true);
    expect(s.getState().angles[1]!.failed).toBeFalsy();
    expect(s.getJobs()[0]!.checkpoint.repairUnits![unit]).toMatchObject({
      repairsUsed: 2,
      exhausted: true,
      requestInFlight: false,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });
  it('records an interrupted final candidate repair while allowing other themes to finish', async () => {
    let now = newsletterNow;
    const initial = stateFixture();
    initial.angles.push({
      ...initial.angles[0]!,
      id: 'usable-angle',
      takeaway: 'A second supported mechanism',
    });
    const s = setup(initial, archiveFixture, { now: () => now });
    requireOk(await s.useCases.prepareThemes(actor));
    await s.checkpoint({
      checkpoint: {
        version: 2,
        processingBatches: [],
        refreshCompleted: true,
        repairUnits: { 'theme:angle-1': { repairsUsed: 1, needsRepair: true } },
      },
    });
    const deadline = new Date(now.getTime() + 630000);
    const generate = vi.fn<NewsletterModel['generate']>(async () => {
      now = new Date(deadline.getTime() + 1);
      return failure();
    });
    expect(
      requireOk(await s.worker(generate).runNext('local', { deadline }))
    ).toMatchObject({ status: 'queued' });
    expect(s.getState().angles[0]!.failed).toBe(true);
    await finishNewsletter(
      s.worker(async () => Result.Ok(JSON.stringify(auditFixture)))
    );
    expect(s.getJobs()[0]!.status).toBe('succeeded');
    expect(s.getState().offers.map((angle) => angle.id)).toEqual([
      'usable-angle',
    ]);
    expect(
      s
        .getFailures()
        .some((entry) => entry.summary.includes('consumed the final repair'))
    ).toBe(true);
  });
  it.each(['failure recording', 'final checkpoint'])(
    'preserves lease loss during %s',
    async (boundary) => {
      const s = setup();
      requireOk(await s.select());
      const checkpoint = s.repository.checkpoint;
      if (boundary === 'failure recording')
        vi.spyOn(s.repository, 'recordFailure').mockResolvedValue(
          Result.Ok({ type: 'lease_lost' })
        );
      else
        vi.spyOn(s.repository, 'checkpoint').mockImplementation(
          async (job, values, token) =>
            values.status
              ? Result.Ok({ type: 'lease_lost' })
              : checkpoint(job, values, token)
        );
      const result = await s
        .worker(
          boundary === 'failure recording' ? async () => failure() : passing
        )
        .runNext('local');
      expect(result.isError()).toBe(true);
      if (result.isError())
        expect(result.getError().code).toBe('NEWSLETTER_LEASE_LOST');
      vi.restoreAllMocks();
    }
  );
  it('deduplicates research captures before evidence slicing and resumes the next batch', async () => {
    const initial = stateFixture();
    initial.angles[0]!.verified = false;
    initial.angles[0]!.gaps = ['Needs research'];
    initial.profile!.runtime.contextWindowTokens = 32000;
    const researchSource = {
      ...sourceFixture,
      id: 'research-1',
      identity: 'research-copy',
      url: 'https://example.org/research',
      content: 'Research discusses the original result. '.repeat(1800),
      reportIds: [],
    };
    const archive: ResearchArchive = {
      ...archiveFixture,
      async read() {
        const value = requireOk(await archiveFixture.read('ws-1'));
        if ('type' in value) return Result.Ok(value);
        return Result.Ok({
          ...value,
          sources: [...value.sources, researchSource],
        });
      },
    };
    const s = setup(initial, archive);
    requireOk(await s.select());
    await s.checkpoint({
      checkpoint: {
        sources: [researchSource],
        researchQueries: ['primary evidence'],
      },
    });
    const worker = s.worker(async ({ stage, prompt }) => {
      expect(stage).toBe('evidence-processing');
      const pieces = JSON.parse(
        prompt.split('Sources: ')[1]!.split('. Repair feedback:')[0]!
      ) as (typeof researchSource)[];
      return Result.Ok(
        JSON.stringify({
          notes: pieces.map((piece) => ({
            sourceId: piece.id,
            passage: piece.content.slice(0, 40),
            authority: 1,
            explanation: 'Exact passage',
            counterevidence: [],
          })),
        })
      );
    });
    requireOk(await worker.runNext('local'));
    const first = s.getJobs()[0]!.checkpoint;
    requireOk(await worker.runNext('local'));
    const second = s.getJobs()[0]!.checkpoint;
    expect(second.evidenceCursor).toBe(first.evidenceCursor! + 1);
    expect(second.evidenceInputSignature).toBe(first.evidenceInputSignature);
    expect(second.evidenceSlices).toEqual(first.evidenceSlices);
    expect(
      first
        .evidenceSlices!.flat()
        .filter(
          (slice) => slice.sourceId === researchSource.id && slice.start === 0
        )
    ).toHaveLength(1);
  });
  it('clears active feedback after a repaired research plan while retaining its failure history', async () => {
    const initial = stateFixture();
    initial.angles[0]!.verified = false;
    initial.angles[0]!.gaps = ['Needs research'];
    const s = setup(initial);
    requireOk(await s.select());
    let plans = 0,
      assessment = '';
    const worker = s.worker(async ({ stage, prompt }) => {
      if (stage === 'research-planning')
        return Result.Ok(
          ++plans === 1
            ? '{'
            : JSON.stringify({ queries: ['primary evidence'] })
        );
      assessment = prompt;
      return failure();
    });
    for (let i = 0; i < 4; i++) requireOk(await worker.runNext('local'));
    expect(plans).toBe(2);
    expect(assessment).toContain('Reassess ONLY');
    expect(assessment).not.toContain('Invalid JSON');
    expect(s.getJobs()[0]!.checkpoint.repairUnits!['research-plan']).toEqual({
      repairsUsed: 1,
      needsRepair: false,
    });
    expect(
      s.getJobs()[0]!.checkpoint.unitFailures!['research-plan']
    ).toHaveLength(1);
  });
  it('updates saved and checkpoint audit signatures, completing a stale verified selection with one reassessment', async () => {
    const initial = stateFixture();
    initial.angles[0]!.auditSignature = 'stale';
    const s = setup(initial);
    requireOk(await s.select());
    const generate = vi.fn(passing);
    await finishNewsletter(s.worker(generate));
    expect(
      generate.mock.calls.filter(([input]) => input.stage === 'research-audit')
    ).toHaveLength(1);
    expect(s.getJobs()[0]!.status).toBe('succeeded');
    expect(s.getJobs()[0]!.checkpoint.angle!.auditSignature).toBe(
      s.getState().angles[0]!.auditSignature
    );
    expect(s.getJobs()[0]!.checkpoint.angle!.supportAudit).toEqual(
      auditFixture
    );
  });
  it.each([
    {
      stage: 'repair-exhausted',
      checkpoint: { repairs: 2 },
      label: 'legacy count two',
    },
    {
      stage: 'repair',
      checkpoint: { repairs: 1 },
      label: 'ambiguous legacy dispatch',
    },
    {
      stage: 'repair',
      checkpoint: {
        version: 2 as const,
        repairUnits: {
          draft: { repairsUsed: 2, needsRepair: true, requestInFlight: true },
        },
      },
      label: 'dispatched final repair',
    },
  ])('rejects $label before any model call', async ({ stage, checkpoint }) => {
    const s = setup();
    requireOk(await s.select());
    await s.checkpoint({
      stage,
      checkpoint: {
        ...checkpoint,
        version: 'version' in checkpoint ? checkpoint.version : undefined,
      },
    });
    const generate = vi.fn(passing);
    expect(requireOk(await s.worker(generate).runNext('local'))).toMatchObject({
      status: 'failed',
    });
    expect(generate).not.toHaveBeenCalled();
  });
  it('executes a legitimately pending second repair and retains its reservation across resume', async () => {
    const s = setup();
    requireOk(await s.select());
    await s.checkpoint({
      stage: 'repair',
      checkpoint: {
        version: 2,
        repairs: 1,
        repairUnits: {
          draft: {
            repairsUsed: 1,
            needsRepair: true,
            issues: ['Revise the opening'],
            rejected: 'rejected',
          },
        },
      },
    });
    const generate = vi.fn(passing);
    await finishNewsletter(s.worker(generate));
    expect(
      generate.mock.calls.filter(([input]) => input.stage === 'repair')
    ).toHaveLength(1);
    expect(s.getJobs()[0]!.checkpoint.repairUnits!.draft!.repairsUsed).toBe(2);
    expect(s.getState().drafts).toHaveLength(1);
  });
  it('fails an interrupted final audit without another model call on resume', async () => {
    let now = newsletterNow;
    const s = setup(stateFixture(), archiveFixture, { now: () => now });
    requireOk(await s.select());
    await s.checkpoint({
      stage: 'auditing',
      checkpoint: {
        version: 2,
        article: articleFixture,
        repairUnits: { draft: { repairsUsed: 2, needsRepair: false } },
      },
    });
    const deadline = new Date(now.getTime() + 630000);
    const generate = vi.fn<NewsletterModel['generate']>(async ({ stage }) => {
      expect(stage).toBe('audit');
      now = new Date(deadline.getTime() + 1);
      return failure();
    });
    expect(
      requireOk(await s.worker(generate).runNext('local', { deadline }))
    ).toMatchObject({ status: 'failed' });
    expect(generate).toHaveBeenCalledTimes(1);
    expect(requireOk(await s.worker(generate).runNext('local')).type).toBe(
      'queue_empty'
    );
  });
  it('finishes a committed draft after a lost final checkpoint without repeating its audit', async () => {
    const s = setup();
    requireOk(await s.select());
    const generate = vi.fn(passing);
    const worker = s.worker(generate);
    requireOk(await worker.runNext('local'));
    const checkpoint = s.repository.checkpoint;
    vi.spyOn(s.repository, 'checkpoint').mockImplementation(
      async (job, values, token) =>
        values.status === 'succeeded'
          ? failure()
          : checkpoint(job, values, token)
    );
    expect((await worker.runNext('local')).isError()).toBe(true);
    expect(s.getState().drafts).toHaveLength(1);
    vi.restoreAllMocks();
    const interrupted = s.getJobs()[0]!;
    requireOk(
      await s.repository.checkpoint(
        interrupted,
        { status: 'queued' },
        interrupted.leaseToken!
      )
    );
    expect(requireOk(await worker.runNext('local'))).toMatchObject({
      status: 'succeeded',
    });
    expect(generate).toHaveBeenCalledTimes(2);
    expect(s.getState().drafts).toHaveLength(1);
  });
  it('shares two repairs across generation and audit failures', async () => {
    const s = setup();
    requireOk(await s.select());
    let generation = 0;
    const generate = vi.fn<NewsletterModel['generate']>(async ({ stage }) => {
      if (stage === 'audit')
        return Result.Ok(
          JSON.stringify({
            ...auditFixture,
            supported: false,
            issues: ['Unsupported'],
          })
        );
      generation++;
      return Result.Ok(generation === 1 ? '{' : JSON.stringify(articleFixture));
    });
    await finishNewsletter(s.worker(generate));
    expect(
      generate.mock.calls.filter(([input]) => input.stage === 'repair')
    ).toHaveLength(2);
    expect(s.getJobs()[0]!.status).toBe('failed');
    expect(s.getState().drafts).toHaveLength(0);
    expect(s.getJobs()[0]!.checkpoint.repairs).toBe(2);
  });
  it.each([1, 2])(
    'counts interrupted dispatched repair %i before deadline resume',
    async (repair) => {
      let now = newsletterNow;
      const deadline = new Date(now.getTime() + 630000);
      const s = setup(stateFixture(), archiveFixture, { now: () => now });
      requireOk(await s.select());
      await s.checkpoint({
        stage: 'repair',
        checkpoint: {
          version: 2,
          repairUnits: {
            draft: { repairsUsed: repair - 1, needsRepair: true },
          },
        },
      });
      const generate = vi.fn<NewsletterModel['generate']>(async () => {
        now = new Date(deadline.getTime() + 1);
        return failure();
      });
      const result = requireOk(
        await s.worker(generate).runNext('local', { deadline })
      );
      expect(result).toMatchObject({
        status: repair === 2 ? 'failed' : 'queued',
      });
      expect(s.getJobs()[0]!.checkpoint.repairUnits!.draft).toMatchObject({
        repairsUsed: repair,
        requestInFlight: true,
      });
      expect(generate).toHaveBeenCalledTimes(1);
      if (repair === 1) {
        await finishNewsletter(s.worker(passing));
        expect(s.getJobs()[0]!.checkpoint.repairUnits!.draft!.repairsUsed).toBe(
          2
        );
      }
    }
  );
  it('cancellation before dispatch consumes no repair, and provider timeouts at an expired deadline yield', async () => {
    const s = setup();
    requireOk(await s.select());
    await s.checkpoint({
      stage: 'repair',
      checkpoint: {
        version: 2,
        repairUnits: { draft: { repairsUsed: 1, needsRepair: true } },
      },
    });
    const generate = vi.fn(passing);
    expect(
      requireOk(
        await s.worker(generate).runNext('local', { deadline: newsletterNow })
      )
    ).toMatchObject({ status: 'queued' });
    expect(generate).not.toHaveBeenCalled();
    expect(s.getJobs()[0]!.checkpoint.repairUnits!.draft!.repairsUsed).toBe(1);
  });
  it('fails token capacity immediately without dispatching repairs and preserves diagnostics', async () => {
    const s = setup();
    requireOk(await s.select());
    const generate = vi.fn<NewsletterModel['generate']>(async () =>
      Result.Error(
        new AppError({
          code: 'NEWSLETTER_OUTPUT_LIMIT',
          category: 'system',
          status: 422,
          message: 'Cap exhausted',
          details: { partialText: 'truncated' },
        })
      )
    );
    await finishNewsletter(s.worker(generate));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(s.getJobs()[0]!.failure).toContain('NEWSLETTER_OUTPUT_LIMIT');
    expect(JSON.stringify(s.getFailures())).toContain('truncated');
  });
  it('keeps saved draft readiness through a failed revision retry and rejects concurrent attempts', async () => {
    const s = setup();
    requireOk(await s.select());
    await finishNewsletter(s.worker(passing));
    const selectionId = s.getState().selections[0]!.id;
    requireOk(
      await s.useCases.regenerate({
        ...actor,
        selectionId,
        feedback: 'New opening',
      })
    );
    await finishNewsletter(s.worker(async () => failure()));
    const failed = s.getJobs().find((job) => job.status === 'failed')!;
    expect(
      requireOk(await s.useCases.retry({ ...actor, jobId: failed.id })).type
    ).toBe('queued');
    expect(s.getState().selections[0]!.status).toBe('ready');
    expect(
      requireOk(
        await s.useCases.regenerate({
          ...actor,
          selectionId,
          feedback: 'Conflicting revision',
        })
      ).type
    ).toBe('selection_conflict');
    await finishNewsletter(s.worker(async () => failure()));
    expect(s.getState().selections[0]!.status).toBe('ready');
    expect(s.getState().drafts).toHaveLength(1);
  });
  it('calculates warnings for saved evidence retired from working state using the live archive', async () => {
    const initial = stateFixture();
    initial.sources = [];
    initial.drafts = [
      {
        ...articleFixture,
        id: 'saved',
        selectionId: 'selection',
        createdAt: newsletterNow.toISOString(),
        sources: [sourceFixture],
        profile: initial.profile!,
        audit: auditFixture,
        auditHistory: [auditFixture],
        feedback: '',
        runtime: initial.profile!.runtime,
        jobId: 'original',
      },
    ];
    const s = setup(initial);
    const result = requireOk(await s.useCases.get(actor));
    expect(result).toMatchObject({
      type: 'newsletter_found',
      warnings: { saved: [] },
    });
  });
  it('folds ten maximum-size valid samples resumably without growing combined style or losing explicit rules', async () => {
    const initial = stateFixture();
    initial.profile!.runtime.contextWindowTokens = 32000;
    initial.profile!.samples = Array.from({ length: 10 }, (_, i) =>
      (`Rule ${i}: use clear sentences. ` + 'Sample prose '.repeat(3000)).slice(
        0,
        30000
      )
    );
    expect(zProfile.safeParse(initial.profile).success).toBe(true);
    const s = setup(initial);
    requireOk(await s.select());
    let styleCalls = 0,
      finalPrompt = '';
    const generate: NewsletterModel['generate'] = async ({
      stage,
      prompt,
      contextBudget,
      maxOutputTokens,
    }) => {
      expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(
        contextBudget! - maxOutputTokens! - 2048
      );
      if (stage === 'style-processing') {
        styleCalls++;
        const prior = JSON.parse(
          prompt
            .split('Previous rules and patterns: ')[1]!
            .split('. Input ')[0]!
        ) as { rules: { id: string; text: string }[] };
        const match = /Rule (\d+): use clear sentences\./.exec(
          prompt.split('. Input ')[1]!
        );
        const rules = [...prior.rules];
        if (match && !rules.some((rule) => rule.id === match[1]))
          rules.push({ id: match[1]!, text: match[0] });
        return Result.Ok(
          JSON.stringify({
            notes: 'Use clear sentences and a concrete opening.',
            rules,
            coveredRuleIds: prior.rules.map((rule) => rule.id),
          })
        );
      }
      if (stage === 'drafting') finalPrompt = prompt;
      return passing({
        runtime: initial.profile!.runtime,
        prompt,
        stage,
        jobId: 'fixture',
      });
    };
    const worker = s.worker(generate);
    for (let i = 0; i < 100; i++)
      if (requireOk(await worker.runNext('local')).type === 'queue_empty')
        break;
    expect(styleCalls).toBeGreaterThan(30);
    expect(s.getJobs()[0]!.status).toBe('succeeded');
    expect(finalPrompt).toContain(initial.profile!.guidance);
    for (let i = 0; i < 10; i++)
      expect(finalPrompt).toContain(`Rule ${i}: use clear sentences.`);
    expect(
      s.getJobs()[0]!.checkpoint.styleAggregate!.patterns.length
    ).toBeLessThan(1500);
  });
  it('yields for insufficient invocation allowance without dispatch or repair consumption', async () => {
    const s = setup();
    requireOk(await s.select());
    await s.checkpoint({
      checkpoint: {
        version: 3,
        repairUnits: { draft: { repairsUsed: 1, needsRepair: true } },
      },
    });
    const generate = vi.fn(passing);
    const result = requireOk(
      await s.worker(generate).runNext('local', {
        deadline: new Date(newsletterNow.getTime() + 629999),
      })
    );
    expect(result).toMatchObject({
      status: 'queued',
      yieldReason: 'invocation_budget',
    });
    expect(generate).not.toHaveBeenCalled();
    expect(s.getJobs()[0]!.checkpoint.repairUnits!.draft).toMatchObject({
      repairsUsed: 1,
      needsRepair: true,
    });
  });
  it('restores a reservation when persistence consumes the admission margin before dispatch', async () => {
    let now = newsletterNow;
    const s = setup(stateFixture(), archiveFixture, { now: () => now });
    requireOk(await s.select());
    await s.checkpoint({
      checkpoint: {
        version: 3,
        repairUnits: { draft: { repairsUsed: 1, needsRepair: true } },
      },
    });
    const persist = s.repository.checkpoint;
    vi.spyOn(s.repository, 'checkpoint').mockImplementation(
      async (job, values, token) => {
        if (values.checkpoint?.repairUnits?.draft?.requestInFlight)
          now = new Date(newsletterNow.getTime() + 1);
        return persist(job, values, token);
      }
    );
    const generate = vi.fn(passing);
    const result = requireOk(
      await s.worker(generate).runNext('local', {
        deadline: new Date(newsletterNow.getTime() + 630000),
      })
    );
    expect(result).toMatchObject({
      status: 'queued',
      yieldReason: 'invocation_budget',
    });
    expect(generate).not.toHaveBeenCalled();
    expect(s.getJobs()[0]!.checkpoint.repairUnits!.draft).toMatchObject({
      repairsUsed: 1,
      needsRepair: true,
    });
    vi.restoreAllMocks();
  });
  it('caches a successful final repair arriving after deadline, then resumes without redispatch', async () => {
    let now = newsletterNow;
    const s = setup(stateFixture(), archiveFixture, { now: () => now });
    requireOk(await s.select());
    await s.checkpoint({
      checkpoint: {
        version: 3,
        repairUnits: { draft: { repairsUsed: 1, needsRepair: true } },
      },
    });
    const deadline = new Date(now.getTime() + 630000);
    const generate = vi.fn<NewsletterModel['generate']>(async (input) => {
      expect(input.timeoutMs).toBe(600000);
      now = new Date(deadline.getTime() + 1);
      return passing(input);
    });
    expect(
      requireOk(await s.worker(generate).runNext('local', { deadline }))
    ).toMatchObject({ status: 'queued' });
    expect(s.getJobs()[0]!.checkpoint.repairUnits!.draft).toMatchObject({
      repairsUsed: 2,
      requestInFlight: false,
      response: { text: JSON.stringify(articleFixture) },
    });
    const resumed = vi.fn(passing);
    await finishNewsletter(s.worker(resumed));
    expect(s.getJobs()[0]!.status).toBe('succeeded');
    expect(resumed.mock.calls.map(([input]) => input.stage)).toEqual(['audit']);
    expect(s.getState().drafts).toHaveLength(1);
  });
  it('allows condensed evidence above 64KB when its complete audit prompt fits the pinned context', async () => {
    const initial = stateFixture();
    initial.profile!.runtime.contextWindowTokens = 400000;
    const large = Array.from(
      { length: 35 },
      (_, i) => `Passage ${i}: ` + 'retained evidence '.repeat(130)
    );
    initial.sources[0]!.content += large.join('\n');
    const archive = {
      ...archiveFixture,
      async read() {
        const data = requireOk(await archiveFixture.read('ws-1'));
        return Result.Ok(
          'type' in data ? data : { ...data, sources: initial.sources }
        );
      },
    };
    const s = setup(initial, archive);
    requireOk(await s.useCases.prepareThemes(actor));
    await s.checkpoint({
      checkpoint: {
        version: 3,
        refreshCompleted: true,
        processingBatches: [],
        evidenceSlices: [],
        evidenceInputSignature: processingSignature({
          angle: initial.angles[0],
          sources: initial.sources,
        }),
        evidenceNotes: large.map((passage) => ({
          sourceId: 'source-1',
          passage,
          authority: 1,
          explanation: 'Exact captured passage',
          counterevidence: [],
        })),
      },
    });
    const generate = vi.fn<NewsletterModel['generate']>(
      async ({ stage, prompt }) => {
        expect(stage).toBe('theme-audit');
        expect(Buffer.byteLength(prompt)).toBeGreaterThan(64000);
        expect(Buffer.byteLength(prompt)).toBeLessThan(393856);
        return Result.Ok(JSON.stringify(auditFixture));
      }
    );
    await finishNewsletter(s.worker(generate));
    expect(generate).toHaveBeenCalledTimes(1);
    expect(s.getJobs()[0]!.status).toBe('succeeded');
    expect(s.getState().angles[0]!.failed).toBeFalsy();
  });
  it('records capacity for one candidate and prepares another without spending repairs', async () => {
    const initial = stateFixture();
    initial.profile!.runtime.contextWindowTokens = 32000;
    initial.angles[0]!.takeaway = 'oversized takeaway '.repeat(4000);
    initial.angles.push({
      ...initial.angles[0]!,
      id: 'usable-angle',
      takeaway: 'A useful supported mechanism',
    });
    const s = setup(initial);
    requireOk(await s.useCases.prepareThemes(actor));
    await s.checkpoint({
      checkpoint: { version: 3, refreshCompleted: true, processingBatches: [] },
    });
    const generate = vi.fn(async () => Result.Ok(JSON.stringify(auditFixture)));
    await finishNewsletter(s.worker(generate));
    expect(s.getJobs()[0]!.status).toBe('succeeded');
    expect(s.getState().angles[0]!.failed).toBe(true);
    expect(s.getState().offers.map((angle) => angle.id)).toEqual([
      'usable-angle',
    ]);
    expect(generate).toHaveBeenCalledTimes(1);
    expect(
      s.getFailures().some((entry) => entry.summary.includes('bytes'))
    ).toBe(true);
  });
  it.each([undefined, 2] as const)(
    'retains completed legacy style ranges and repair history for checkpoint version %s',
    async (version) => {
      const initial = stateFixture();
      initial.profile!.runtime.contextWindowTokens = 8192;
      initial.profile!.guidance = '';
      initial.profile!.samples = ['sample prose '.repeat(1000)];
      const s = setup(initial);
      requireOk(await s.select());
      const cursor = version === undefined ? 15 : 2;
      await s.checkpoint({
        stage: 'style-processing',
        checkpoint: {
          version,
          styleCursor: cursor,
          styleNotes: Array.from(
            { length: cursor },
            (_, i) => `Completed pattern ${i}`
          ),
          unitRepairs: { 'style:0': 1 },
          legacyRepairBlocked: version === 2 ? true : undefined,
        },
      });
      // The incorrect v2 migration marker came from legacy /20 partitions.
      const job = s.getJobs()[0]!;
      const normalized = normalizeCheckpoint(job);
      expect(normalized.legacyRepairBlocked).toBeUndefined();
      expect(normalized.repairUnits!['style:0']).toMatchObject({
        repairsUsed: 1,
        exhausted: false,
      });
      expect(normalized.stylePlan!.parts[cursor]).toMatchObject({
        sampleIndex: -1,
      });
      expect(normalized.stylePlan!.parts[cursor + 1]!.start).toBe(cursor * 256);
      const generate = vi.fn<NewsletterModel['generate']>(
        async ({ stage, prompt }) => {
          expect(stage).toBe('style-processing');
          expect(prompt).toContain('Completed pattern 0');
          return Result.Ok(
            JSON.stringify({
              notes: 'Integrated completed patterns',
              rules: [],
              coveredRuleIds: [],
            })
          );
        }
      );
      requireOk(await s.worker(generate).runNext('local'));
      expect(generate).toHaveBeenCalledTimes(1);
      expect(s.getJobs()[0]!.checkpoint.styleAggregate!.patterns).toContain(
        'Integrated completed patterns'
      );
      expect(s.getJobs()[0]!.checkpoint.stylePlan!.cursor).toBe(cursor + 1);
    }
  );
  it('preserves version-2 /3 partition offsets rather than reinterpreting its cursor', async () => {
    const s = setup();
    requireOk(await s.select());
    await s.checkpoint({
      checkpoint: {
        version: 2,
        styleCursor: 1,
        styleNotes: ['saved'],
        styleAggregate: { patterns: 'saved', rules: [] },
      },
    });
    const checkpoint = normalizeCheckpoint(s.getJobs()[0]!);
    expect(checkpoint.stylePlan!.layout).toBe('version-2-3');
    expect(checkpoint.stylePlan!.parts[0]!.sampleIndex).toBe(0);
    expect(checkpoint.stylePlan!.parts[1]!.sampleIndex).toBe(1);
    expect(checkpoint.stylePlan!.cursor).toBe(1);
  });
  it('rejects an impossible legacy style cursor explicitly without dispatch', async () => {
    const s = setup();
    requireOk(await s.select());
    await s.checkpoint({
      checkpoint: {
        version: undefined,
        styleCursor: 10000,
        styleNotes: ['preserve me'],
      },
    });
    const generate = vi.fn(passing);
    await finishNewsletter(s.worker(generate));
    expect(generate).not.toHaveBeenCalled();
    expect(s.getJobs()[0]!.failure).toContain('Stored style');
    expect(s.getJobs()[0]!.checkpoint.styleNotes).toEqual(['preserve me']);
  });
  it('partitions escaped Unicode samples by complete UTF-8 prompt bytes with exact range coverage', async () => {
    const initial = stateFixture();
    initial.profile!.runtime.contextWindowTokens = 8192;
    initial.profile!.guidance = '';
    initial.profile!.samples = ['日本語🌸\\"\n'.repeat(350)];
    const s = setup(initial);
    requireOk(await s.select());
    const texts: string[] = [];
    const generate = vi.fn<NewsletterModel['generate']>(
      async ({ stage, prompt }) => {
        expect(stage).toBe('style-processing');
        expect(Buffer.byteLength(prompt)).toBeLessThanOrEqual(2048);
        const input = / range \d+-\d+: ([\s\S]*?)\. Repair feedback:/.exec(
          prompt
        )![1]!;
        texts.push(JSON.parse(input));
        return Result.Ok(
          JSON.stringify({
            notes: 'Clear writing',
            rules: [],
            coveredRuleIds: [],
          })
        );
      }
    );
    for (let i = 0; i < 100; i++) {
      const plan = s.getJobs()[0]!.checkpoint.stylePlan;
      if (plan && plan.cursor === plan.parts.length) break;
      requireOk(await s.worker(generate).runNext('local'));
    }
    expect(texts.join('')).toBe(initial.profile!.samples[0]);
    expect(s.getJobs()[0]!.checkpoint.stylePlan!.cursor).toBe(
      s.getJobs()[0]!.checkpoint.stylePlan!.parts.length
    );
  });
  it('uses stored Ollama allocation for hosted editorial changes and manual enqueue without transferring ownership', async () => {
    const initial = stateFixture();
    initial.profile!.runtime = {
      mode: 'local',
      provider: 'ollama',
      model: 'custom',
      localOperatorId: 'reader',
      contextWindowTokens: 64000,
      contextLimit: {
        provider: 'ollama',
        model: 'custom',
        tokens: 128000,
        origin: 'discovered',
        operatorCeiling: 32000,
      },
    };
    const s = setup(initial);
    const profile = structuredClone(initial.profile!);
    profile.audience = 'New editorial audience';
    profile.runtime.localOperatorId = 'other-editor';
    profile.runtime.contextLimit!.operatorCeiling = 100000;
    expect(
      requireOk(
        await s.useCases.saveProfile({
          workspaceId: 'ws-1',
          userId: toUserId('other-editor'),
          profile,
        })
      ).type
    ).toBe('saved');
    expect(s.getState().profile!.runtime.localOperatorId).toBe('reader');
    expect(s.getState().profile!.runtime.contextLimit!.operatorCeiling).toBe(
      32000
    );
    expect(requireOk(await s.useCases.prepareThemes(actor)).type).toBe(
      'queued'
    );
    expect(s.getJobs()[0]!.budget!.contextTokens).toBe(32000);
    profile.runtime.model = 'changed';
    expect(
      requireOk(await s.useCases.saveProfile({ ...actor, profile })).type
    ).toBe('local_verification_required');
  });
  it.each([
    {
      runtime: {
        mode: 'hosted' as const,
        provider: 'openai' as const,
        model: 'unknown',
      },
      type: 'context_required',
    },
    {
      runtime: {
        mode: 'local' as const,
        provider: 'ollama' as const,
        model: 'unknown',
        contextWindowTokens: 64000,
      },
      type: 'local_allocation_required',
    },
    {
      runtime: {
        mode: 'hosted' as const,
        provider: 'openai' as const,
        model: 'gpt-5',
        contextWindowTokens: -1,
      },
      type: 'budget_invalid',
    },
  ])(
    'shows the actual $type issue without enqueue and permits disabling',
    async ({ runtime, type }) => {
      const initial = stateFixture();
      initial.profile!.runtime = runtime;
      initial.processedReports = [];
      const s = setup(initial);
      expect(
        requireOk(await s.worker(passing).reconcile('ws-1'))
      ).toMatchObject({ type: 'configuration_required', issue: { type } });
      expect(requireOk(await s.useCases.get(actor))).toMatchObject({
        configurationIssue: { type },
      });
      const profile = { ...initial.profile!, enabled: false };
      expect(
        requireOk(await s.useCases.saveProfile({ ...actor, profile })).type
      ).toBe('saved');
      expect(s.getJobs()).toHaveLength(0);
    }
  );
  it('rejects missing completed legacy style outputs instead of dropping samples', async () => {
    const s = setup();
    requireOk(await s.select());
    await s.checkpoint({
      checkpoint: { version: undefined, styleCursor: 1, styleNotes: [] },
    });
    const normalized = normalizeCheckpoint(s.getJobs()[0]!);
    expect(normalized.normalizationIssue).toContain('no recoverable');
    const generate = vi.fn(passing);
    await finishNewsletter(s.worker(generate));
    expect(generate).not.toHaveBeenCalled();
    expect(s.getJobs()[0]!.status).toBe('failed');
  });
});
