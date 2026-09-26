import { randomUUID } from 'node:crypto';

import {
  JUDGE_PROMPT_VERSION,
  type LocalAiProviderName,
} from '@/modules/intelligence';
import {
  generateLocalText,
  getLocalAiConfig,
} from '@/modules/intelligence/backend';

import {
  loadCaseForWorkspace,
  usableSources as caseUsableSources,
} from '../case';
import type { CliArgs } from '../cli-args';
import { caseAsFixture } from '../fixtures';
import { buildCompareExample } from '../fixtures';
import { createJudgeEvaluators } from '../judge-evaluators';
import { log } from '../log';
import { createPhoenixClient } from '../phoenix-client';
import { ensureDataset } from '../phoenix-dataset';

export async function runEvaluate(args: CliArgs) {
  if (!args.caseDir) throw new Error('--case is required');
  const evalCase = loadCaseForWorkspace(args.caseDir, args.workspaceId);
  const config = getLocalAiConfig();
  const provider = (args.judgeProvider ??
    config.provider) as LocalAiProviderName;
  const model = args.judgeModel ?? config.model;
  const runId = randomUUID();

  const { report } = caseAsFixture(evalCase);
  const sources = caseUsableSources(evalCase);
  if (!report.reportData) {
    log('The case pins no report data to judge', {
      case: evalCase.manifest.name,
    });
    return;
  }

  log('Judging the case reference report', {
    case: evalCase.manifest.name,
    reportId: report.id,
    sources: sources.length,
    provider,
    model,
  });

  const client = await createPhoenixClient();
  const { runExperiment, asEvaluator } =
    await import('@arizeai/phoenix-client/experiments');

  // The reference report is already this dataset's expected output, so the
  // reference and the generations it is compared against share one dataset.
  const resolved = await ensureDataset({
    client,
    evalCase,
    purpose: 'reportGeneration',
    datasetName: `report-generation-${evalCase.manifest.name}`,
    examples: [buildCompareExample(evalCase, report, sources)],
    description: `Report generation comparison for eval case ${evalCase.manifest.name}`,
    reconcile: args.reconcile,
    log,
  });

  if (args.reconcile) {
    log('Reconcile complete', { datasetId: resolved.datasetId });
    return;
  }

  const judges = createJudgeEvaluators(async ({ prompt, label }) => {
    const result = await generateLocalText({
      provider,
      model,
      prompt,
      action: 'judge_report',
      label,
      runId,
      rawOutputDir: config.rawOutputDir,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaNumCtx: config.ollamaNumCtx,
      temperature: 0,
    });
    return result.text;
  });

  const experiment = await runExperiment({
    client,
    dataset: resolved.versionId
      ? { datasetId: resolved.datasetId, versionId: resolved.versionId }
      : { datasetId: resolved.datasetId },
    experimentName: `evaluate-reference-${provider}-${model}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    experimentDescription: `Judge the published report ${report.id} of case ${evalCase.manifest.name}`,
    experimentMetadata: {
      caseName: evalCase.manifest.name,
      mode: 'reference',
      reportId: report.id,
      judgeProvider: provider,
      judgeModel: model,
      judgePromptVersion: JUDGE_PROMPT_VERSION,
      datasetVersionId: resolved.versionId,
    },
    // The report under judgement is the case's own reference.
    task: () => report.reportData as Record<string, unknown>,
    evaluators: judges.map((judge) =>
      asEvaluator({
        name: judge.name,
        kind: 'LLM',
        evaluate: async ({ output }) =>
          judge.evaluate({
            reportJson: JSON.stringify(output, null, 1),
            reportData: output,
            sources: sources as unknown as Parameters<
              typeof judge.evaluate
            >[0]['sources'],
          }),
      })
    ),
    // Left off deliberately. runExperiment would clear the global telemetry we
    // just registered and install its own for the duration of the task, then
    // restore it. That buys nothing here: the AI SDK integration resolves
    // `trace.getTracer` at module load and OpenTelemetry's proxy tracer caches
    // that delegate, so model calls keep reporting to our provider either way
    // -- verified by running with it on and watching the span still arrive in
    // the default project. Not worth swapping process globals for a no-op.
    setGlobalTracerProvider: false,
  });

  log('Reference report judgement complete', { experimentId: experiment.id });
}

/**
 * Asks whether the judges can tell a good report from a bad one.
 *
 * Scores mean nothing until this passes: a judge returning a constant looks
 * identical to a judge that works, and its verdicts would quietly steer
 * prompt and model decisions. Exits non-zero when a judge fails to notice, so
 * it can gate anything that reads judge scores.
 */
