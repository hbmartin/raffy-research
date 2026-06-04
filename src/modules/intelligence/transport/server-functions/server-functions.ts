import { createServerFn, createServerOnlyFn } from '@tanstack/react-start';

import {
  createServerFunctionInvoker,
  type ServerFnContextRunner,
} from '@/platform/lib/tanstack-start/server-function-handler';

import type { ProtectedContext } from '@/modules/auth/backend';

import {
  createIntelligenceHandlers,
  type IntelligenceHandlers,
  zRecordFeedbackInput,
  zReportByIdInput,
  zReportSourcesInput,
  zSourceByIdInput,
  zWorkspaceConfigInput,
} from '../http/intelligence-handlers';

type ProtectedRunner = ServerFnContextRunner<ProtectedContext>;

type IntelligenceServerRuntimeDeps = {
  handlers: IntelligenceHandlers;
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

    return {
      handlers: createIntelligenceHandlers({
        getUseCases: (ctx) =>
          getIntelligenceUseCases({
            kernel: getKernel({ logger: ctx.logger }),
          }),
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

export const intelligenceGetLatestReport = createServerFn({
  method: 'GET',
}).handler(async () =>
  runProtected.withOperation('intelligence.getLatestReport')(
    undefined,
    ({ handlers }, ctx) => handlers.getLatestReportForUser(ctx)
  )
);

export const intelligenceGetReport = createServerFn({ method: 'GET' })
  .inputValidator(zReportByIdInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.getReport')(
      data,
      ({ handlers }, ctx, input) => handlers.getReportById(ctx, input)
    )
  );

export const intelligenceGetReportSources = createServerFn({ method: 'GET' })
  .inputValidator(zReportSourcesInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.getReportSources')(
      data,
      ({ handlers }, ctx, input) => handlers.getReportSources(ctx, input)
    )
  );

export const intelligenceGetSource = createServerFn({ method: 'GET' })
  .inputValidator(zSourceByIdInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.getSource')(
      data,
      ({ handlers }, ctx, input) => handlers.getSourceById(ctx, input)
    )
  );

export const intelligenceListWorkspaces = createServerFn({
  method: 'GET',
}).handler(async () =>
  runProtected.withOperation('intelligence.listWorkspaces')(
    undefined,
    ({ handlers }, ctx) => handlers.listWorkspaces(ctx)
  )
);

export const intelligenceGetWorkspaceConfig = createServerFn({ method: 'GET' })
  .inputValidator(zWorkspaceConfigInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.getWorkspaceConfig')(
      data,
      ({ handlers }, ctx, input) => handlers.getWorkspaceConfig(ctx, input)
    )
  );

export const intelligenceListReports = createServerFn({ method: 'GET' })
  .inputValidator(zWorkspaceConfigInput())
  .handler(async ({ data }) =>
    runProtected.withOperation('intelligence.listReports')(
      data,
      ({ handlers }, ctx, input) => handlers.listReports(ctx, input)
    )
  );

export const intelligenceRecordFeedback = createServerFn({ method: 'POST' })
  .inputValidator(zRecordFeedbackInput())
  .handler(async ({ data }) =>
    runMutation.withOperation('intelligence.recordFeedback')(
      data,
      ({ handlers }, ctx, input) => handlers.recordFeedback(ctx, input)
    )
  );

export type IntelligenceServerFunctions = {
  intelligenceGetLatestReport: typeof intelligenceGetLatestReport;
  intelligenceGetReport: typeof intelligenceGetReport;
  intelligenceGetReportSources: typeof intelligenceGetReportSources;
  intelligenceGetSource: typeof intelligenceGetSource;
  intelligenceListWorkspaces: typeof intelligenceListWorkspaces;
  intelligenceGetWorkspaceConfig: typeof intelligenceGetWorkspaceConfig;
  intelligenceListReports: typeof intelligenceListReports;
  intelligenceRecordFeedback: typeof intelligenceRecordFeedback;
};
