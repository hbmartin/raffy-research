import { randomUUID } from 'node:crypto';

import {
  buildSourceSummaryPrompt,
  type LocalAiProviderName,
  SOURCE_SUMMARY_CONTENT_LIMIT,
  SOURCE_SUMMARY_PROMPT_VERSION,
} from '@/modules/intelligence';
import {
  generateLocalText,
  getLocalAiConfig,
} from '@/modules/intelligence/backend';

import {
  loadCaseForWorkspace,
  SAMPLE_SPLIT,
  summaryExampleId,
  usableSources as caseUsableSources,
} from '../case';
import type { CliArgs } from '../cli-args';
import { extractJsonObject } from '../json';
import { log } from '../log';
import { createPhoenixClient } from '../phoenix-client';
import { ensureDataset } from '../phoenix-dataset';
import {
  SUMMARY_EVALUATORS,
  type SummaryExampleInput,
  type SummaryExampleOutput,
} from '../summary-evaluators';

export async function runSummarizeCase(args: CliArgs) {
  if (!args.caseDir) throw new Error('--case is required');
  const evalCase = loadCaseForWorkspace(args.caseDir, args.workspaceId);
  const config = getLocalAiConfig();
  const provider = (args.provider ?? config.provider) as LocalAiProviderName;
  const model = args.model ?? config.model;
  const runId = randomUUID();

  const sources = caseUsableSources(evalCase);
  const sourcesById = new Map(sources.map((source) => [source.id, source]));
  const storedBySourceId = new Map(
    evalCase.summaries
      .filter((summary) => !args.model || summary.modelName === args.model)
      .map((summary) => [summary.sourceRecordId, summary])
  );

  if (args.stored && storedBySourceId.size === 0) {
    log('No stored summaries in this case to score', {
      case: evalCase.manifest.name,
      model: args.model,
      available: evalCase.manifest.summaryModels,
    });
    return;
  }

  // Sources only — see the note above on why summaries stay out of the dataset.
  const sampleIds = new Set(evalCase.manifest.sampleSourceIds ?? []);
  const examples = sources.map((source) => {
    const fullText = source.contentText ?? '';
    return {
      id: summaryExampleId(source.id),
      ...(sampleIds.has(source.id) ? { splits: [SAMPLE_SPLIT] } : {}),
      input: {
        sourceRecordId: source.id,
        title: source.title,
        provider: source.providerName,
        sourceText: fullText.slice(0, SOURCE_SUMMARY_CONTENT_LIMIT),
        sourceLength: fullText.length,
        truncated: fullText.length > SOURCE_SUMMARY_CONTENT_LIMIT,
      },
    };
  });

  const mode = args.stored ? 'stored' : 'generated';
  log('Scoring case summaries', {
    case: evalCase.manifest.name,
    mode,
    sources: examples.length,
    ...(args.split ? { split: args.split, sampleSize: sampleIds.size } : {}),
    ...(args.stored
      ? { storedSummaries: storedBySourceId.size }
      : { provider, model, concurrency: args.concurrency ?? 4 }),
    ...(args.limit ? { limit: args.limit, recorded: false } : {}),
  });

  const client = await createPhoenixClient();
  const { runExperiment, asEvaluator } =
    await import('@arizeai/phoenix-client/experiments');

  const resolved = await ensureDataset({
    client,
    evalCase,
    purpose: 'summary',
    datasetName: `summary-quality-${evalCase.manifest.name}`,
    examples,
    description: `Source summaries for eval case ${evalCase.manifest.name}`,
    reconcile: args.reconcile,
    log,
  });

  if (args.reconcile) {
    log('Reconcile complete', { datasetId: resolved.datasetId });
    return;
  }

  const summarizeSource = async (
    sourceRecordId: string
  ): Promise<SummaryExampleOutput> => {
    const source = sourcesById.get(sourceRecordId);
    if (!source) return { summaryText: null, evidenceCandidateText: null };
    const result = await generateLocalText({
      provider,
      model,
      prompt: buildSourceSummaryPrompt(
        source as unknown as Parameters<typeof buildSourceSummaryPrompt>[0]
      ),
      action: 'summarize_sources',
      label: `source-summary-${sourceRecordId}`,
      runId,
      rawOutputDir: config.rawOutputDir,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaNumCtx: config.ollamaNumCtx,
    });
    const parsed = extractJsonObject(result.text);
    if (!parsed) {
      return {
        summaryText: result.text.trim().slice(0, 4000),
        evidenceCandidateText: null,
        parseError: true,
      };
    }
    return {
      summaryText: typeof parsed.summary === 'string' ? parsed.summary : null,
      evidenceCandidateText:
        typeof parsed.evidence_candidate === 'string'
          ? parsed.evidence_candidate
          : null,
    };
  };

  const splits = args.split ? [args.split] : undefined;
  if (splits && sampleIds.size === 0) {
    log('This case defines no sample split; re-export to create one', {
      case: evalCase.manifest.name,
    });
    return;
  }

  const experiment = await runExperiment({
    client,
    dataset: {
      datasetId: resolved.datasetId,
      ...(resolved.versionId ? { versionId: resolved.versionId } : {}),
      ...(splits ? { splits } : {}),
    },
    experimentName: `summary-${mode}-${splits ? `${args.split}-` : ''}${provider}-${model}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    experimentDescription: args.stored
      ? `Stored summary quality on case ${evalCase.manifest.name}`
      : `Summary quality for ${provider}/${model} on case ${evalCase.manifest.name}`,
    experimentMetadata: {
      caseName: evalCase.manifest.name,
      mode,
      provider,
      model,
      promptVersion: SOURCE_SUMMARY_PROMPT_VERSION,
      datasetVersionId: resolved.versionId,
      ...(splits ? { split: args.split } : {}),
    },
    task: async (example) => {
      const sourceRecordId = String(
        (example.input as Record<string, unknown>).sourceRecordId
      );
      if (args.stored) {
        const stored = storedBySourceId.get(sourceRecordId);
        return {
          summaryText: stored?.summaryText ?? null,
          evidenceCandidateText: stored?.evidenceCandidateText ?? null,
        } as Record<string, unknown>;
      }
      return (await summarizeSource(sourceRecordId)) as Record<string, unknown>;
    },
    evaluators: SUMMARY_EVALUATORS.map((evaluator) =>
      asEvaluator({
        name: evaluator.name,
        kind: 'CODE',
        evaluate: ({ input, output }) =>
          evaluator.evaluate({
            input: input as unknown as SummaryExampleInput,
            output: (output ?? {}) as unknown as SummaryExampleOutput,
          }),
      })
    ),
    concurrency: args.concurrency ?? 4,
    // A limit runs a subset locally without recording, for quick iteration.
    ...(args.limit ? { dryRun: args.limit } : {}),
    setGlobalTracerProvider: false,
  });

  log('Summary quality experiment complete', {
    experimentId: experiment.id,
    mode,
    recorded: !args.limit,
  });
}

/**
 * Resolves the reference report for the one command that still reads live
 * data. A pinned --report id keeps the baseline fixed; "latest published"
 * moves whenever a report is generated.
 */
/**
 * The report-generation dataset holds one example: the case's inputs with the
 * published report as the expected output.
 *
 * Both compare and evaluate build it, and they must build it identically --
 * the content hash decides whether a run reuses the pinned dataset version or
 * pushes a new one, so any difference would silently fork the history the two
 * commands are meant to share.
 */
