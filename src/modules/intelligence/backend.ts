import { createServerOnlyFn } from '@tanstack/react-start';
import { start } from 'workflow/api';

import { appErrorToResponse } from '@/modules/kernel/transport/http/error-mapper';

import {
  createIntelligenceHttpHandlers,
  type IntelligenceHttpHandlers,
} from './transport/http/intelligence-handlers';
import {
  dailyIngestWorkflow,
  weeklyReportsWorkflow,
} from './workflows/intelligence-workflows';

type IntelligenceServerRuntimeDeps = {
  handlers: IntelligenceHttpHandlers;
};

const getDeps = createServerOnlyFn(
  async (): Promise<IntelligenceServerRuntimeDeps> => {
    const [
      { getIntelligenceUseCases },
      { getKernel },
      { getIntelligenceRuntimeConfig },
    ] = await Promise.all([
      import('@/composition/intelligence'),
      import('@/composition/kernel'),
      import('./infrastructure/config/intelligence-env'),
    ]);
    const kernel = getKernel();

    return {
      handlers: createIntelligenceHttpHandlers({
        clock: kernel.clock,
        getRuntimeConfig: getIntelligenceRuntimeConfig,
        getUseCases: getIntelligenceUseCases,
        idGenerator: kernel.idGenerator,
        logger: kernel.logger,
        startDailyIngestionWorkflow: async () => start(dailyIngestWorkflow),
        startWeeklyReportsWorkflow: async () => start(weeklyReportsWorkflow),
      }),
    };
  }
);

export async function handleProviderCallbackRequest(input: {
  provider: string;
  request: Request;
}) {
  try {
    const { handlers } = await getDeps();
    return await handlers.receiveProviderCallback(input);
  } catch (error) {
    return appErrorToResponse(error);
  }
}

export async function handleDailyIngestCronRequest(request: Request) {
  try {
    const { handlers } = await getDeps();
    return await handlers.startDailyIngestion(request);
  } catch (error) {
    return appErrorToResponse(error);
  }
}

export async function handleWeeklyReportsCronRequest(request: Request) {
  try {
    const { handlers } = await getDeps();
    return await handlers.startWeeklyReports(request);
  } catch (error) {
    return appErrorToResponse(error);
  }
}
