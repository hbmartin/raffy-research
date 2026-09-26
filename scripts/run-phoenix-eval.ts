/* oxlint-disable no-process-env */
/**
 * Standalone Phoenix eval pipeline.
 *
 * Evals read git-stored eval cases (see scripts/eval/case.ts) rather than live
 * data, so an experiment run today is comparable with one run months ago. A
 * case pins its own Phoenix dataset id, which is what keeps that history on a
 * single dataset in the Phoenix UI.
 *
 * Usage:
 *   pnpm eval:phoenix export    --workspace <id> [--report <id>] [--out <dir>]
 *   pnpm eval:phoenix summarize --workspace <id> --case <dir> [--sample]
 *   pnpm eval:phoenix compare   --workspace <id> --case <dir> [--judge]
 *   pnpm eval:phoenix evaluate  --workspace <id> [--report <id>]
 */
import { randomUUID } from 'node:crypto';

import {
  buildReportPrompt,
  buildSourceSummaryPrompt,
  formatPeriodDate,
  JUDGE_PROMPT_VERSION,
  type LocalAiProviderName,
  parseGeneratedReportJson,
  SOURCE_SUMMARY_CONTENT_LIMIT,
  SOURCE_SUMMARY_PROMPT_VERSION,
} from '@/modules/intelligence';
import {
  generateLocalText,
  getLocalAiConfig,
  getPhoenixConfig,
} from '@/modules/intelligence/backend';
import { toWorkspaceId, type WorkspaceId } from '@/modules/kernel';
import type { JsonObject } from '@/modules/kernel/domain/json';

import {
  type CaseSource,
  type EvalCase,
  exampleId,
  loadCase,
  SAMPLE_SPLIT,
  summaryExampleId,
  usableSources as caseUsableSources,
} from './eval/case';
import { exportCase } from './eval/export-case';
import { createJudgeEvaluators } from './eval/judge-evaluators';
import { ensureDataset } from './eval/phoenix-dataset';
import {
  SUMMARY_EVALUATORS,
  type SummaryExampleInput,
  type SummaryExampleOutput,
} from './eval/summary-evaluators';

type Command = 'summarize' | 'evaluate' | 'compare' | 'export';

type CliArgs = {
  command: Command;
  workspaceId: WorkspaceId;
  provider?: string;
  model?: string;
  caseDir?: string;
  reportId?: string;
  outDir?: string;
  caseName?: string;
  summaryModels?: string[];
  stored?: boolean;
  limit?: number;
  concurrency?: number;
  split?: string;
  sampleSize?: number;
  sampleSourceIds?: string[];
  reconcile?: boolean;
  judge?: boolean;
  judgeProvider?: string;
  judgeModel?: string;
};

function parseArgs(argv: string[]): CliArgs {
  const allArgs = argv.slice(2);
  const args = allArgs.filter((a) => !a.endsWith('.ts'));
  const command = args[0] as Command;
  if (
    ![
      'summarize',
      'generate',
      'evaluate',
      'compare',
      'full',
      'export',
    ].includes(command)
  ) {
    console.error(
      [
        'Usage: run-phoenix-eval.ts <command> --workspace <id> [options]',
        '',
        'Commands:',
        '  export     Write a git-storable eval case from the database',
        '  compare    Regenerate a report and score it against the case reference',
        "  summarize  Summarize a case's sources and score the result",
        "  evaluate   Judge the case's published reference report with the LLM judges",
        '',
        'Options:',
        '  --workspace <id>   Workspace to operate on (required)',
        '  --case <dir>       Read inputs from an eval case; no database access',
        '  --report <id>      Pin a specific report instead of the latest published',
        '  --out <dir>        Destination for export (default fixtures/eval/<name>)',
        '  --name <name>      Case name for export (default <company>-<period start>)',
        "  --summary-model <m>  Export only this model's summaries (repeatable)",
        '  --provider <p>     Override LOCAL_AI_PROVIDER',
        '  --model <m>        Override LOCAL_AI_MODEL',
        '',
        'summarize options:',
        "  --sample           Run only the case's fixed sample split (default 10 sources)",
        '  --split <name>     Run only this dataset split',
        '  --sample-size <n>  Sources in the sample split, set at export (default 10)',
        '  --sample-source <id>  Pin a specific source into the sample (repeatable)',
        '  --stored           Score summaries already in the case, without generating',
        '  --limit <n>        Run only n examples, and do not record to Phoenix',
        '  --concurrency <n>  Examples processed in parallel (default 4)',
        '',
        'compare options:',
        '  --reconcile        Replace stale dataset examples, then exit without running',
        '  --judge            Add LLM-judge evaluators (3 extra model calls per run)',
        '  --judge-provider <p>  Provider for the judge (default: the generation provider)',
        '  --judge-model <m>  Model for the judge; prefer one that did not write the report',
      ].join('\n')
    );
    process.exit(1);
  }

  let workspaceId: string | undefined;
  let provider: string | undefined;
  let model: string | undefined;
  let caseDir: string | undefined;
  let reportId: string | undefined;
  let outDir: string | undefined;
  let caseName: string | undefined;
  let summaryModels: string[] | undefined;
  let stored = false;
  let limit: number | undefined;
  let concurrency: number | undefined;
  let split: string | undefined;
  let sampleSize: number | undefined;
  let sampleSourceIds: string[] | undefined;
  let reconcile = false;
  let judge = false;
  let judgeProvider: string | undefined;
  let judgeModel: string | undefined;

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--workspace' || arg === '-w') {
      workspaceId = args[++i];
    } else if (arg?.startsWith('--workspace=')) {
      workspaceId = arg.slice('--workspace='.length);
    } else if (arg === '--provider') {
      provider = args[++i];
    } else if (arg?.startsWith('--provider=')) {
      provider = arg.slice('--provider='.length);
    } else if (arg === '--model') {
      model = args[++i];
    } else if (arg?.startsWith('--model=')) {
      model = arg.slice('--model='.length);
    } else if (arg === '--case' || arg === '--fixture') {
      caseDir = args[++i];
    } else if (arg?.startsWith('--case=')) {
      caseDir = arg.slice('--case='.length);
    } else if (arg?.startsWith('--fixture=')) {
      caseDir = arg.slice('--fixture='.length);
    } else if (arg === '--report') {
      reportId = args[++i];
    } else if (arg?.startsWith('--report=')) {
      reportId = arg.slice('--report='.length);
    } else if (arg === '--out') {
      outDir = args[++i];
    } else if (arg?.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
    } else if (arg === '--reconcile') {
      reconcile = true;
    } else if (arg === '--judge') {
      judge = true;
    } else if (arg === '--judge-provider') {
      judgeProvider = args[++i];
      judge = true;
    } else if (arg?.startsWith('--judge-provider=')) {
      judgeProvider = arg.slice('--judge-provider='.length);
      judge = true;
    } else if (arg === '--judge-model') {
      judgeModel = args[++i];
      judge = true;
    } else if (arg?.startsWith('--judge-model=')) {
      judgeModel = arg.slice('--judge-model='.length);
      judge = true;
    } else if (arg === '--sample') {
      split = SAMPLE_SPLIT;
    } else if (arg === '--split') {
      split = args[++i];
    } else if (arg?.startsWith('--split=')) {
      split = arg.slice('--split='.length);
    } else if (arg === '--sample-size') {
      sampleSize = Number(args[++i]);
    } else if (arg?.startsWith('--sample-size=')) {
      sampleSize = Number(arg.slice('--sample-size='.length));
    } else if (arg === '--sample-source') {
      const value = args[++i];
      if (value) sampleSourceIds = [...(sampleSourceIds ?? []), value];
    } else if (arg?.startsWith('--sample-source=')) {
      sampleSourceIds = [
        ...(sampleSourceIds ?? []),
        arg.slice('--sample-source='.length),
      ];
    } else if (arg === '--stored') {
      stored = true;
    } else if (arg === '--limit') {
      limit = Number(args[++i]);
    } else if (arg?.startsWith('--limit=')) {
      limit = Number(arg.slice('--limit='.length));
    } else if (arg === '--concurrency') {
      concurrency = Number(args[++i]);
    } else if (arg?.startsWith('--concurrency=')) {
      concurrency = Number(arg.slice('--concurrency='.length));
    } else if (arg === '--summary-model') {
      const value = args[++i];
      if (value) summaryModels = [...(summaryModels ?? []), value];
    } else if (arg?.startsWith('--summary-model=')) {
      summaryModels = [
        ...(summaryModels ?? []),
        arg.slice('--summary-model='.length),
      ];
    } else if (arg === '--name') {
      caseName = args[++i];
    } else if (arg?.startsWith('--name=')) {
      caseName = arg.slice('--name='.length);
    } else if (arg?.startsWith('-')) {
      // Silently ignoring a flag makes a typo look like a run that honoured
      // it, which is worse than refusing outright.
      console.error(`Unknown option: ${arg}`);
      process.exit(1);
    }
  }

  if (!workspaceId) {
    console.error('--workspace is required');
    process.exit(1);
  }

  return {
    command,
    workspaceId: toWorkspaceId(workspaceId),
    provider,
    model,
    caseDir,
    reportId,
    outDir,
    caseName,
    summaryModels,
    stored,
    limit,
    concurrency,
    split,
    sampleSize,
    sampleSourceIds,
    reconcile,
    judge,
    judgeProvider,
    judgeModel,
  };
}

function log(message: string, data?: Record<string, unknown>) {
  const line = data ? `${message} ${JSON.stringify(data)}` : message;
  console.log(`[phoenix-eval] ${line}`);
}

function extractJsonObject(text: string): JsonObject | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i)?.[1];
  const candidate = fenced ?? trimmed;
  try {
    const parsed = JSON.parse(candidate);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? (parsed as JsonObject)
      : null;
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    try {
      const parsed = JSON.parse(candidate.slice(start, end + 1));
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
        ? (parsed as JsonObject)
        : null;
    } catch {
      return null;
    }
  }
}

type FixtureReport = {
  id: string;
  reportData: JsonObject | null;
  periodStart: Date;
  periodEnd: Date;
  modelMetadata?: JsonObject | null;
};

type FixtureSource = CaseSource;

/** An eval case, shaped for the code paths that predate cases. */
function caseAsFixture(evalCase: EvalCase): {
  report: FixtureReport;
  sources: FixtureSource[];
} {
  return {
    report: {
      id: evalCase.report.id,
      reportData: evalCase.report.reportData as JsonObject | null,
      periodStart: new Date(evalCase.report.periodStart),
      periodEnd: new Date(evalCase.report.periodEnd),
      modelMetadata: evalCase.report.modelMetadata as JsonObject | null,
    },
    sources: evalCase.sources,
  };
}

/**
 * Summarizes a case's sources and scores the result, as one Phoenix experiment.
 *
 * The dataset holds the *sources*, never the summaries: that keeps it stable
 * while prompts and models change, so every experiment on it is a like-for-like
 * comparison. Each run is a (prompt, provider, model) trial against those same
 * inputs — which is the loop that makes prompt iteration worth measuring.
 *
 * `--stored` scores the summaries already in the case instead of generating,
 * for a free baseline or a model-vs-model comparison over existing text.
 */
async function runSummarizeCase(args: CliArgs) {
  if (!args.caseDir) throw new Error('--case is required');
  const evalCase = loadCase(args.caseDir);
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

  const phoenixConfig = getPhoenixConfig();
  if (!phoenixConfig.enabled) {
    console.error('PHOENIX_APP_URL and PHOENIX_API_KEY must be set');
    process.exit(1);
  }

  const { createClient } = await import('@arizeai/phoenix-client');
  const { runExperiment, asEvaluator } =
    await import('@arizeai/phoenix-client/experiments');

  const client = createClient({
    options: {
      baseUrl: phoenixConfig.appUrl,
      headers: { Authorization: `Bearer ${phoenixConfig.apiKey}` },
    },
  });

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
function buildCompareExample(
  evalCase: EvalCase,
  report: FixtureReport,
  sources: FixtureSource[]
) {
  return {
    id: exampleId(evalCase),
    input: {
      workspaceId: evalCase.manifest.workspaceId,
      reportId: report.id,
      periodStart: report.periodStart.toISOString(),
      periodEnd: report.periodEnd.toISOString(),
      sourceCount: sources.length,
      sources: sources.map((s) => ({
        id: s.id,
        title: s.title,
        provider: s.providerName,
        contentText: s.contentText?.slice(0, 2000),
      })),
    },
    output: (report.reportData ?? {}) as Record<string, unknown>,
    metadata: {
      referenceModel: (report.modelMetadata as Record<string, unknown>)
        ?.modelName,
    },
  };
}

/**
 * Judges a case's published reference report with the same scoped judges that
 * score a generated one.
 *
 * This is the other half of the question compare answers: not "is a fresh
 * generation any good" but "was the report we actually shipped any good". It
 * runs on the case's own dataset, so the reference's scores sit beside every
 * generated run's and can be read against them directly.
 *
 * Only the judges run. The deterministic evaluators compare a report to the
 * reference, and here they are the same document, so they would report a
 * perfect score that means nothing.
 */
async function runEvaluate(args: CliArgs) {
  if (!args.caseDir) throw new Error('--case is required');
  const evalCase = loadCase(args.caseDir);
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

  const phoenixConfig = getPhoenixConfig();
  if (!phoenixConfig.enabled) {
    console.error('PHOENIX_APP_URL and PHOENIX_API_KEY must be set');
    process.exit(1);
  }

  const { createClient } = await import('@arizeai/phoenix-client');
  const { runExperiment, asEvaluator } =
    await import('@arizeai/phoenix-client/experiments');
  const client = createClient({
    options: {
      baseUrl: phoenixConfig.appUrl,
      headers: { Authorization: `Bearer ${phoenixConfig.apiKey}` },
    },
  });

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
    setGlobalTracerProvider: false,
  });

  log('Reference report judgement complete', { experimentId: experiment.id });
}

async function runCompare(args: CliArgs) {
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
  const evalCase = loadCase(args.caseDir);
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

  const phoenixConfig = getPhoenixConfig();
  if (!phoenixConfig.enabled) {
    console.error('PHOENIX_APP_URL and PHOENIX_API_KEY must be set');
    process.exit(1);
  }

  const { createClient } = await import('@arizeai/phoenix-client');
  const { createDataset } = await import('@arizeai/phoenix-client/datasets');
  const { runExperiment, asEvaluator } =
    await import('@arizeai/phoenix-client/experiments');

  const client = createClient({
    options: {
      baseUrl: phoenixConfig.appUrl,
      headers: { Authorization: `Bearer ${phoenixConfig.apiKey}` },
    },
  });

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
    task: async () => {
      const result = await generateLocalText({
        provider,
        model,
        prompt,
        action: 'compare_report',
        label: `compare-${report.id}`,
        runId,
        rawOutputDir: config.rawOutputDir,
        ollamaBaseUrl: config.ollamaBaseUrl,
        ollamaNumCtx: config.ollamaNumCtx,
      });
      const parsed = parseGeneratedReportJson(result.text);
      if (parsed.type === 'generated_report_data_valid') {
        return parsed.data as unknown as Record<string, unknown>;
      }
      return { rawText: result.text.slice(0, 8000), parseError: true };
    },
    evaluators: [
      asEvaluator({
        name: 'source_overlap',
        kind: 'CODE',
        evaluate: ({ output, expected }) => {
          const refData = expected as Record<string, unknown> | undefined;
          const genData = output as Record<string, unknown> | null;
          if (!refData || !genData) return { score: null };

          const extractSourceIds = (
            data: Record<string, unknown>
          ): Set<string> => {
            const ids = new Set<string>();
            const walk = (obj: unknown) => {
              if (!obj || typeof obj !== 'object') return;
              if (Array.isArray(obj)) {
                obj.forEach(walk);
                return;
              }
              const record = obj as Record<string, unknown>;
              if ('source_ids' in record && Array.isArray(record.source_ids)) {
                record.source_ids.forEach((id) => {
                  if (typeof id === 'string') ids.add(id);
                });
              }
              Object.values(record).forEach(walk);
            };
            walk(data);
            return ids;
          };

          const refIds = extractSourceIds(refData);
          const genIds = extractSourceIds(genData);
          if (refIds.size === 0) return { score: null };
          const overlap = [...refIds].filter((id) => genIds.has(id)).length;
          const score = overlap / refIds.size;
          return {
            score,
            label: `${overlap}/${refIds.size}`,
            metadata: {
              referenceSourceCount: refIds.size,
              generatedSourceCount: genIds.size,
              overlapCount: overlap,
            },
          };
        },
      }),
      asEvaluator({
        name: 'cluster_count',
        kind: 'CODE',
        evaluate: ({ output, expected }) => {
          const refData = expected as Record<string, unknown> | undefined;
          const genData = output as Record<string, unknown> | null;
          if (!refData || !genData) return { score: null };
          const refClusters = Array.isArray(refData.topic_clusters)
            ? refData.topic_clusters.length
            : 0;
          const genClusters = Array.isArray(genData.topic_clusters)
            ? genData.topic_clusters.length
            : 0;
          const match = refClusters === genClusters ? 1 : 0;
          return {
            score: match,
            label: `${genClusters}/${refClusters}`,
            metadata: {
              referenceClusters: refClusters,
              generatedClusters: genClusters,
            },
          };
        },
      }),
      asEvaluator({
        name: 'valid_json',
        kind: 'CODE',
        evaluate: ({ output }) => {
          const data = output as Record<string, unknown> | null;
          const isValid = data !== null && !data?.parseError;
          return {
            score: isValid ? 1 : 0,
            label: isValid ? 'valid' : 'invalid',
          };
        },
      }),
      asEvaluator({
        name: 'source_utilization',
        kind: 'CODE',
        evaluate: ({ input, output }) => {
          const genData = output as Record<string, unknown> | null;
          const inputData = input as Record<string, unknown>;
          if (!genData || genData.parseError) return { score: null };
          const availableCount = (inputData.sourceCount as number) || 1;
          const cited = new Set<string>();
          const walk = (obj: unknown) => {
            if (!obj || typeof obj !== 'object') return;
            if (Array.isArray(obj)) {
              obj.forEach(walk);
              return;
            }
            const rec = obj as Record<string, unknown>;
            if ('source_ids' in rec && Array.isArray(rec.source_ids)) {
              rec.source_ids.forEach((id) => {
                if (typeof id === 'string') cited.add(id);
              });
            }
            Object.values(rec).forEach(walk);
          };
          walk(genData);
          const score = cited.size / availableCount;
          return {
            score,
            label: `${cited.size}/${availableCount}`,
            metadata: { citedCount: cited.size, availableCount },
          };
        },
      }),
      asEvaluator({
        name: 'competitor_overlap',
        kind: 'CODE',
        evaluate: ({ output, expected }) => {
          const refData = expected as Record<string, unknown> | undefined;
          const genData = output as Record<string, unknown> | null;
          if (!refData || !genData) return { score: null };
          const extractNames = (data: Record<string, unknown>): Set<string> => {
            const names = new Set<string>();
            const items = data.competitor_watch;
            if (Array.isArray(items)) {
              items.forEach((item) => {
                const name = (item as Record<string, unknown>)?.competitor_name;
                if (typeof name === 'string') names.add(name.toLowerCase());
              });
            }
            return names;
          };
          const refNames = extractNames(refData);
          const genNames = extractNames(genData);
          if (refNames.size === 0) return { score: null };
          const overlap = [...refNames].filter((n) => genNames.has(n)).length;
          return {
            score: overlap / refNames.size,
            label: `${overlap}/${refNames.size}`,
            metadata: {
              referenceCompetitors: [...refNames],
              generatedCompetitors: [...genNames],
              overlapCount: overlap,
            },
          };
        },
      }),
      asEvaluator({
        name: 'lead_overlap',
        kind: 'CODE',
        evaluate: ({ output, expected }) => {
          const refData = expected as Record<string, unknown> | undefined;
          const genData = output as Record<string, unknown> | null;
          if (!refData || !genData) return { score: null };
          const extractIds = (data: Record<string, unknown>): Set<string> => {
            const ids = new Set<string>();
            const items = data.possible_leads;
            if (Array.isArray(items)) {
              items.forEach((item) => {
                const id = (item as Record<string, unknown>)?.id;
                if (typeof id === 'string') ids.add(id);
              });
            }
            return ids;
          };
          const refIds = extractIds(refData);
          const genIds = extractIds(genData);
          if (refIds.size === 0) return { score: null };
          const overlap = [...refIds].filter((id) => genIds.has(id)).length;
          return {
            score: overlap / refIds.size,
            label: `${overlap}/${refIds.size}`,
            metadata: {
              referenceLeads: refIds.size,
              generatedLeads: genIds.size,
              overlapCount: overlap,
            },
          };
        },
      }),
      asEvaluator({
        name: 'evidence_density',
        kind: 'CODE',
        evaluate: ({ output }) => {
          const data = output as Record<string, unknown> | null;
          if (!data || data.parseError) return { score: null };
          const clusters = data.topic_clusters;
          if (!Array.isArray(clusters) || clusters.length === 0)
            return { score: 0, label: 'no clusters' };
          let totalEvidence = 0;
          for (const cluster of clusters) {
            const c = cluster as Record<string, unknown>;
            const allEv = c.all_evidence;
            const repEv = c.representative_evidence;
            totalEvidence += Array.isArray(allEv) ? allEv.length : 0;
            totalEvidence += Array.isArray(repEv) ? repEv.length : 0;
          }
          const density = totalEvidence / clusters.length;
          return {
            score: density,
            label: `${totalEvidence}ev/${clusters.length}cl`,
            metadata: {
              totalEvidence,
              clusterCount: clusters.length,
              avgPerCluster: density,
            },
          };
        },
      }),
      ...judgeEvaluators.map((judge) =>
        asEvaluator({
          name: judge.name,
          kind: 'LLM',
          evaluate: async ({ input, output }) => {
            const generated = output as Record<string, unknown> | null;
            if (!generated || generated.parseError) {
              return { score: null, label: 'no-report' };
            }
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
    setGlobalTracerProvider: false,
  });

  log('Report generation comparison complete', {
    experimentId: experiment.id,
    experimentName: experiment.metadata?.experimentName,
  });
}

async function main() {
  const args = parseArgs(process.argv);

  // Export is the one command that reads live data on purpose, and it needs no
  // Phoenix credentials.
  if (args.command === 'export') {
    const outDir = args.outDir ?? `fixtures/eval/${args.caseName ?? 'case'}`;
    await exportCase({
      workspaceId: args.workspaceId,
      reportId: args.reportId,
      name: args.caseName,
      summaryModels: args.summaryModels,
      sampleSize: args.sampleSize,
      sampleSourceIds: args.sampleSourceIds,
      outDir,
      log,
    });
    log('Done');
    return;
  }

  // Experiments read pinned cases, never live data: a run against whatever the
  // database happens to hold today is not comparable with anything.
  if (!args.caseDir && args.command !== 'evaluate') {
    console.error(
      `[phoenix-eval] "${args.command}" requires --case <dir>. Mint one with: pnpm eval:phoenix export --workspace ${args.workspaceId} --report <id> --out fixtures/eval/<name>`
    );
    process.exit(1);
  }

  try {
    if (args.command === 'summarize') {
      await runSummarizeCase(args);
    }
    if (args.command === 'evaluate') {
      await runEvaluate(args);
    }
    if (args.command === 'compare') {
      await runCompare(args);
    }
    log('Done');
    // Telemetry exporters and DB pools can keep the loop alive; every path
    // above has awaited its work, so leaving is safe and avoids a hang.
    process.exit(0);
  } catch (error) {
    console.error(
      '[phoenix-eval] Fatal error:',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

void main();
