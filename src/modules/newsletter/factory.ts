import { Result } from '@swan-io/boxed';
import { match, P } from 'ts-pattern';

import type { Clock, IdGenerator, PermissionChecker } from '@/modules/kernel';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { UserId } from '@/modules/kernel/domain/ids';

import type {
  NewsletterRepository,
  ResearchArchive,
} from './application/ports';
import {
  angleEligible,
  type Audit,
  DAY_MS,
  exportDraft,
  hasStyle,
  type NewsletterJob,
  type NewsletterProfile,
  type NewsletterState,
  rankThemes,
  sourceWarnings,
  type Theme,
} from './domain/newsletter';

type Deps = {
  repository: NewsletterRepository;
  archive: ResearchArchive;
  permissionChecker: PermissionChecker;
  clock: Clock;
  idGenerator: IdGenerator;
};
export type NewsletterView = {
  type: 'newsletter_found';
  audienceSuggestion: string;
  state: NewsletterState;
  jobs: (Omit<NewsletterJob, 'checkpoint' | 'leaseToken'> & {
    audits: Audit[];
  })[];
  snoozed: Theme[];
  warnings: Record<string, string[]>;
};
type GetOutcome = NewsletterView | { type: 'workspace_not_found' };
type ExportOutcome =
  | { type: 'draft_exported'; text: string; warnings: string[] }
  | { type: 'not_found' }
  | { type: 'workspace_not_found' };
type Outcome =
  | { type: 'saved' }
  | { type: 'queued' }
  | { type: 'forbidden' }
  | { type: 'workspace_not_found' }
  | { type: 'selection_conflict' }
  | { type: 'latest_report_required' }
  | { type: 'style_required' }
  | { type: 'angle_unavailable' }
  | { type: 'override_required' }
  | { type: 'not_found' }
  | { type: 'invalid_correction' };
const currentAssignments = (
  state: NewsletterState,
  sourceIds: string[],
  topicId: string
) => {
  state.assignments ??= {};
  for (const id of sourceIds) state.assignments[id] = topicId;
};
export function createNewsletterUseCases(deps: Deps) {
  const makeJob = (
    workspaceId: string,
    state: NewsletterState,
    kind: NewsletterJob['kind'],
    key: string,
    selectionId: string | null = null,
    feedback = ''
  ): NewsletterJob => ({
    id: deps.idGenerator.createId(),
    workspaceId,
    kind,
    key,
    runtime: state.profile!.runtime,
    selectionId,
    feedback,
    status: 'queued',
    stage: 'queued',
    checkpoint: {
      profile: structuredClone(state.profile!),
      angle: structuredClone(
        state.angles.find(
          (a) =>
            a.id === state.selections.find((v) => v.id === selectionId)?.angleId
        )
      ),
    },
    leaseToken: null,
    leaseUntil: null,
    failure: null,
    createdAt: deps.clock.now(),
  });
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
        const archive = await deps.archive.read(input.workspaceId);
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        const stored = await deps.repository.read(input.workspaceId);
        if (stored.isError()) return Result.Error(stored.getError());
        const jobs = await deps.repository.listJobs(input.workspaceId);
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
          jobs: jobs
            .get()
            .map(({ checkpoint, leaseToken: _leaseToken, ...j }) => ({
              ...j,
              audits: checkpoint.audits ?? [],
            })),
          snoozed: rankThemes(refreshed, deps.clock.now(), true).filter(
            (a) => !angleEligible(refreshed, a, deps.clock.now())
          ),
          warnings: Object.fromEntries(
            state.drafts.map((d) => [d.id, sourceWarnings(d, current)])
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
        const archive = await deps.archive.read(input.workspaceId);
        if (archive.isError()) return Result.Error(archive.getError());
        if ('type' in archive.get())
          return Result.Ok({ type: 'workspace_not_found' });
        return deps.repository.mutate<Outcome>(input.workspaceId, (state) => {
          state.profile = input.profile;
          const jobs = input.profile.enabled
            ? [
                makeJob(
                  input.workspaceId,
                  state,
                  'prepare',
                  `prepare:${input.workspaceId}:${state.revision + 1}`
                ),
              ]
            : [];
          return Result.Ok({ value: { type: 'saved' as const }, jobs });
        });
      });
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
        const archive = await deps.archive.read(input.workspaceId);
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        if (data.reports.at(-1)?.id !== input.reportId)
          return Result.Ok({ type: 'latest_report_required' });
        return deps.repository.mutate<Outcome>(input.workspaceId, (state) => {
          if (!state.profile?.enabled || !hasStyle(state.profile))
            return Result.Ok({ value: { type: 'style_required' as const } });
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
          if (!theme)
            return Result.Ok({ value: { type: 'angle_unavailable' as const } });
          const eligible = angleEligible(state, theme, deps.clock.now());
          if (!eligible && !input.overrideReason?.trim())
            return Result.Ok({ value: { type: 'override_required' as const } });
          if (
            eligible &&
            !rankThemes(state, deps.clock.now())
              .slice(0, 3)
              .some((a) => a.id === theme.id)
          )
            return Result.Ok({ value: { type: 'angle_unavailable' as const } });
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
          });
          return Result.Ok({
            value: { type: 'queued' as const },
            jobs: [
              makeJob(input.workspaceId, state, 'draft', `draft:${id}`, id),
            ],
          });
        });
      });
    },
    async skip(input: {
      userId: UserId;
      workspaceId: string;
      reportId: string;
      skip: boolean;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, async () => {
        const archive = await deps.archive.read(input.workspaceId);
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        if (data.reports.at(-1)?.id !== input.reportId)
          return Result.Ok({ type: 'latest_report_required' });
        return deps.repository.mutate<Outcome>(input.workspaceId, (state) => {
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
        });
      });
    },
    async abandon(input: {
      userId: UserId;
      workspaceId: string;
      selectionId: string;
    }): Promise<ApplicationResult<Outcome>> {
      return authorized<Outcome>(input.userId, () =>
        deps.repository.mutate<Outcome>(input.workspaceId, (state) => {
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
        deps.repository.mutate<Outcome>(input.workspaceId, (state) => {
          const s = state.selections.find(
            (v) => v.id === input.selectionId && v.status === 'ready'
          );
          if (!s || !state.profile)
            return Result.Ok({ value: { type: 'not_found' as const } });
          if (!hasStyle(state.profile))
            return Result.Ok({ value: { type: 'style_required' as const } });
          return Result.Ok({
            value: { type: 'queued' as const },
            jobs: [
              makeJob(
                input.workspaceId,
                state,
                'draft',
                `revision:${s.id}:${deps.idGenerator.createId()}`,
                s.id,
                input.feedback
              ),
            ],
          });
        })
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
        deps.repository.mutate<Outcome>(input.workspaceId, (state) => {
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
            if (!target || target.id === topic.id)
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
            topic.sourceIds = [...new Set([...topic.sourceIds, ...sourceIds])];
            currentAssignments(state, sourceIds, topic.id);
            state.angles
              .filter((a) => a.sourceIds.every((id) => sourceIds.includes(id)))
              .forEach((a) => {
                a.topicId = topic.id;
              });
          }
          topic.corrected = true;
          return Result.Ok({ value: { type: 'saved' as const } });
        })
      );
    },
    async export(input: {
      userId: UserId;
      workspaceId: string;
      draftId: string;
      format: 'markdown' | 'text';
    }): Promise<ApplicationResult<ExportOutcome | { type: 'forbidden' }>> {
      return authorized<ExportOutcome>(input.userId, async () => {
        const state = await deps.repository.read(input.workspaceId);
        if (state.isError()) return Result.Error(state.getError());
        const draft = state.get().drafts.find((d) => d.id === input.draftId);
        if (!draft) return Result.Ok({ type: 'not_found' as const });
        const archive = await deps.archive.read(input.workspaceId);
        if (archive.isError()) return Result.Error(archive.getError());
        const data = archive.get();
        if ('type' in data) return Result.Ok(data);
        const live = state
          .get()
          .sources.map(
            (s) =>
              data.sources.find((v) => v.id === s.id) ?? { ...s, junk: true }
          );
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
