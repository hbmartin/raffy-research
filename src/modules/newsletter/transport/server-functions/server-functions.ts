import { Result } from '@swan-io/boxed';
import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { match, P } from 'ts-pattern';
import { z } from 'zod';

import {
  createServerFunctionInvoker,
  type ServerFnContextRunner,
} from '@/platform/lib/tanstack-start/server-function-handler';

import type { ProtectedContext } from '@/modules/auth/backend';
import type { ApplicationResult } from '@/modules/kernel/application/result';

import { zProfile } from '../../domain/newsletter';
import type { createNewsletterUseCases } from '../../factory';

type RuntimeDeps = {
  useCases: ReturnType<typeof createNewsletterUseCases>;
  withProtectedContext: ServerFnContextRunner<ProtectedContext>;
  withProtectedMutation: ServerFnContextRunner<ProtectedContext>;
};
const getDeps = createServerOnlyFn(async (): Promise<RuntimeDeps> => {
  const [
    { getNewsletterRuntime },
    { withProtectedContext, withProtectedMutation },
  ] = await Promise.all([
    import('@/composition/newsletter'),
    import('@/modules/auth/backend'),
  ]);
  return {
    useCases: getNewsletterRuntime().useCases,
    withProtectedContext,
    withProtectedMutation,
  };
});
const runProtected = createServerFunctionInvoker({
  getDeps,
  selectRunner: (deps) => deps.withProtectedContext,
});
const runMutation = createServerFunctionInvoker({
  getDeps,
  selectRunner: (deps) => deps.withProtectedMutation,
});
const unwrap = <T>(result: ApplicationResult<T>) =>
  match(result)
    .with(Result.P.Ok(P.select()), (v) => v)
    .with(Result.P.Error(P.select()), (e) => {
      throw e;
    })
    .exhaustive();
const workspaceInput = z.object({ workspaceId: z.string().min(1).max(100) });

export const newsletterGet = createServerFn({ method: 'GET' })
  .validator(workspaceInput)
  .handler(async ({ data }) =>
    runProtected.withOperation('newsletter.get')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.get({ ...input, userId: ctx.user.id }))
    )
  );

export const newsletterSaveProfile = createServerFn({ method: 'POST' })
  .validator(workspaceInput.extend({ profile: zProfile }))
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.saveProfile')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.saveProfile({ ...input, userId: ctx.user.id }))
    )
  );

export const newsletterSelect = createServerFn({ method: 'POST' })
  .validator(
    workspaceInput.extend({
      reportId: z.string().min(1),
      angleId: z.string().min(1),
      overrideReason: z.string().max(2000).optional(),
      replace: z.boolean().optional(),
    })
  )
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.select')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.select({ ...input, userId: ctx.user.id }))
    )
  );

export const newsletterAbandon = createServerFn({ method: 'POST' })
  .validator(workspaceInput.extend({ selectionId: z.string().min(1) }))
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.abandon')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.abandon({ ...input, userId: ctx.user.id }))
    )
  );

export const newsletterRegenerate = createServerFn({ method: 'POST' })
  .validator(
    workspaceInput.extend({
      selectionId: z.string().min(1),
      feedback: z.string().trim().min(1).max(12000),
    })
  )
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.regenerate')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.regenerate({ ...input, userId: ctx.user.id }))
    )
  );

export const newsletterCorrectTopic = createServerFn({ method: 'POST' })
  .validator(
    workspaceInput.extend({
      topicId: z.string().min(1),
      action: z.enum(['rename', 'merge', 'split', 'assign']),
      title: z.string().max(500).optional(),
      targetId: z.string().optional(),
      sourceIds: z.array(z.string()).max(500).optional(),
    })
  )
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.correctTopic')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.correctTopic({ ...input, userId: ctx.user.id }))
    )
  );

export const newsletterExport = createServerFn({ method: 'GET' })
  .validator(
    workspaceInput.extend({
      draftId: z.string().min(1),
      format: z.enum(['markdown', 'text']),
    })
  )
  .handler(async ({ data }) =>
    runProtected.withOperation('newsletter.export')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.export({ ...input, userId: ctx.user.id }))
    )
  );

export const newsletterSkip = createServerFn({ method: 'POST' })
  .validator(
    workspaceInput.extend({ reportId: z.string().min(1), skip: z.boolean() })
  )
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.skip')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.skip({ ...input, userId: ctx.user.id }))
    )
  );

export const newsletterPrepareThemes = createServerFn({ method: 'POST' })
  .validator(workspaceInput)
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.prepareThemes')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.prepareThemes({ ...input, userId: ctx.user.id }))
    )
  );
export const newsletterRetry = createServerFn({ method: 'POST' })
  .validator(workspaceInput.extend({ jobId: z.string().min(1).max(200) }))
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.retry')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.retry({ ...input, userId: ctx.user.id }))
    )
  );
export const newsletterHistory = createServerFn({ method: 'GET' })
  .validator(workspaceInput.extend({ before: z.string().max(300).optional() }))
  .handler(async ({ data }) =>
    runProtected.withOperation('newsletter.history')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.history({ ...input, userId: ctx.user.id }))
    )
  );
export const newsletterDetail = createServerFn({ method: 'GET' })
  .validator(workspaceInput.extend({ id: z.string().min(1).max(300) }))
  .handler(async ({ data }) =>
    runProtected.withOperation('newsletter.detail')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.detail({ ...input, userId: ctx.user.id }))
    )
  );
export const newsletterJobDetail = createServerFn({ method: 'GET' })
  .validator(workspaceInput.extend({ jobId: z.string().min(1).max(200) }))
  .handler(async ({ data }) =>
    runProtected.withOperation('newsletter.jobDetail')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(await useCases.jobDetail({ ...input, userId: ctx.user.id }))
    )
  );
export const newsletterEquivalenceReviews = createServerFn({ method: 'GET' })
  .validator(workspaceInput.extend({ before: z.string().max(300).optional() }))
  .handler(async ({ data }) =>
    runProtected.withOperation('newsletter.equivalenceReviews')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(
          await useCases.equivalenceReviews({ ...input, userId: ctx.user.id })
        )
    )
  );
export const newsletterDecideEquivalence = createServerFn({ method: 'POST' })
  .validator(
    workspaceInput.extend({
      reviewId: z.string().min(1).max(200),
      action: z.enum(['confirm', 'separate', 'reverse']),
    })
  )
  .handler(async ({ data }) =>
    runMutation.withOperation('newsletter.decideEquivalence')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(
          await useCases.decideEquivalence({ ...input, userId: ctx.user.id })
        )
    )
  );

export type NewsletterServerFunctions = {
  newsletterGet: typeof newsletterGet;
  newsletterHistory: typeof newsletterHistory;
  newsletterDetail: typeof newsletterDetail;
  newsletterJobDetail: typeof newsletterJobDetail;
  newsletterEvidenceDetails: typeof newsletterEvidenceDetails;
  newsletterEquivalenceReviews: typeof newsletterEquivalenceReviews;
};

export const newsletterEvidenceDetails = createServerFn({ method: 'GET' })
  .validator(
    workspaceInput.extend({
      sourceIds: z.array(z.string().min(1).max(200)).min(1).max(2),
    })
  )
  .handler(async ({ data }) =>
    runProtected.withOperation('newsletter.evidenceDetails')(
      data,
      async ({ useCases }, ctx, input) =>
        unwrap(
          await useCases.evidenceDetails({ ...input, userId: ctx.user.id })
        )
    )
  );
