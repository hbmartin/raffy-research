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
 *   pnpm eval:phoenix export   --workspace <id> [--report <id>] [--out <dir>]
 *   pnpm eval:phoenix compare  --workspace <id> --case <dir>
 *   pnpm eval:phoenix evaluate --workspace <id> --case <dir>
 *   pnpm eval:phoenix summarize --workspace <id> [--period <date>]
 *   pnpm eval:phoenix generate --workspace <id> [--period <date>]
 *   pnpm eval:phoenix full     --workspace <id> [--period <date>]
 */
import { randomUUID } from 'node:crypto';

import { getIntelligenceRepositories } from '@/composition/intelligence';
import { getKernel } from '@/composition/kernel';
import {
  buildEvalPrompt,
  buildReportPrompt,
  buildSourceSummaryPrompt,
  computeWeeklyPeriod,
  type EvalExperimentPort,
  formatPeriodDate,
  generateWeeklyReport,
  type LocalAiProviderName,
  parseGeneratedReportJson,
  SOURCE_SUMMARY_CONTENT_LIMIT,
  SOURCE_SUMMARY_PROMPT_VERSION,
  type WeeklyReportGenerationDeps,
} from '@/modules/intelligence';
import {
  createLocalAiReportGenerator,
  createPhoenixEvalAdapter,
  generateLocalText,
  getLocalAiConfig,
  getPhoenixConfig,
} from '@/modules/intelligence/backend';
import {
  toSourceRecordId,
  toWeeklyReportId,
  toWorkspaceId,
  type WorkspaceId,
} from '@/modules/kernel';
import type { JsonObject, JsonValue } from '@/modules/kernel/domain/json';

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
import { ensureDataset } from './eval/phoenix-dataset';
import {
  SUMMARY_EVALUATORS,
  type SummaryExampleInput,
  type SummaryExampleOutput,
} from './eval/summary-evaluators';

type Command =
  | 'summarize'
  | 'generate'
  | 'evaluate'
  | 'compare'
  | 'full'
  | 'export';

type CliArgs = {
  command: Command;
  workspaceId: WorkspaceId;
  periodDate: Date;
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
        '  evaluate   Run the adversarial evaluator over a report',
        "  summarize  Score a case's stored summaries, or summarize from the DB",
        '  generate   Generate a report (writes to the database)',
        '  full       summarize + generate + evaluate',
        '',
        'Options:',
        '  --workspace <id>   Workspace to operate on (required)',
        '  --case <dir>       Read inputs from an eval case; no database access',
        '  --report <id>      Pin a specific report instead of the latest published',
        '  --out <dir>        Destination for export (default fixtures/eval/<name>)',
        '  --name <name>      Case name for export (default <company>-<period start>)',
        "  --summary-model <m>  Export only this model's summaries (repeatable)",
        '  --period <date>    Period date for summarize/generate',
        '  --provider <p>     Override LOCAL_AI_PROVIDER',
        '  --model <m>        Override LOCAL_AI_MODEL',
      ].join('\n')
    );
    process.exit(1);
  }

  let workspaceId: string | undefined;
  let periodDate: Date = new Date();
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

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--workspace' || arg === '-w') {
      workspaceId = args[++i];
    } else if (arg?.startsWith('--workspace=')) {
      workspaceId = arg.slice('--workspace='.length);
    } else if (arg === '--period' || arg === '-p') {
      periodDate = new Date(args[++i] ?? '');
    } else if (arg?.startsWith('--period=')) {
      periodDate = new Date(arg.slice('--period='.length));
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
    }
  }

  if (!workspaceId) {
    console.error('--workspace is required');
    process.exit(1);
  }

  return {
    command,
    workspaceId: toWorkspaceId(workspaceId),
    periodDate,
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
  };
}

function log(message: string, data?: Record<string, unknown>) {
  const line = data ? `${message} ${JSON.stringify(data)}` : message;
  console.log(`[phoenix-eval] ${line}`);
}

function toJsonValue(value: unknown): JsonValue {
  try {
    return JSON.parse(JSON.stringify(value)) as JsonValue;
  } catch {
    return String(value);
  }
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

function getEvalAdapter(): EvalExperimentPort {
  const config = getPhoenixConfig();
  if (!config.enabled) {
    console.error('PHOENIX_APP_URL and PHOENIX_API_KEY must be set');
    process.exit(1);
  }
  return createPhoenixEvalAdapter({
    appUrl: config.appUrl,
    apiKey: config.apiKey,
  });
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
    log,
  });

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

async function runSummarize(args: CliArgs, evalAdapter: EvalExperimentPort) {
  const repositories = getIntelligenceRepositories();
  const workspace = await repositories.workspaceRepository.getById(
    args.workspaceId
  );
  if (workspace.isError()) throw workspace.getError();
  const outcome = workspace.get();
  if (outcome.type === 'workspace_not_found')
    throw new Error('Workspace not found');

  const period = computeWeeklyPeriod(
    args.periodDate,
    outcome.workspace.timezone
  );
  const sources = await repositories.sourceRepository.listForPeriod({
    workspaceId: args.workspaceId,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
  if (sources.isError()) throw sources.getError();

  const config = getLocalAiConfig();
  const provider = (args.provider ?? config.provider) as LocalAiProviderName;
  const model = args.model ?? config.model;
  const runId = randomUUID();

  log('Starting source summarization', {
    sources: sources.get().length,
    provider,
    model,
    period: {
      start: period.periodStart.toISOString(),
      end: period.periodEnd.toISOString(),
    },
  });

  for (const source of sources.get()) {
    // Shared with the workspace console, so CLI and UI summaries are
    // comparable rather than produced under subtly different instructions.
    const prompt = buildSourceSummaryPrompt(source);

    const result = await generateLocalText({
      provider,
      model,
      prompt,
      action: 'summarize_sources',
      label: `source-summary-${source.id}`,
      runId,
      rawOutputDir: config.rawOutputDir,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaNumCtx: config.ollamaNumCtx,
    });

    const parsed = extractJsonObject(result.text);
    const summaryText =
      (typeof parsed?.summary === 'string' ? parsed.summary : null) ??
      result.text.trim().slice(0, 4000);
    const evidenceCandidateText =
      (typeof parsed?.evidence_candidate === 'string'
        ? parsed.evidence_candidate
        : null) ?? null;

    const evalResult = await evalAdapter.recordSummaryEvaluation({
      workspaceId: args.workspaceId,
      sourceRecordId: source.id,
      sourceContent: {
        title: source.title,
        provider: source.providerName,
        contentText: source.contentText,
      },
      summary: { summaryText, evidenceCandidateText },
      modelName: result.modelName,
      modelProvider: result.modelProvider,
    });

    if (evalResult.isOk()) {
      log(`Recorded summary eval for source ${source.id}`, {
        experimentId: evalResult.get().experimentId,
      });
    } else {
      log(`Failed to record summary eval for source ${source.id}`, {
        error: evalResult.getError().message,
      });
    }
  }

  log('Summarization complete', { sources: sources.get().length });
}

async function runGenerate(args: CliArgs, evalAdapter: EvalExperimentPort) {
  const config = getLocalAiConfig();
  const provider = (args.provider ?? config.provider) as LocalAiProviderName;
  const model = args.model ?? config.model;
  const runId = randomUUID();
  const abortController = new AbortController();

  const deps: WeeklyReportGenerationDeps = {
    ...(() => {
      const kernel = getKernel();
      const repositories = getIntelligenceRepositories();
      return {
        workspaceRepository: repositories.workspaceRepository,
        sourceRepository: repositories.sourceRepository,
        reportRepository: repositories.reportRepository,
        reportGenerator: createLocalAiReportGenerator({
          provider,
          model,
          rawOutputDir: config.rawOutputDir,
          runId,
          action: 'generate_report',
          abortSignal: abortController.signal,
          ollamaBaseUrl: config.ollamaBaseUrl,
          ollamaNumCtx: config.ollamaNumCtx,
          onEvent: (event) => {
            log(
              'generation-event',
              toJsonValue(event) as Record<string, unknown>
            );
          },
        }),
        alert: {
          async sendAlert() {
            return (await import('@swan-io/boxed')).Result.Ok({
              type: 'alert_skipped' as const,
            });
          },
        },
        clock: kernel.clock,
        logger: kernel.logger,
      };
    })(),
  };

  log('Starting report generation', {
    workspace: args.workspaceId,
    provider,
    model,
  });

  const result = await generateWeeklyReport(deps, {
    workspaceId: args.workspaceId,
    now: args.periodDate,
  });

  if (result.isError()) {
    log('Report generation failed', { error: result.getError().message });
    return;
  }

  const outcome = result.get();
  log('Report generation completed', { type: outcome.type });

  if (outcome.type === 'report_published') {
    const evalResult = await evalAdapter.recordReportGeneration({
      workspaceId: args.workspaceId,
      reportId: outcome.report.id,
      prompt: 'report-generation',
      reportData: toJsonValue(outcome.report) as JsonObject,
      modelName: model,
      modelProvider: provider,
    });
    if (evalResult.isOk()) {
      log('Recorded report generation', {
        datasetId: evalResult.get().datasetId,
      });
    }
  }
}

/**
 * Resolves the reference report. A pinned `--report` id keeps the baseline
 * fixed; falling back to "latest published" means a generation run can move the
 * yardstick it is later measured against.
 */
async function resolvePinnedReport(
  args: CliArgs
): Promise<FixtureReport | null> {
  const repositories = getIntelligenceRepositories();
  if (args.reportId) {
    const found = await repositories.reportRepository.getById(
      toWeeklyReportId(args.reportId)
    );
    if (found.isError()) throw found.getError();
    const outcome = found.get();
    if (outcome.type === 'report_not_found') {
      log('Report not found', { reportId: args.reportId });
      return null;
    }
    return outcome.report as unknown as FixtureReport;
  }
  const latest = await repositories.reportRepository.getLatestPublished(
    args.workspaceId
  );
  if (latest.isError()) throw latest.getError();
  const latestOutcome = latest.get();
  if (latestOutcome.type === 'report_none') {
    log('No published report found');
    return null;
  }
  log('No --report given, using the latest published report', {
    reportId: latestOutcome.report.id,
  });
  return latestOutcome.report as unknown as FixtureReport;
}

async function runEvaluate(args: CliArgs, evalAdapter: EvalExperimentPort) {
  const config = getLocalAiConfig();
  const provider = (args.provider ?? config.provider) as LocalAiProviderName;
  const model = args.model ?? config.model;
  const runId = randomUUID();

  let report: FixtureReport;
  let sourceList: FixtureSource[];

  if (args.caseDir) {
    const evalCase = loadCase(args.caseDir);
    ({ report, sources: sourceList } = caseAsFixture(evalCase));
    log('Loaded eval case', {
      dir: evalCase.dir,
      name: evalCase.manifest.name,
      reportId: report.id,
      sources: sourceList.length,
    });
  } else {
    const repositories = getIntelligenceRepositories();
    const resolved = await resolvePinnedReport(args);
    if (!resolved) return;
    report = resolved;
    const sources = await repositories.sourceRepository.listForPeriod({
      workspaceId: args.workspaceId,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
    });
    if (sources.isError()) throw sources.getError();
    sourceList = sources.get() as unknown as FixtureSource[];
  }

  log('Starting report evaluation', {
    reportId: report.id,
    sources: sourceList.length,
    provider,
    model,
  });

  const result = await generateLocalText({
    provider,
    model,
    prompt: buildEvalPrompt({
      report: report as Parameters<typeof buildEvalPrompt>[0]['report'],
      sources: sourceList as Parameters<typeof buildEvalPrompt>[0]['sources'],
    }),
    action: 'evaluate_report',
    label: `report-eval-${report.id}`,
    runId,
    rawOutputDir: config.rawOutputDir,
    ollamaBaseUrl: config.ollamaBaseUrl,
    ollamaNumCtx: config.ollamaNumCtx,
  });

  const verdict = extractJsonObject(result.text);
  if (!verdict) {
    log('Could not parse evaluation verdict');
    return;
  }

  log('Evaluation verdict', verdict as Record<string, unknown>);

  const evalResult = await evalAdapter.recordReportEvaluation({
    workspaceId: args.workspaceId,
    reportId: toWeeklyReportId(report.id),
    reportData: (toJsonValue(report.reportData) ?? {}) as JsonObject,
    sources: sourceList.map((s) => ({
      id: toSourceRecordId(s.id),
      title: s.title,
      provider: s.providerName,
      contentText: s.contentText,
    })),
    evaluation: {
      claim_support: Number(
        (verdict.scores as JsonObject | undefined)?.claim_support ??
          verdict.claim_support ??
          0
      ),
      coverage: Number(
        (verdict.scores as JsonObject | undefined)?.coverage ??
          verdict.coverage ??
          0
      ),
      noise: Number(
        (verdict.scores as JsonObject | undefined)?.noise ?? verdict.noise ?? 0
      ),
      violations: Array.isArray(verdict.violations)
        ? (verdict.violations as JsonObject[])
        : [],
      missed_signals: Array.isArray(verdict.missed_signals)
        ? (verdict.missed_signals as JsonObject[])
        : [],
      summary: typeof verdict.summary === 'string' ? verdict.summary : '',
    },
    modelName: result.modelName,
    modelProvider: result.modelProvider,
  });

  if (evalResult.isOk()) {
    log('Recorded report evaluation', {
      experimentId: evalResult.get().experimentId,
    });
  }
}

async function runCompare(args: CliArgs) {
  const config = getLocalAiConfig();
  const provider = (args.provider ?? config.provider) as LocalAiProviderName;
  const model = args.model ?? config.model;
  const runId = randomUUID();

  let report: FixtureReport;
  let usableSources: FixtureSource[];
  let prompt: string;

  let evalCase: EvalCase | null = null;

  if (args.caseDir) {
    // The case carries every prompt input, so this path never touches the DB.
    evalCase = loadCase(args.caseDir);
    ({ report } = caseAsFixture(evalCase));
    usableSources = caseUsableSources(evalCase);
    const timezone = String(
      evalCase.workspace.workspace.timezone ?? 'America/Los_Angeles'
    );
    log('Loaded eval case', {
      dir: evalCase.dir,
      name: evalCase.manifest.name,
      reportId: report.id,
      sources: usableSources.length,
    });
    prompt = buildReportPrompt({
      workspace: evalCase.workspace.workspace as unknown as Parameters<
        typeof buildReportPrompt
      >[0]['workspace'],
      keywords: evalCase.workspace.keywords as unknown as Parameters<
        typeof buildReportPrompt
      >[0]['keywords'],
      competitors: evalCase.workspace.competitors as unknown as Parameters<
        typeof buildReportPrompt
      >[0]['competitors'],
      socialAccounts: evalCase.workspace
        .socialAccounts as unknown as Parameters<
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
  } else {
    const repositories = getIntelligenceRepositories();
    const resolved = await resolvePinnedReport(args);
    if (!resolved) return;
    report = resolved;
    const workspace = await repositories.workspaceRepository.getById(
      args.workspaceId
    );
    if (workspace.isError()) throw workspace.getError();
    const wsOutcome = workspace.get();
    if (wsOutcome.type === 'workspace_not_found')
      throw new Error('Workspace not found');
    const [sources, keywords, competitors, social, priorReports] =
      await Promise.all([
        repositories.sourceRepository.listForPeriod({
          workspaceId: args.workspaceId,
          periodStart: report.periodStart,
          periodEnd: report.periodEnd,
        }),
        repositories.workspaceRepository.listKeywords(args.workspaceId, {
          activeOnly: true,
        }),
        repositories.workspaceRepository.listCompetitors(args.workspaceId),
        repositories.workspaceRepository.listSocialAccounts(args.workspaceId),
        repositories.reportRepository.listByWorkspace(args.workspaceId, {
          limit: 4,
        }),
      ]);
    if (sources.isError()) throw sources.getError();
    if (keywords.isError()) throw keywords.getError();
    if (competitors.isError()) throw competitors.getError();
    if (social.isError()) throw social.getError();
    if (priorReports.isError()) throw priorReports.getError();
    usableSources = sources
      .get()
      .filter((s) => s.relevanceLabel !== 'junk') as unknown as FixtureSource[];
    prompt = buildReportPrompt({
      workspace: wsOutcome.workspace,
      keywords: keywords.get(),
      competitors: competitors.get(),
      socialAccounts: social.get(),
      sources: usableSources as Parameters<
        typeof buildReportPrompt
      >[0]['sources'],
      priorReports: priorReports.get(),
      periodStartLabel: formatPeriodDate(
        report.periodStart,
        wsOutcome.workspace.timezone
      ),
      periodEndLabel: formatPeriodDate(
        report.periodEnd,
        wsOutcome.workspace.timezone
      ),
    });
  }

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

  const example = {
    id: evalCase ? exampleId(evalCase) : `workspace-${args.workspaceId}`,
    input: {
      workspaceId: args.workspaceId,
      reportId: report.id,
      periodStart: report.periodStart.toISOString(),
      periodEnd: report.periodEnd.toISOString(),
      sourceCount: usableSources.length,
      sources: usableSources.map((s) => ({
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

  // `generate` publishes a weekly report, which would move the baseline that
  // `evaluate` and `compare` measure against. Refuse to mix it with a case.
  if (
    args.caseDir &&
    (args.command === 'generate' || args.command === 'full')
  ) {
    console.error(
      `[phoenix-eval] --case cannot be combined with "${args.command}": that command writes a published report to the database, which would move the reference a case exists to pin. Use "compare" to score a generation against the case.`
    );
    process.exit(1);
  }

  const evalAdapter = getEvalAdapter();

  try {
    if (args.command === 'summarize' || args.command === 'full') {
      if (args.caseDir) {
        await runSummarizeCase(args);
      } else {
        await runSummarize(args, evalAdapter);
      }
    }
    if (args.command === 'generate' || args.command === 'full') {
      await runGenerate(args, evalAdapter);
    }
    if (args.command === 'evaluate' || args.command === 'full') {
      await runEvaluate(args, evalAdapter);
    }
    if (args.command === 'compare') {
      await runCompare(args);
    }
    log('Done');
  } catch (error) {
    console.error(
      '[phoenix-eval] Fatal error:',
      error instanceof Error ? error.message : error
    );
    process.exit(1);
  }
}

void main();
