import { Result } from '@swan-io/boxed';
import { match, P } from 'ts-pattern';

import type { Clock, IdGenerator, PermissionChecker } from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { UserId } from '@/modules/kernel/domain/ids';

import type {
  NewsletterRepository,
  ResearchArchive,
} from './application/ports';
import type { MutationContext } from './application/ports';
import {
  angleEligible,
  DAY_MS,
  type DraftVersion,
  exportDraft,
  hasStyle,
  type NewsletterJob,
  type NewsletterProfile,
  type NewsletterState,
  rankThemes,
  sourceWarnings,
  type Theme,
  zArticle,
} from './domain/newsletter';
import {
  DEFAULT_HOSTED_OUTPUT_TOKENS,
  knownContextLimit,
  resolveGenerationBudget,
  resolveTopicRoot,
} from './domain/processing';

type Deps = {
  provenance?: import('@/modules/intelligence').JudgmentProvenance;
  requireDispatchReconciliation?: boolean;
  repository: NewsletterRepository;
  archive: ResearchArchive;
  permissionChecker: PermissionChecker;
  clock: Clock;
  idGenerator: IdGenerator;
  discoverContextBudget?: (
    runtime: NewsletterProfile['runtime']
  ) => Promise<
    ApplicationResult<
      { type: 'context_found'; tokens: number } | { type: 'context_unknown' }
    >
  >;
  operatorContextCeiling?: () => number | undefined;
  localOperatorId?: string;
};
export type NewsletterView = {
  type: 'newsletter_found';
  audienceSuggestion: string;
  state: NewsletterState;
  jobs: import('./domain/newsletter').JobSummary[];
  snoozed: Theme[];
  warnings: Record<string, string[]>;
  configurationIssue: import('./domain/processing').BudgetIssue | null;
  generationBudget: import('./domain/newsletter').GenerationBudget | null;
};
type GetOutcome = NewsletterView | { type: 'workspace_not_found' };
type ExportOutcome =
  | { type: 'draft_exported'; text: string; warnings: string[] }
  | { type: 'not_found' }
  | { type: 'workspace_not_found' };
type Outcome =
  | { type: 'saved'; jobIds?: string[] }
  | { type: 'queued'; jobId: string; selectionId?: string }
  | { type: 'forbidden' }
  | { type: 'workspace_not_found' }
  | { type: 'selection_conflict' }
  | { type: 'latest_report_required' }
  | { type: 'style_required' }
  | { type: 'angle_unavailable' }
  | { type: 'override_required' }
  | { type: 'not_found' }
  | { type: 'invalid_correction' }
  | { type: 'no_active_decision' }
  | import('@/modules/intelligence').EquivalenceConflict
  | import('./domain/processing').BudgetIssue;
const currentAssignments = (
  state: NewsletterState,
  sourceIds: string[],
  topicId: string
) => {
  state.assignments ??= {};
  for (const id of sourceIds) state.assignments[id] = topicId;
};
export function createNewsletterUseCases(deps: Deps) {
  const mutate = <T>(
    workspaceId: string,
    actorId: string,
    action: string,
    work: (
      state: NewsletterState,
      context: MutationContext
    ) => ApplicationResult<import('./application/ports').Mutation<T>>
  ) =>
    deps.repository.mutate(workspaceId, work, undefined, {
      content: false,
      drafts: false,
      decision: {
        actorId,
        action,
        provenance: {
          ...deps.provenance,
          origin: deps.provenance?.origin ?? 'human',
          channel: deps.provenance?.channel ?? 'web',
          actorId,
        },
      },
    });
  const profileBudget = (runtime: NewsletterProfile['runtime']) =>
    resolveGenerationBudget(runtime);
  const makeJob = (
    workspaceId: string,
    state: NewsletterState,
    kind: NewsletterJob['kind'],
    key: string,
    selectionId: string | null = null,
    feedback = ''
  ): NewsletterJob => {
    const resolved = profileBudget(state.profile!.runtime);
    return {
      id: deps.idGenerator.createId(),
      workspaceId,
      kind,
      key,
      runtime: structuredClone(state.profile!.runtime),
      contextBudget:
        resolved.type === 'budget_resolved'
          ? resolved.budget.contextTokens
          : undefined,
      budget: resolved.type === 'budget_resolved' ? resolved.budget : null,
      localOperatorId: state.profile!.runtime.localOperatorId ?? null,
      initiatingActorId:
        state.selections.find((s) => s.id === selectionId)?.selectedBy ??
        state.profile!.runtime.localOperatorId ??
        null,
      targetReportId:
        state.selections.find((s) => s.id === selectionId)?.reportId ?? null,
      selectionId,
      feedback,
      status: 'queued',
      stage: 'queued',
      checkpoint: {
        requireDispatchReconciliation: deps.requireDispatchReconciliation,
        version: 3,
        profile: structuredClone(state.profile!),
        angle: structuredClone(
          state.selections.find((v) => v.id === selectionId)?.angleSnapshot ??
            state.angles.find(
              (a) =>
                a.id ===
                state.selections.find((v) => v.id === selectionId)?.angleId
            )
        ),
      },
      leaseToken: null,
      leaseUntil: null,
      failure: null,
      createdAt: deps.clock.now(),
    };
  };
  const authorize = async (userId: UserId) =>
    deps.permissionChecker.hasPermission(userId, { report: ['read'] });
  const authorized = async <T>(
    userId: UserId,
    run: () => Promise<ApplicationResult<T>>
  ): Promise<ApplicationResult<T | { type: 'forbidden' }>> => {
    const allowed = await authorize(userId);
    return match(allowed)
      .with(Result.P.Error(P.select()), (e) => Result.Error(e))
      .with(Result.P.Ok({ type: 'permission_denied' }), () =>
        Result.Ok({ type: 'forbidden' as const })
      )
      .with(Result.P.Ok({ type: 'permission_granted' }), run)
      .exhaustive();
  };
  return {
    async get(input: {
      userId: UserId;
      workspaceId: string;
    }): Promise<ApplicationResult<GetOutcome | { type: 'forbidden' }>> {
      return authorized<GetOutcome>(input.userId, async () => {
        const stored = await deps.repository.read(input.workspaceId, {
          content: false,
        });
        if (stored.isError()) return Result.Error(stored.getError());
        const archive = await deps.archive.read(input.workspaceId, {
          content: false,
          sourceIds: [
            ...stored.get().sources.map((s) => s.id),
            ...stored.get().drafts.flatMap((d) => d.sources.map((s) => s.id)),
          ],
          now: deps.clock.now(),
        });
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        const jobs = await deps.repository.listJobSummaries(input.workspaceId);
        if (jobs.isError()) return Result.Error(jobs.getError());
        const state = stored.get();
        const current = state.sources.map((s) => {
          const live = data.sources.find((v) => v.id === s.id);
          return live
            ? {
                ...live,
                authority: s.authority,
                authorityExplanation: s.authorityExplanation,
              }
            : { ...s, junk: true };
        });
        const refreshed = { ...state, sources: current };
        const latest = data.reports.at(-1)?.id ?? null;
        const resolution = state.profile
          ? profileBudget(state.profile.runtime)
          : undefined;
        return Result.Ok({
          type: 'newsletter_found' as const,
          audienceSuggestion: data.audienceSuggestion,
          state: {
            ...refreshed,
            latestReportId: latest,
            offers: rankThemes(refreshed, deps.clock.now()).slice(0, 3),
            sources: current.map((s) => ({ ...s, content: '' })),
            drafts: state.drafts.map((d) => ({
              ...d,
              sources: d.sources.map((s) => ({ ...s, content: '' })),
            })),
          },
          jobs: jobs.get(),
          configurationIssue:
            resolution && resolution.type !== 'budget_resolved'
              ? resolution
              : null,
          generationBudget:
            resolution?.type === 'budget_resolved' ? resolution.budget : null,
          snoozed: rankThemes(refreshed, deps.clock.now(), true).filter(
            (a) => !angleEligible(refreshed, a, deps.clock.now())
          ),
          warnings: Object.fromEntries(
            state.drafts.map((d) => [d.id, sourceWarnings(d, data.sources)])
          ),
        });
      });
    },
    async saveProfile(input: {
      userId: UserId;
      workspaceId: string;
      profile: NewsletterProfile;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, async () => {
        const archive = await deps.archive.read(input.workspaceId, {
          content: false,
          now: deps.clock.now(),
        });
        if (archive.isError()) return Result.Error(archive.getError());
        if ('type' in archive.get())
          return Result.Ok({ type: 'workspace_not_found' });
        const stored = await deps.repository.read(input.workspaceId, {
          content: false,
          drafts: false,
        });
        if (stored.isError()) return Result.Error(stored.getError());
        const previous = stored.get().profile?.runtime;
        const requested = input.profile.runtime;
        const sameLocal =
          requested.mode === 'local' &&
          previous?.mode === 'local' &&
          previous.provider === requested.provider &&
          previous.model === requested.model;
        const verifyLocal =
          input.userId === deps.localOperatorId &&
          (!sameLocal || previous?.localOperatorId === input.userId);
        if (requested.mode === 'local' && !sameLocal && !verifyLocal)
          return Result.Ok({ type: 'local_verification_required' });
        // Allocation and discovery metadata are trusted only when loaded from storage
        // or produced by the authenticated operator's local adapter.
        let tokens = knownContextLimit(requested.model, requested.provider);
        let origin: 'known' | 'discovered' | 'declared' | 'legacy' = 'known';
        let contextLimit =
          sameLocal &&
          !verifyLocal &&
          previous?.contextLimit?.provider === requested.provider &&
          previous.contextLimit.model === requested.model
            ? previous.contextLimit
            : undefined;
        if (contextLimit) {
          tokens = contextLimit.tokens;
          origin = contextLimit.origin;
        }
        if (
          !tokens &&
          deps.discoverContextBudget &&
          (requested.mode === 'hosted' || verifyLocal)
        ) {
          const discovery = await deps.discoverContextBudget({
            ...requested,
            contextWindowTokens: undefined,
            contextLimit: undefined,
            localOperatorId: undefined,
          });
          if (
            discovery.isError() &&
            !requested.contextWindowTokens &&
            input.profile.enabled
          )
            return Result.Error(discovery.getError());
          if (discovery.isOk() && discovery.get().type === 'context_found') {
            const discovered = discovery.get();
            if (discovered.type === 'context_found') {
              tokens = discovered.tokens;
              origin = 'discovered';
            }
          }
        }
        if (!tokens && requested.contextWindowTokens) {
          tokens = requested.contextWindowTokens;
          origin = 'declared';
        }
        if (!tokens && input.profile.enabled)
          return Result.Ok({ type: 'context_required' });
        if (tokens && !contextLimit)
          contextLimit = {
            provider: requested.provider,
            model: requested.model,
            tokens,
            origin,
            ...(requested.provider === 'ollama' && verifyLocal
              ? { operatorCeiling: deps.operatorContextCeiling?.() }
              : {}),
          };
        const runtime: NewsletterProfile['runtime'] = {
          mode: requested.mode,
          provider: requested.provider,
          model: requested.model,
          contextWindowTokens: requested.contextWindowTokens,
          maxOutputTokens:
            requested.mode === 'hosted'
              ? (requested.maxOutputTokens ?? DEFAULT_HOSTED_OUTPUT_TOKENS)
              : undefined,
          contextLimit,
          localOperatorId:
            requested.mode === 'local'
              ? sameLocal
                ? previous.localOperatorId
                : input.userId
              : undefined,
        };
        const capacity = profileBudget(runtime);
        if (capacity.type !== 'budget_resolved' && input.profile.enabled)
          return Result.Ok(capacity);
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        return mutate<Outcome>(
          input.workspaceId,
          input.userId,
          'saveProfile',
          (state) => {
            if (
              sameLocal &&
              (!state.profile ||
                state.profile.runtime.provider !== previous.provider ||
                state.profile.runtime.model !== previous.model ||
                state.profile.runtime.localOperatorId !==
                  previous.localOperatorId ||
                JSON.stringify(state.profile.runtime.contextLimit) !==
                  JSON.stringify(previous.contextLimit))
            )
              return Result.Ok({
                value: { type: 'local_verification_required' as const },
              });
            const firstEnable =
              input.profile.enabled && !state.profile?.enabled;
            state.profile = {
              ...input.profile,
              runtime,
            };
            const jobs = firstEnable
              ? data.reports
                  .filter((r) => !state.processedReports.includes(r.id))
                  .map((report) => ({
                    ...makeJob(
                      input.workspaceId,
                      state,
                      'prepare',
                      `publication:${input.workspaceId}:${report.id}`
                    ),
                    initiatingActorId: input.userId,
                    targetReportId: report.id,
                  }))
              : [];
            return Result.Ok({
              value: {
                type: 'saved' as const,
                jobIds: jobs.map((job) => job.id),
              },
              jobs,
            });
          }
        );
      });
    },
    async prepareThemes(input: {
      userId: UserId;
      workspaceId: string;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, async () => {
        const archive = await deps.archive.read(input.workspaceId, {
          content: false,
          now: deps.clock.now(),
        });
        if (archive.isError()) return Result.Error(archive.getError());
        if ('type' in archive.get())
          return Result.Ok({ type: 'workspace_not_found' });
        return mutate<Outcome>(
          input.workspaceId,
          input.userId,
          'prepareThemes',
          (state) => {
            if (!state.profile)
              return Result.Ok({ value: { type: 'style_required' } });
            const capacity = profileBudget(state.profile.runtime);
            if (capacity.type !== 'budget_resolved')
              return Result.Ok({ value: capacity });
            const job = makeJob(
              input.workspaceId,
              state,
              'prepare',
              `manual:${input.workspaceId}:${deps.idGenerator.createId()}`
            );
            job.initiatingActorId = input.userId;
            return Result.Ok({
              value: { type: 'queued', jobId: job.id },
              jobs: [job],
            });
          }
        );
      });
    },
    async retry(input: {
      userId: UserId;
      workspaceId: string;
      jobId: string;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, async () => {
        const previous = await deps.repository.getJob(
          input.workspaceId,
          input.jobId
        );
        if (previous.isError()) return Result.Error(previous.getError());
        const found = previous.get();
        if (found.type === 'not_found') return Result.Ok(found);
        const parent = found.job;
        if (parent.status !== 'failed')
          return Result.Ok({ type: 'selection_conflict' });
        const archive = await deps.archive.read(input.workspaceId, {
          reportIds: parent.targetReportId
            ? [parent.targetReportId]
            : undefined,
          sourceIds: parent.checkpoint.angle?.sourceIds,
          now: deps.clock.now(),
        });
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        return mutate<Outcome>(
          input.workspaceId,
          input.userId,
          'retry',
          (state, context) => {
            if (
              !state.profile ||
              (parent.kind === 'draft' && !hasStyle(state.profile))
            )
              return Result.Ok({ value: { type: 'style_required' } });
            const capacity = profileBudget(state.profile.runtime);
            if (capacity.type !== 'budget_resolved')
              return Result.Ok({ value: capacity });
            const selection = state.selections.find(
              (s) => s.id === parent.selectionId
            );
            if (selection && context.activeSelectionIds.includes(selection.id))
              return Result.Ok({ value: { type: 'selection_conflict' } });
            if (
              parent.kind === 'draft' &&
              (!selection ||
                selection.status === 'abandoned' ||
                state.selections.some(
                  (s) =>
                    s.id !== selection.id &&
                    s.reportId === selection.reportId &&
                    (s.status === 'pending' || s.status === 'ready')
                ))
            )
              return Result.Ok({ value: { type: 'selection_conflict' } });
            const job = makeJob(
              input.workspaceId,
              state,
              parent.kind,
              `retry:${parent.id}`,
              parent.selectionId,
              parent.feedback
            );
            job.parentAttemptId = parent.id;
            job.targetReportId =
              parent.targetReportId ?? selection?.reportId ?? null;
            job.initiatingActorId = input.userId;
            if (selection && selection.status !== 'ready')
              selection.status = 'pending';
            return Result.Ok({
              value: {
                type: 'queued',
                jobId: job.id,
                selectionId: job.selectionId ?? undefined,
              },
              alreadyPresent: { type: 'selection_conflict' },
              jobs: [job],
            });
          }
        );
      });
    },
    async history(input: {
      userId: UserId;
      workspaceId: string;
      before?: string;
      limit?: number;
    }) {
      return authorized(input.userId, () =>
        deps.repository.history(input.workspaceId, input.before, input.limit)
      );
    },
    async jobDetail(input: {
      userId: UserId;
      workspaceId: string;
      jobId: string;
    }) {
      return authorized<
        | { type: 'not_found' }
        | {
            type: 'job_detail_found';
            audits: import('./domain/newsletter').Audit[];
            repairUnits: Record<
              string,
              Omit<
                import('./domain/newsletter').RepairUnitState,
                'rejected'
              > & { rejectedJson?: string }
            >;
            failureHistoryJson: string;
            failureDetailsJson: string;
            failure: string | null;
            budget: import('./domain/newsletter').GenerationBudget | null;
          }
      >(input.userId, async () => {
        const found = await deps.repository.getJob(
          input.workspaceId,
          input.jobId
        );
        if (found.isError()) return Result.Error(found.getError());
        const value = found.get();
        if (value.type === 'not_found') return Result.Ok(value);
        return Result.Ok({
          type: 'job_detail_found' as const,
          audits: value.job.checkpoint.audits ?? [],
          repairUnits: Object.fromEntries(
            Object.entries(value.job.checkpoint.repairUnits ?? {}).map(
              ([unit, state]) => {
                const { rejected, ...summary } = state;
                return [
                  unit,
                  {
                    ...summary,
                    rejectedJson:
                      rejected === undefined
                        ? undefined
                        : JSON.stringify(rejected),
                  },
                ];
              }
            )
          ),
          failureDetailsJson:
            value.job.checkpoint.terminalFailure?.detailsJson ?? '{}',
          failureHistoryJson: JSON.stringify(
            value.job.checkpoint.unitFailures ?? []
          ),
          failure: value.job.failure,
          budget: value.job.budget ?? null,
        });
      });
    },
    async detail(input: { userId: UserId; workspaceId: string; id: string }) {
      return authorized<
        | { type: 'not_found' }
        | { type: 'detail_found'; payloadJson: string; warnings: string[] }
      >(input.userId, async () => {
        const detail = await deps.repository.detail(
          input.workspaceId,
          input.id
        );
        if (detail.isError()) return Result.Error(detail.getError());
        const outcome = detail.get();
        if (outcome.type === 'not_found') return Result.Ok(outcome);
        const saved = zArticle.safeParse(outcome.payload);
        let warnings: string[] = [];
        if (
          saved.success &&
          typeof outcome.payload === 'object' &&
          outcome.payload &&
          'sources' in outcome.payload &&
          Array.isArray(outcome.payload.sources)
        ) {
          const draft = outcome.payload as DraftVersion;
          const live = await deps.archive.read(input.workspaceId, {
            sourceIds: draft.sources.map((s) => s.id),
            onlySourceIds: true,
            content: false,
          });
          if (live.isError()) return Result.Error(live.getError());
          const data = live.get();
          warnings = sourceWarnings(draft, 'type' in data ? [] : data.sources);
        }
        return Result.Ok({
          type: 'detail_found' as const,
          payloadJson: JSON.stringify(outcome.payload),
          warnings,
        });
      });
    },
    async evidenceDetails(input: {
      userId: UserId;
      workspaceId: string;
      sourceIds: string[];
    }) {
      return authorized(input.userId, async () =>
        (
          await deps.archive.read(input.workspaceId, {
            sourceIds: input.sourceIds,
            onlySourceIds: true,
          })
        ).map((data) =>
          'type' in data
            ? data
            : { type: 'evidence_found' as const, sources: data.sources }
        )
      );
    },
    async equivalenceReviews(input: {
      userId: UserId;
      workspaceId: string;
      before?: string;
      limit?: number;
    }) {
      return authorized(input.userId, () =>
        deps.archive.equivalenceReviews
          ? deps.archive.equivalenceReviews(
              input.workspaceId,
              input.before,
              input.limit
            )
          : Promise.resolve(
              Result.Ok({
                type: 'reviews_found' as const,
                reviews: [],
                nextCursor: null,
              })
            )
      );
    },
    async decideEquivalence(input: {
      userId: UserId;
      workspaceId: string;
      reviewId: string;
      action: 'confirm' | 'separate' | 'reverse';
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, () =>
        deps.archive.decideEquivalence
          ? deps.archive.decideEquivalence({
              ...input,
              actorId: input.userId,
              provenance: {
                ...deps.provenance,
                origin: deps.provenance?.origin ?? 'human',
                channel: deps.provenance?.channel ?? 'web',
                actorId: input.userId,
              },
            })
          : Promise.resolve(Result.Ok({ type: 'not_found' as const }))
      );
    },
    async select(input: {
      userId: UserId;
      workspaceId: string;
      reportId: string;
      angleId: string;
      overrideReason?: string;
      replace?: boolean;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, async () => {
        const archive = await deps.archive.read(input.workspaceId, {
          content: false,
          now: deps.clock.now(),
        });
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        if (data.reports.at(-1)?.id !== input.reportId)
          return Result.Ok({ type: 'latest_report_required' });
        return mutate<Outcome>(
          input.workspaceId,
          input.userId,
          'select',
          (state) => {
            if (!state.profile || !hasStyle(state.profile))
              return Result.Ok({ value: { type: 'style_required' as const } });
            const capacity = profileBudget(state.profile.runtime);
            if (capacity.type !== 'budget_resolved')
              return Result.Ok({ value: capacity });
            const active = state.selections.find(
              (s) =>
                s.reportId === input.reportId &&
                (s.status === 'pending' || s.status === 'ready')
            );
            if (active && !input.replace)
              return Result.Ok({
                value: { type: 'selection_conflict' as const },
              });
            state.sources = state.sources.map((s) => {
              const live = data.sources.find((v) => v.id === s.id);
              return live
                ? {
                    ...live,
                    authority: s.authority,
                    authorityExplanation: s.authorityExplanation,
                  }
                : { ...s, junk: true };
            });
            const theme = rankThemes(state, deps.clock.now(), true).find(
              (a) => a.id === input.angleId
            );
            if (!theme || state.skippedAngles?.includes(input.angleId))
              return Result.Ok({
                value: { type: 'angle_unavailable' as const },
              });
            const eligible = angleEligible(state, theme, deps.clock.now());
            if (!eligible && !input.overrideReason?.trim())
              return Result.Ok({
                value: { type: 'override_required' as const },
              });
            if (
              eligible &&
              !rankThemes(state, deps.clock.now())
                .slice(0, 3)
                .some((a) => a.id === theme.id)
            )
              return Result.Ok({
                value: { type: 'angle_unavailable' as const },
              });
            if (active) active.status = 'abandoned';
            state.skippedReports = (state.skippedReports ?? []).filter(
              (id) => id !== input.reportId
            );
            const now = deps.clock.now();
            const id = deps.idGenerator.createId();
            state.selections.push({
              id,
              reportId: input.reportId,
              angleId: theme.id,
              angleSnapshot: structuredClone(theme),
              selectedAt: now.toISOString(),
              snoozedUntil: new Date(now.getTime() + 30 * DAY_MS).toISOString(),
              status: 'pending',
              overrideReason: input.overrideReason?.trim() ?? '',
              evidenceIdentities: state.sources
                .filter((s) => theme.sourceIds.includes(s.id))
                .map((s) => s.identity),
              selectedBy: input.userId,
              provenance: {
                ...deps.provenance,
                origin: deps.provenance?.origin ?? 'human',
                channel: deps.provenance?.channel ?? 'web',
                actorId: input.userId,
              },
            });
            const job = makeJob(
              input.workspaceId,
              state,
              'draft',
              `draft:${id}`,
              id
            );
            return Result.Ok({
              value: {
                type: 'queued' as const,
                jobId: job.id,
                selectionId: id,
              },
              jobs: [job],
            });
          }
        );
      });
    },
    async skipAngle(input: {
      userId: UserId;
      workspaceId: string;
      reportId: string;
      angleId: string;
      skip: boolean;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, () =>
        mutate<Outcome>(
          input.workspaceId,
          input.userId,
          'skipAngle',
          (state) => {
            if (state.latestReportId !== input.reportId)
              return Result.Ok({ value: { type: 'latest_report_required' } });
            if (
              !state.offers.some((angle) => angle.id === input.angleId) &&
              !state.skippedAngles?.includes(input.angleId)
            )
              return Result.Ok({ value: { type: 'angle_unavailable' } });
            state.skippedAngles = (state.skippedAngles ?? []).filter(
              (id) => id !== input.angleId
            );
            if (input.skip) state.skippedAngles.push(input.angleId);
            return Result.Ok({ value: { type: 'saved' } });
          }
        )
      );
    },
    async skip(input: {
      userId: UserId;
      workspaceId: string;
      reportId: string;
      skip: boolean;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, async () => {
        const archive = await deps.archive.read(input.workspaceId, {
          content: false,
          now: deps.clock.now(),
        });
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        if (data.reports.at(-1)?.id !== input.reportId)
          return Result.Ok({ type: 'latest_report_required' });
        return mutate<Outcome>(
          input.workspaceId,
          input.userId,
          'skip',
          (state) => {
            if (
              state.selections.some(
                (s) =>
                  s.reportId === input.reportId &&
                  (s.status === 'pending' || s.status === 'ready')
              )
            )
              return Result.Ok({ value: { type: 'selection_conflict' } });
            state.skippedReports = (state.skippedReports ?? []).filter(
              (id) => id !== input.reportId
            );
            if (input.skip) state.skippedReports.push(input.reportId);
            return Result.Ok({ value: { type: 'saved' } });
          }
        );
      });
    },
    async abandon(input: {
      userId: UserId;
      workspaceId: string;
      selectionId: string;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, () =>
        mutate<Outcome>(input.workspaceId, input.userId, 'abandon', (state) => {
          const s = state.selections.find((v) => v.id === input.selectionId);
          if (!s) return Result.Ok({ value: { type: 'not_found' as const } });
          s.status = 'abandoned';
          return Result.Ok({ value: { type: 'saved' as const } });
        })
      );
    },
    async regenerate(input: {
      userId: UserId;
      workspaceId: string;
      selectionId: string;
      feedback: string;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, () =>
        mutate<Outcome>(
          input.workspaceId,
          input.userId,
          'regenerate',
          (state, context) => {
            if (context.activeSelectionIds.includes(input.selectionId))
              return Result.Ok({ value: { type: 'selection_conflict' } });
            const s = state.selections.find(
              (v) => v.id === input.selectionId && v.status === 'ready'
            );
            if (!s || !state.profile)
              return Result.Ok({ value: { type: 'not_found' as const } });
            if (!hasStyle(state.profile))
              return Result.Ok({ value: { type: 'style_required' as const } });
            const capacity = profileBudget(state.profile.runtime);
            if (capacity.type !== 'budget_resolved')
              return Result.Ok({ value: capacity });
            const job = makeJob(
              input.workspaceId,
              state,
              'draft',
              `revision:${s.id}:${deps.idGenerator.createId()}`,
              s.id,
              input.feedback
            );
            return Result.Ok({
              value: {
                type: 'queued' as const,
                jobId: job.id,
                selectionId: s.id,
              },
              jobs: [job],
            });
          }
        )
      );
    },
    async correctTopic(input: {
      userId: UserId;
      workspaceId: string;
      topicId: string;
      action: 'rename' | 'merge' | 'split' | 'assign';
      title?: string;
      targetId?: string;
      sourceIds?: string[];
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, () =>
        mutate<Outcome>(
          input.workspaceId,
          input.userId,
          'correctTopic',
          (state) => {
            const topic = state.topics.find(
              (t) => t.id === input.topicId && !t.mergedInto
            );
            if (!topic)
              return Result.Ok({ value: { type: 'not_found' as const } });
            const target = state.topics.find(
              (t) => t.id === input.targetId && !t.mergedInto
            );
            const sourceIds = input.sourceIds ?? [];
            const valid =
              sourceIds.length > 0 &&
              sourceIds.every((id) => state.sources.some((s) => s.id === id));
            if (input.action === 'rename') {
              if (!input.title?.trim())
                return Result.Ok({
                  value: { type: 'invalid_correction' as const },
                });
              topic.title = input.title.trim();
            } else if (input.action === 'merge') {
              if (
                !target ||
                target.id === topic.id ||
                resolveTopicRoot(state.topics, target.id) === topic.id
              )
                return Result.Ok({
                  value: { type: 'invalid_correction' as const },
                });
              target.sourceIds = [
                ...new Set([...target.sourceIds, ...topic.sourceIds]),
              ];
              target.corrected = true;
              topic.mergedInto = target.id;
              currentAssignments(state, topic.sourceIds, target.id);
              state.angles
                .filter((a) => a.topicId === topic.id)
                .forEach((a) => {
                  a.topicId = target.id;
                });
            } else if (input.action === 'split') {
              if (
                !valid ||
                !input.title?.trim() ||
                !sourceIds.every((id) => topic.sourceIds.includes(id))
              )
                return Result.Ok({
                  value: { type: 'invalid_correction' as const },
                });
              const id = deps.idGenerator.createId();
              currentAssignments(state, sourceIds, id);
              topic.sourceIds = topic.sourceIds.filter(
                (s) => !sourceIds.includes(s)
              );
              state.topics.push({
                id,
                title: input.title.trim(),
                summary: 'Reader-corrected topic',
                sourceIds,
                corrected: true,
              });
              state.angles
                .filter(
                  (a) =>
                    a.topicId === topic.id &&
                    a.sourceIds.every((s) => sourceIds.includes(s))
                )
                .forEach((a) => {
                  a.topicId = id;
                });
            } else {
              if (!valid)
                return Result.Ok({
                  value: { type: 'invalid_correction' as const },
                });
              state.topics.forEach((t) => {
                t.sourceIds = t.sourceIds.filter((s) => !sourceIds.includes(s));
              });
              topic.sourceIds = [
                ...new Set([...topic.sourceIds, ...sourceIds]),
              ];
              currentAssignments(state, sourceIds, topic.id);
              state.angles
                .filter((a) =>
                  a.sourceIds.every((id) => sourceIds.includes(id))
                )
                .forEach((a) => {
                  a.topicId = topic.id;
                });
            }
            topic.corrected = true;
            return Result.Ok({ value: { type: 'saved' as const } });
          }
        )
      );
    },
    async export(input: {
      userId: UserId;
      workspaceId: string;
      draftId: string;
      format: 'markdown' | 'text';
    }): Promise<ApplicationResult<ExportOutcome | { type: 'forbidden' }>> {
      return authorized<ExportOutcome>(input.userId, async () => {
        const state = await deps.repository.read(input.workspaceId, {
          content: false,
          drafts: false,
        });
        if (state.isError()) return Result.Error(state.getError());
        const detail = await deps.repository.detail(
          input.workspaceId,
          input.draftId
        );
        if (detail.isError()) return Result.Error(detail.getError());
        const found = detail.get();
        const draft =
          found.type === 'detail_found'
            ? (found.payload as DraftVersion)
            : state.get().drafts.find((d) => d.id === input.draftId);
        if (
          !draft ||
          !zArticle.safeParse(draft).success ||
          !Array.isArray(draft.sources)
        )
          return Result.Ok({ type: 'not_found' as const });
        const archive = await deps.archive.read(input.workspaceId, {
          sourceIds: draft.sources.map((s) => s.id),
          content: false,
          now: deps.clock.now(),
        });
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        const live = data.sources;
        return Result.Ok({
          type: 'draft_exported' as const,
          text: exportDraft(draft, input.format),
          warnings: sourceWarnings(draft, live),
        });
      });
    },
  };
}
export type NewsletterUseCases = ReturnType<typeof createNewsletterUseCases>;
