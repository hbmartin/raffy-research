import { randomUUID } from 'node:crypto';

import type { LocalAiProviderName } from '@/modules/intelligence';
import {
  generateLocalText,
  getLocalAiConfig,
} from '@/modules/intelligence/backend';

import {
  loadCaseForWorkspace,
  usableSources as caseUsableSources,
} from '../case';
import type { CliArgs } from '../cli-args';
import { createJudgeEvaluators } from '../judge-evaluators';
import {
  estimateJudgeCalls,
  runJudgeProbes,
  selectProbes,
} from '../judge-probes';
import { log } from '../log';

export async function runJudgeCheck(args: CliArgs) {
  if (!args.caseDir) throw new Error('--case is required');
  const evalCase = loadCaseForWorkspace(args.caseDir, args.workspaceId);
  const config = getLocalAiConfig();
  const provider = (args.judgeProvider ??
    config.provider) as LocalAiProviderName;
  const model = args.judgeModel ?? config.model;
  const runId = randomUUID();

  const reference = evalCase.report.reportData;
  if (!reference) {
    log('The case pins no report data to probe', {
      case: evalCase.manifest.name,
    });
    return;
  }

  // Resolved before any model call, so a mistyped --probe fails in a second
  // rather than after an hour of judging.
  const probes = selectProbes(args.probes);
  log('Probing the judges with altered reports', {
    case: evalCase.manifest.name,
    provider,
    model,
    probes: probes.map((probe) => probe.name),
    maxJudgeCalls: estimateJudgeCalls(probes),
  });

  const judges = createJudgeEvaluators(async ({ prompt, label }) => {
    const result = await generateLocalText({
      provider,
      model,
      prompt,
      action: 'judge_check',
      label,
      runId,
      rawOutputDir: config.rawOutputDir,
      ollamaBaseUrl: config.ollamaBaseUrl,
      ollamaNumCtx: config.ollamaNumCtx,
      temperature: 0,
    });
    return result.text;
  });

  const results = await runJudgeProbes({
    judges,
    reference,
    sources: caseUsableSources(evalCase),
    log,
    only: args.probes,
  });

  console.table(
    results.map((r) => ({
      probe: r.probe,
      kind: r.kind,
      judge: r.judge,
      status: r.status.toUpperCase(),
      detail: r.reason,
    }))
  );

  const failed = results.filter((r) => r.status === 'fail');
  const ran = results.filter((r) => r.status === 'pass').length;
  const skipped = results.filter((r) => r.status === 'skip').length;
  if (failed.length === 0 && ran === 0) {
    // Nothing was tested, so nothing was shown about the judges. Exiting
    // non-zero keeps anything gated on this check from trusting them.
    console.error(
      `[phoenix-eval] No probe ran (${skipped} skipped): the reference ` +
        'report gives the selected probes nothing to change, so the judges ' +
        'were not tested.'
    );
    process.exit(1);
  }
  if (failed.length === 0) {
    log(
      skipped === 0
        ? 'All probes passed: the judges respond to report quality'
        : 'No probes failed; some probes were skipped',
      { ran, skipped }
    );
    return;
  }

  const blind = failed.filter((r) => r.kind !== 'invariant');
  const biased = failed.filter((r) => r.kind === 'invariant');
  if (blind.length > 0) {
    console.error(
      `[phoenix-eval] ${blind.length} degradation probe(s) failed: ${model} ` +
        'did not mark down a deliberately broken report ' +
        `(${blind.map((r) => `${r.probe}/${r.judge}`).join(', ')}).`
    );
  }
  if (biased.length > 0) {
    console.error(
      `[phoenix-eval] ${biased.length} invariance probe(s) failed: ${model} ` +
        'changed its score on a change that should not matter -- position or ' +
        `format bias (${biased.map((r) => `${r.probe}/${r.judge}`).join(', ')}).`
    );
  }
  console.error(
    '[phoenix-eval] Treat judge scores from the failing judges as unusable ' +
      'until their probes pass.'
  );
  process.exit(1);
}
