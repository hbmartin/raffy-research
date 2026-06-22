import { Result } from '@swan-io/boxed';

import { AppError } from '@/modules/kernel/domain/errors/app-error';

import type {
  EvalExperimentPort,
  ReportEvalInput,
  ReportGenerationInput,
  SummaryEvalInput,
} from '../../application/ports/eval-experiment-repository';

type PhoenixClientConfig = {
  appUrl: string;
  apiKey: string;
};

type PhoenixClient = ReturnType<
  typeof import('@arizeai/phoenix-client').createClient
>;

async function getPhoenixSdk() {
  const { createClient } = await import('@arizeai/phoenix-client');
  const { createDataset, appendDatasetExamples } =
    await import('@arizeai/phoenix-client/datasets');
  const { runExperiment, asEvaluator } =
    await import('@arizeai/phoenix-client/experiments');
  return {
    createClient,
    createDataset,
    appendDatasetExamples,
    runExperiment,
    asEvaluator,
  };
}

function makeClient(
  config: PhoenixClientConfig,
  createClientFn: typeof import('@arizeai/phoenix-client').createClient
): PhoenixClient {
  return createClientFn({
    options: {
      baseUrl: config.appUrl,
      headers: { Authorization: `Bearer ${config.apiKey}` },
    },
  });
}

function wrapError(error: unknown): AppError {
  return new AppError({
    code: 'PHOENIX_EVAL_ERROR',
    category: 'system',
    status: 502,
    message:
      error instanceof Error ? error.message : 'Phoenix eval tracking failed',
    cause: error,
  });
}

function scoreEvaluator(
  sdk: Awaited<ReturnType<typeof getPhoenixSdk>>,
  name: string,
  extract: (output: Record<string, unknown>) => number | null
) {
  return sdk.asEvaluator({
    name,
    kind: 'CODE',
    evaluate: ({ output }) => {
      const obj = output as Record<string, unknown> | null;
      const score = obj ? extract(obj) : null;
      return { score, label: name };
    },
  });
}

export function createPhoenixEvalAdapter(
  config: PhoenixClientConfig
): EvalExperimentPort {
  return {
    async recordReportGeneration(input: ReportGenerationInput) {
      try {
        const sdk = await getPhoenixSdk();
        const client = makeClient(config, sdk.createClient);
        const datasetName = `report-generations-${input.workspaceId}`;

        const { datasetId } = await sdk.createDataset({
          client,
          name: datasetName,
          description: `Report generation inputs/outputs for workspace ${input.workspaceId}`,
          examples: [],
        });

        const { versionId } = await sdk.appendDatasetExamples({
          client,
          dataset: { datasetId },
          examples: [
            {
              input: {
                workspaceId: input.workspaceId,
                reportId: input.reportId,
                prompt: input.prompt,
                modelName: input.modelName,
                modelProvider: input.modelProvider,
              },
              output: input.reportData,
              metadata: {
                modelName: input.modelName,
                modelProvider: input.modelProvider,
                recordedAt: new Date().toISOString(),
              },
            },
          ],
        });

        return Result.Ok({ datasetId, exampleId: versionId });
      } catch (error) {
        return Result.Error(wrapError(error));
      }
    },

    async recordReportEvaluation(input: ReportEvalInput) {
      try {
        const sdk = await getPhoenixSdk();
        const client = makeClient(config, sdk.createClient);
        const datasetName = `report-evals-${input.workspaceId}`;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const { datasetId } = await sdk.createDataset({
          client,
          name: datasetName,
          description: `Report evaluation dataset for workspace ${input.workspaceId}`,
          examples: [
            {
              input: {
                workspaceId: input.workspaceId,
                reportId: input.reportId,
                sources: input.sources.map((s) => ({
                  id: s.id,
                  title: s.title,
                  provider: s.provider,
                  contentText: s.contentText?.slice(0, 4000),
                })),
              },
              output: input.reportData,
              metadata: {
                modelName: input.modelName,
                modelProvider: input.modelProvider,
              },
            },
          ],
        });

        const experiment = await sdk.runExperiment({
          client,
          dataset: { datasetId },
          experimentName: `eval-${input.reportId}-${timestamp}`,
          experimentDescription: `LLM-as-judge evaluation for report ${input.reportId}`,
          experimentMetadata: {
            workspaceId: input.workspaceId,
            reportId: input.reportId,
            modelName: input.modelName,
            modelProvider: input.modelProvider,
          },
          task: () => ({
            scores: {
              claim_support: input.evaluation.claim_support,
              coverage: input.evaluation.coverage,
              noise: input.evaluation.noise,
            },
            violations: input.evaluation.violations,
            missed_signals: input.evaluation.missed_signals,
            summary: input.evaluation.summary,
          }),
          evaluators: [
            scoreEvaluator(sdk, 'claim_support', (o) => {
              const scores = o.scores as Record<string, unknown> | undefined;
              return typeof scores?.claim_support === 'number'
                ? scores.claim_support
                : null;
            }),
            scoreEvaluator(sdk, 'coverage', (o) => {
              const scores = o.scores as Record<string, unknown> | undefined;
              return typeof scores?.coverage === 'number'
                ? scores.coverage
                : null;
            }),
            scoreEvaluator(sdk, 'noise', (o) => {
              const scores = o.scores as Record<string, unknown> | undefined;
              return typeof scores?.noise === 'number' ? scores.noise : null;
            }),
          ],
          setGlobalTracerProvider: false,
        });

        return Result.Ok({ experimentId: experiment.id });
      } catch (error) {
        return Result.Error(wrapError(error));
      }
    },

    async recordSummaryEvaluation(input: SummaryEvalInput) {
      try {
        const sdk = await getPhoenixSdk();
        const client = makeClient(config, sdk.createClient);
        const datasetName = `summary-evals-${input.workspaceId}`;
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

        const { datasetId } = await sdk.createDataset({
          client,
          name: datasetName,
          description: `Source summary evaluation dataset for workspace ${input.workspaceId}`,
          examples: [
            {
              input: {
                workspaceId: input.workspaceId,
                sourceRecordId: input.sourceRecordId,
                title: input.sourceContent.title,
                provider: input.sourceContent.provider,
                contentText: input.sourceContent.contentText?.slice(0, 8000),
              },
              output: {
                summaryText: input.summary.summaryText,
                evidenceCandidateText: input.summary.evidenceCandidateText,
              },
              metadata: {
                modelName: input.modelName,
                modelProvider: input.modelProvider,
              },
            },
          ],
        });

        const experiment = await sdk.runExperiment({
          client,
          dataset: { datasetId },
          experimentName: `summary-eval-${input.sourceRecordId}-${timestamp}`,
          experimentDescription: `Summary evaluation for source ${input.sourceRecordId}`,
          experimentMetadata: {
            workspaceId: input.workspaceId,
            sourceRecordId: input.sourceRecordId,
            modelName: input.modelName,
            modelProvider: input.modelProvider,
            sourceProvider: input.sourceContent.provider,
          },
          task: () => ({
            summaryText: input.summary.summaryText,
            evidenceCandidateText: input.summary.evidenceCandidateText,
          }),
          setGlobalTracerProvider: false,
        });

        return Result.Ok({ experimentId: experiment.id });
      } catch (error) {
        return Result.Error(wrapError(error));
      }
    },
  };
}
