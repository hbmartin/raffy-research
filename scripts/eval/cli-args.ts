/**
 * Command-line surface for the eval pipeline.
 *
 * Kept apart from the commands so it can be tested: a parser that silently
 * mis-reads a flag is indistinguishable from a command that ignores it, and
 * both have happened here.
 */
import { toWorkspaceId, type WorkspaceId } from '@/modules/kernel';

import { SAMPLE_SPLIT } from './case';
import { parsePositiveInt, parseProvider } from './cli-values';

export type Command =
  | 'summarize'
  | 'evaluate'
  | 'compare'
  | 'export'
  | 'judge-check';

export type CliArgs = {
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

/**
 * The token after a value-taking flag, refusing another flag.
 *
 * `--case --judge` used to consume `--judge` as the directory: the run then
 * failed on a path that looked like a typo, and the dropped flag was never
 * mentioned.
 */
function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index];
  if (!value || value.startsWith('-')) {
    throw new Error(`${flag} expects a value`);
  }
  return value;
}

export function parseArgs(argv: string[]): CliArgs {
  const allArgs = argv.slice(2);
  const args = allArgs.filter((a) => !a.endsWith('.ts'));
  const command = args[0] as Command;
  if (
    !['summarize', 'evaluate', 'compare', 'export', 'judge-check'].includes(
      command
    )
  ) {
    console.error(
      [
        'Usage: run-phoenix-eval.ts <command> --workspace <id> [options]',
        '',
        'Commands:',
        '  export     Write a git-storable eval case from the database',
        '  compare    Regenerate a report and score it against the case reference',
        "  summarize  Summarize a case's sources and score the result",
        '  judge-check  Check the judges notice a deliberately degraded report',
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
      workspaceId = requireValue(args, ++i, '--workspace');
    } else if (arg?.startsWith('--workspace=')) {
      workspaceId = arg.slice('--workspace='.length);
    } else if (arg === '--provider') {
      provider = parseProvider(args[++i], '--provider');
    } else if (arg?.startsWith('--provider=')) {
      provider = parseProvider(arg.slice('--provider='.length), '--provider');
    } else if (arg === '--model') {
      model = requireValue(args, ++i, '--model');
    } else if (arg?.startsWith('--model=')) {
      model = arg.slice('--model='.length);
    } else if (arg === '--case' || arg === '--fixture') {
      caseDir = requireValue(args, ++i, '--case');
    } else if (arg?.startsWith('--case=')) {
      caseDir = arg.slice('--case='.length);
    } else if (arg?.startsWith('--fixture=')) {
      caseDir = arg.slice('--fixture='.length);
    } else if (arg === '--report') {
      reportId = requireValue(args, ++i, '--report');
    } else if (arg?.startsWith('--report=')) {
      reportId = arg.slice('--report='.length);
    } else if (arg === '--out') {
      outDir = requireValue(args, ++i, '--out');
    } else if (arg?.startsWith('--out=')) {
      outDir = arg.slice('--out='.length);
    } else if (arg === '--reconcile') {
      reconcile = true;
    } else if (arg === '--judge') {
      judge = true;
    } else if (arg === '--judge-provider') {
      judgeProvider = parseProvider(args[++i], '--judge-provider');
      judge = true;
    } else if (arg?.startsWith('--judge-provider=')) {
      judgeProvider = parseProvider(
        arg.slice('--judge-provider='.length),
        '--judge-provider'
      );
      judge = true;
    } else if (arg === '--judge-model') {
      judgeModel = requireValue(args, ++i, '--judge-model');
      judge = true;
    } else if (arg?.startsWith('--judge-model=')) {
      judgeModel = arg.slice('--judge-model='.length);
      judge = true;
    } else if (arg === '--sample') {
      split = SAMPLE_SPLIT;
    } else if (arg === '--split') {
      split = requireValue(args, ++i, '--split');
    } else if (arg?.startsWith('--split=')) {
      split = arg.slice('--split='.length);
    } else if (arg === '--sample-size') {
      sampleSize = parsePositiveInt(args[++i], '--sample-size');
    } else if (arg?.startsWith('--sample-size=')) {
      sampleSize = parsePositiveInt(
        arg.slice('--sample-size='.length),
        '--sample-size'
      );
    } else if (arg === '--sample-source') {
      const value = requireValue(args, ++i, '--sample-source');
      if (value) sampleSourceIds = [...(sampleSourceIds ?? []), value];
    } else if (arg?.startsWith('--sample-source=')) {
      sampleSourceIds = [
        ...(sampleSourceIds ?? []),
        arg.slice('--sample-source='.length),
      ];
    } else if (arg === '--stored') {
      stored = true;
    } else if (arg === '--limit') {
      limit = parsePositiveInt(args[++i], '--limit');
    } else if (arg?.startsWith('--limit=')) {
      limit = parsePositiveInt(arg.slice('--limit='.length), '--limit');
    } else if (arg === '--concurrency') {
      concurrency = parsePositiveInt(args[++i], '--concurrency');
    } else if (arg?.startsWith('--concurrency=')) {
      concurrency = parsePositiveInt(
        arg.slice('--concurrency='.length),
        '--concurrency'
      );
    } else if (arg === '--summary-model') {
      const value = requireValue(args, ++i, '--summary-model');
      if (value) summaryModels = [...(summaryModels ?? []), value];
    } else if (arg?.startsWith('--summary-model=')) {
      summaryModels = [
        ...(summaryModels ?? []),
        arg.slice('--summary-model='.length),
      ];
    } else if (arg === '--name') {
      caseName = requireValue(args, ++i, '--name');
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
