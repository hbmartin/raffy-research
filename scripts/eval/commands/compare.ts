import { randomUUID } from 'node:crypto';

import {
  buildRepairPrompt,
  buildReportPrompt,
  formatPeriodDate,
  JUDGE_PROMPT_VERSION,
  type LocalAiProviderName,
  parseGeneratedReportJson,
  REPORT_PROMPT_VERSION,
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
import {
  buildCompareExample,
  caseAsFixture,
  stripRunMetadata,
} from '../fixtures';
import { createJudgeEvaluators } from '../judge-evaluators';
import { log } from '../log';
import { createPhoenixClient } from '../phoenix-client';
import { ensureDataset } from '../phoenix-dataset';
import { REPORT_EVALUATORS } from '../report-evaluators';

export async function runCompare(args: CliArgs) {
  if (args.split) {
    // One compare example is a whole report, so there is no subset to select.
    // Saying so beats silently ignoring the flag and looking cheap.
    log('Ignoring --sample/--split: compare evaluates one report per run', {
      split: args.split,
      sources: 'all',
    });
  }

  const config = getLocalAiConfig();
  const provider = (args.provider ?? config.provider) as LocalAiProviderName;
  const model = args.model ?? config.model;
  const runId = randomUUID();

  if (!args.caseDir) throw new Error('--case is required');

  // The case carries every prompt input, so compare never touches the DB.
  const evalCase = loadCaseForWorkspace(args.caseDir, args.workspaceId);
  const { report } = caseAsFixture(evalCase);
  const usableSources = caseUsableSources(evalCase);
  const timezone = String(
    evalCase.workspace.workspace.timezone ?? 'America/Los_Angeles'
  );
  log('Loaded eval case', {
    dir: evalCase.dir,
    name: evalCase.manifest.name,
    reportId: report.id,
    sources: usableSources.length,
  });
  const prompt = buildReportPrompt({
    workspace: evalCase.workspace.workspace as unknown as Parameters<
      typeof buildReportPrompt
    >[0]['workspace'],
    keywords: evalCase.workspace.keywords as unknown as Parameters<
      typeof buildReportPrompt
    >[0]['keywords'],
    competitors: evalCase.workspace.competitors as unknown as Parameters<
      typeof buildReportPrompt
    >[0]['competitors'],
    socialAccounts: evalCase.workspace.socialAccounts as unknown as Parameters<
      typeof buildReportPrompt
    >[0]['socialAccounts'],
    sources: usableSources as unknown as Parameters<
      typeof buildReportPrompt
    >[0]['sources'],
    priorReports: evalCase.priorReports as unknown as Parameters<
      typeof buildReportPrompt
    >[0]['priorReports'],
    periodStartLabel: formatPeriodDate(report.periodStart, timezone),
    periodEndLabel: formatPeriodDate(report.periodEnd, timezone),
  });

  log('Starting report generation comparison', {
    referenceReportId: report.id,
    sources: usableSources.length,
    provider,
    model,
  });

  const client = await createPhoenixClient();
  const { createDataset } = await import('@arizeai/phoenix-client/datasets');
  const { runExperiment, asEvaluator } =
    await import('@arizeai/phoenix-client/experiments');

  const example = buildCompareExample(evalCase, report, usableSources);

  let datasetId: string;
  let versionId: string | undefined;

  if (evalCase) {
    // Cases own their Phoenix dataset for life, so runs weeks apart compare.
    const resolvedDataset = await ensureDataset({
      client,
      evalCase,
      purpose: 'reportGeneration',
      datasetName: `report-generation-${evalCase.manifest.name}`,
      examples: [example],
      description: `Report generation comparison for eval case ${evalCase.manifest.name}`,
      reconcile: args.reconcile,
      log,
    });
    datasetId = resolvedDataset.datasetId;
    versionId = resolvedDataset.versionId;
  } else {
    // Ad-hoc run against live data: a throwaway dataset, not comparable across
    // runs. Export a case to get a stable one.
    log('No --case given; creating a throwaway dataset from live data');
    const created = await createDataset({
      client,
      name: `report-generation-${args.workspaceId}`,
      description: `Ad-hoc report generation comparison for workspace ${args.workspaceId}`,
      examples: [example],
    });
    datasetId = created.datasetId;
  }

  if (args.reconcile) {
    // Repair only: generating a report here would burn a model call nobody
    // asked for.
    log('Reconcile complete', { datasetId });
    return;
  }

  const judgeProvider = (args.judgeProvider ?? provider) as LocalAiProviderName;
  const judgeModel = args.judgeModel ?? model;
  if (args.judge && judgeProvider === provider && judgeModel === model) {
    log(
      'Judge and generator are the same model; scores will flatter the report',
      { model: judgeModel }
    );
  }
  const judgeEvaluators = args.judge
    ? createJudgeEvaluators(async ({ prompt, label }) => {
        const result = await generateLocalText({
          provider: judgeProvider,
          model: judgeModel,
          prompt,
          action: 'judge_report',
          label,
          runId,
          rawOutputDir: config.rawOutputDir,
          ollamaBaseUrl: config.ollamaBaseUrl,
          ollamaNumCtx: config.ollamaNumCtx,
          // Judges are graders, not authors: variance is noise here.
          temperature: 0,
        });
        return result.text;
      })
    : [];

  const experiment = await runExperiment({
    client,
    dataset: versionId ? { datasetId, versionId } : { datasetId },
    experimentName: `compare-${provider}-${model}-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    experimentDescription: `Generate report with ${provider}/${model} and compare to published report ${report.id}`,
    experimentMetadata: {
      provider,
      model,
      // Scores move when the prompt changes, so a run that does not say which
      // prompt it used cannot be compared with one from last month.
      reportPromptVersion: REPORT_PROMPT_VERSION,
      referenceReportId: report.id,
      ...(evalCase
        ? { caseName: evalCase.manifest.name, datasetVersionId: versionId }
        : {}),
      ...(args.judge
        ? {
            judgeProvider,
            judgeModel,
            judgePromptVersion: JUDGE_PROMPT_VERSION,
          }
        : {}),
    },
    // Mirrors generateWeeklyReport: one attempt, then a single repair pass
    // carrying the original prompt, the invalid output and the specific
    // validation issues. Without it this measured first-attempt validity and
    // reported it as though it were what production ships.
    task: async () => {
      const generate = (attemptPrompt: string, label: string) =>
        generateLocalText({
          provider,
          model,
          prompt: attemptPrompt,
          action: 'compare_report',
          label,
          runId,
          rawOutputDir: config.rawOutputDir,
          ollamaBaseUrl: config.ollamaBaseUrl,
          ollamaNumCtx: config.ollamaNumCtx,
        });

      const first = await generate(prompt, `compare-${report.id}`);
      const firstParsed = parseGeneratedReportJson(first.text);
      if (firstParsed.type === 'generated_report_data_valid') {
        return {
          ...(firstParsed.data as unknown as Record<string, unknown>),
          __firstAttemptValid: true,
          __repaired: false,
        };
      }

      const repair = await generate(
        buildRepairPrompt({
          originalPrompt: prompt,
          invalidOutput: first.text,
          issues: firstParsed.issues,
        }),
        `compare-${report.id}-repair`
      );
      const repaired = parseGeneratedReportJson(repair.text);
      if (repaired.type === 'generated_report_data_valid') {
        log('First attempt failed validation; repair succeeded', {
          issues: firstParsed.issues.slice(0, 5),
        });
        return {
          ...(repaired.data as unknown as Record<string, unknown>),
          __firstAttemptValid: false,
          __repaired: true,
        };
      }

      log('First attempt and repair both failed validation', {
        issues: repaired.issues.slice(0, 5),
      });
      return {
        rawText: repair.text.slice(0, 8000),
        parseError: true,
        __firstAttemptValid: false,
        __repaired: true,
      };
    },
    evaluators: [
      ...REPORT_EVALUATORS.map((evaluator) =>
        asEvaluator({
          name: evaluator.name,
          kind: 'CODE',
          evaluate: (args) => evaluator.evaluate(args),
        })
      ),
      ...judgeEvaluators.map((judge) =>
        asEvaluator({
          name: judge.name,
          kind: 'LLM',
          evaluate: async ({ input, output }) => {
            const raw = output as Record<string, unknown> | null;
            if (!raw || raw.parseError) {
              return { score: null, label: 'no-report' };
            }
            const generated = stripRunMetadata(raw);
            const inputData = input as Record<string, unknown>;
            const sourceIds = new Set(
              (Array.isArray(inputData.sources) ? inputData.sources : []).map(
                (source) => String((source as Record<string, unknown>).id)
              )
            );
            return judge.evaluate({
              reportJson: JSON.stringify(generated, null, 1),
              reportData: generated,
              // The judge reads full source text, not the truncated copy the
              // dataset carries for display.
              sources: usableSources.filter((source) =>
                sourceIds.has(source.id)
              ) as unknown as Parameters<typeof judge.evaluate>[0]['sources'],
            });
          },
        })
      ),
    ],
    // Left off deliberately. runExperiment would clear the global telemetry we
    // just registered and install its own for the duration of the task, then
    // restore it. That buys nothing here: the AI SDK integration resolves
    // `trace.getTracer` at module load and OpenTelemetry's proxy tracer caches
    // that delegate, so model calls keep reporting to our provider either way
    // -- verified by running with it on and watching the span still arrive in
    // the default project. Not worth swapping process globals for a no-op.
    setGlobalTracerProvider: false,
  });

  log('Report generation comparison complete', {
    experimentId: experiment.id,
    experimentName: experiment.metadata?.experimentName,
  });
}
