import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';
import { z } from 'zod';

import {
  createServerFunctionInvoker,
  type ServerFnContextRunner,
} from '@/platform/lib/tanstack-start/server-function-handler';

import type { ProtectedContext } from '@/modules/auth/backend';

import { feedbackEventTypes } from '../../domain/intelligence';
import type { IntelligenceUseCases } from '../../factory';

type ProtectedRunner = ServerFnContextRunner<ProtectedContext>;

type IntelligenceServerRuntimeDeps = {
  createId: () => string;
  getUseCases: (ctx: ProtectedContext) => IntelligenceUseCases;
  withProtectedContext: ProtectedRunner;
  withProtectedMutation: ProtectedRunner;
};

const getDeps = createServerOnlyFn(
  async (): Promise<IntelligenceServerRuntimeDeps> => {
    const [
      { getIntelligenceUseCases },
      { getKernel },
      { withProtectedContext, withProtectedMutation },
    ] = await Promise.all([
      import('@/composition/intelligence'),
      import('@/composition/kernel'),
      import('@/modules/auth/backend'),
    ]);
    const kernel = getKernel();

    return {
      createId: () => kernel.idGenerator.createId(),
      getUseCases: (ctx) =>
        getIntelligenceUseCases({
          kernel: getKernel({ logger: ctx.logger }),
        }),
      withProtectedContext,
      withProtectedMutation,
    };
  }
);

const runProtected = createServerFunctionInvoker({
  getDeps,
  selectRunner: (deps) => deps.withProtectedContext,
});

const runMutation = createServerFunctionInvoker({
  getDeps,
  selectRunner: (deps) => deps.withProtectedMutation,
});

const toSerializable = (value: unknown): any =>
  JSON.parse(JSON.stringify(value)) as unknown;

const zOptionalWorkspaceInput = () =>
  z
    .object({ workspaceId: z.string().min(1).optional() })
    .optional()
    .default({});

const zReportInput = () => z.object({ reportId: z.string().min(1) });

const zSourceInput = () => z.object({ sourceId: z.string().min(1) });

const zWorkspaceInput = () => z.object({ workspaceId: z.string().min(1) });

const zFeedbackInput = () =>
  z.object({
    eventType: z.enum(feedbackEventTypes),
    payload: z.record(z.string(), z.unknown()).optional().default({}),
    reportId: z.string().min(1).optional(),
    sourceRecordId: z.string().min(1).optional(),
    targetId: z.string().min(1),
    targetType: z.string().min(1),
    workspaceId: z.string().min(1),
  });

const zAcceptSuggestedCompetitorInput = () =>
  z.object({
    competitorId: z.string().min(1),
    reportId: z.string().min(1).optional(),
    workspaceId: z.string().min(1),
  });

export const intelligenceGetLatestReport = createServerFn({ method: 'GET' })
  .inputValidator(zOptionalWorkspaceInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.getLatestReport')(
      data,
      async ({ getUseCases }, ctx, input) => {
        const { repository } = getUseCases(ctx);
        const workspaceId =
          input.workspaceId ?? (await repository.listWorkspaces())[0]?.id;
        if (!workspaceId) return null;

        const report = await repository.getLatestPublishedReport(workspaceId);
        return toSerializable(report ? { report, workspaceId } : null);
      }
    )
  );

export const intelligenceGetReport = createServerFn({ method: 'GET' })
  .inputValidator(zReportInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.getReport')(
      data,
      async ({ getUseCases }, ctx, input) =>
        toSerializable(
          await getUseCases(ctx).repository.getReportWithSources(input.reportId)
        )
    )
  );

export const intelligenceGetSource = createServerFn({ method: 'GET' })
  .inputValidator(zSourceInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.getSource')(
      data,
      async ({ getUseCases }, ctx, input) =>
        toSerializable(
          await getUseCases(ctx).repository.getSourceRecord(input.sourceId)
        )
    )
  );

export const intelligenceListWorkspaces = createServerFn({
  method: 'GET',
}).handler(async () =>
  runProtected.withOperation('intelligence.listWorkspaces')(
    undefined,
    async ({ getUseCases }, ctx) =>
      toSerializable(await getUseCases(ctx).repository.listWorkspaces())
  )
);

export const intelligenceGetWorkspace = createServerFn({ method: 'GET' })
  .inputValidator(zWorkspaceInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.getWorkspace')(
      data,
      async ({ getUseCases }, ctx, input) => {
        const { repository } = getUseCases(ctx);
        const [configuration, callbacks] = await Promise.all([
          repository.getWorkspaceConfiguration(input.workspaceId),
          repository.listProviderCallbackEvents({
            limit: 20,
            workspaceId: input.workspaceId,
          }),
        ]);

        return toSerializable(
          configuration ? { callbacks, configuration } : null
        );
      }
    )
  );

export const intelligenceRecordFeedback = createServerFn({ method: 'POST' })
  .inputValidator(zFeedbackInput())
  .handler(async ({ data }) =>
    runMutation.withOperation('intelligence.recordFeedback')(
      data,
      async ({ createId, getUseCases }, ctx, input) => {
        await getUseCases(ctx).repository.recordFeedback({
          id: createId(),
          workspaceId: input.workspaceId,
          reportId: input.reportId,
          userId: ctx.user.id,
          eventType: input.eventType,
          targetType: input.targetType,
          targetId: input.targetId,
          sourceRecordId: input.sourceRecordId,
          payload: input.payload,
        });
        return { ok: true };
      }
    )
  );

export const intelligenceAcceptSuggestedCompetitor = createServerFn({
  method: 'POST',
})
  .inputValidator(zAcceptSuggestedCompetitorInput())
  .handler(async ({ data }) =>
    runMutation.withOperation('intelligence.acceptSuggestedCompetitor')(
      data,
      async ({ createId, getUseCases }, ctx, input) => {
        const { repository } = getUseCases(ctx);
        const accepted = await repository.acceptSuggestedCompetitor({
          workspaceId: input.workspaceId,
          competitorId: input.competitorId,
        });
        await repository.recordFeedback({
          id: createId(),
          workspaceId: input.workspaceId,
          reportId: input.reportId,
          userId: ctx.user.id,
          eventType: 'add_competitor_to_watchlist',
          targetType: 'competitor',
          targetId: input.competitorId,
          payload: { accepted: Boolean(accepted) },
        });
        return { accepted: Boolean(accepted) };
      }
    )
  );

export type IntelligenceServerFunctions = {
  intelligenceAcceptSuggestedCompetitor: typeof intelligenceAcceptSuggestedCompetitor;
  intelligenceGetLatestReport: typeof intelligenceGetLatestReport;
  intelligenceGetReport: typeof intelligenceGetReport;
  intelligenceGetSource: typeof intelligenceGetSource;
  intelligenceGetWorkspace: typeof intelligenceGetWorkspace;
  intelligenceListWorkspaces: typeof intelligenceListWorkspaces;
  intelligenceRecordFeedback: typeof intelligenceRecordFeedback;
};
