/* oxlint-disable no-process-env */
/**
 * Standalone Phoenix eval pipeline.
 *
 * Evals read git-stored eval cases (see scripts/eval/case.ts) rather than live
 * data, so an experiment run today is comparable with one run months ago. A
 * case pins its own Phoenix dataset id, which is what keeps that history on a
 * single dataset in the Phoenix UI.
 *
 * This file is the entry point only: parse arguments, pick a command, report
 * failure. The commands live in scripts/eval/commands so they can be read and
 * tested without going through argv.
 *
 * Usage:
 *   pnpm eval:phoenix export      --workspace <id> [--report <id>] [--out <dir>]
 *   pnpm eval:phoenix summarize   --workspace <id> --case <dir> [--sample]
 *   pnpm eval:phoenix compare     --workspace <id> --case <dir> [--judge]
 *   pnpm eval:phoenix evaluate    --workspace <id> --case <dir>
 *   pnpm eval:phoenix judge-check --workspace <id> --case <dir>
 */
import { type CliArgs, parseArgs } from './eval/cli-args';
import { runCompare } from './eval/commands/compare';
import { runEvaluate } from './eval/commands/evaluate';
import { runJudgeCheck } from './eval/commands/judge-check';
import { runSummarizeCase } from './eval/commands/summarize';
import { exportCase } from './eval/export-case';
import { log } from './eval/log';
import { flushCliTelemetry, startCliTelemetry } from './eval/telemetry';

async function main() {
  let args: CliArgs;
  try {
    args = parseArgs(process.argv);
  } catch (error) {
    console.error(
      `[phoenix-eval] ${error instanceof Error ? error.message : error}`
    );
    process.exit(1);
  }

  // Export is the one command that reads live data on purpose, and it needs no
  // Phoenix credentials.
  if (args.command === 'export') {
    await exportCase({
      workspaceId: args.workspaceId,
      reportId: args.reportId,
      name: args.caseName,
      summaryModels: args.summaryModels,
      sampleSize: args.sampleSize,
      sampleSourceIds: args.sampleSourceIds,
      outDir: args.outDir ?? `fixtures/eval/${args.caseName ?? 'case'}`,
      log,
    });
    log('Done');
    return;
  }

  // Experiments read pinned cases, never live data: a run against whatever the
  // database happens to hold today is not comparable with anything.
  if (!args.caseDir) {
    console.error(
      `[phoenix-eval] "${args.command}" requires --case <dir>. Mint one with: pnpm eval:phoenix export --workspace ${args.workspaceId} --report <id> --out fixtures/eval/<name>`
    );
    process.exit(1);
  }

  // The commands call the same AI SDK the app does; without this their model
  // calls are never traced.
  startCliTelemetry();

  try {
    if (args.command === 'summarize') await runSummarizeCase(args);
    if (args.command === 'evaluate') await runEvaluate(args);
    if (args.command === 'compare') await runCompare(args);
    if (args.command === 'judge-check') await runJudgeCheck(args);
    log('Done');
    // Batched spans would be lost to the explicit exit below.
    await flushCliTelemetry();
    // Telemetry exporters and DB pools can keep the loop alive; every path
    // above has awaited its work, so leaving is safe and avoids a hang.
    process.exit(0);
  } catch (error) {
    console.error(
      '[phoenix-eval] Fatal error:',
      error instanceof Error ? error.message : error
    );
    // The spans of a run that died are the ones worth having.
    await flushCliTelemetry();
    process.exit(1);
  }
}

void main();
