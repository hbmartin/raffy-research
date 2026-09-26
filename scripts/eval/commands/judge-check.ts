import { randomUUID } from 'node:crypto';

import type { LocalAiProviderName } from '@/modules/intelligence';
import {
  generateLocalText,
  getLocalAiConfig,
} from '@/modules/intelligence/backend';

import { loadCase, usableSources as caseUsableSources } from '../case';
import type { CliArgs } from '../cli-args';
import { createJudgeEvaluators } from '../judge-evaluators';
import { JUDGE_PROBES, runJudgeProbes } from '../judge-probes';
import { log } from '../log';

export async function runJudgeCheck(args: CliArgs) {
  if (!args.caseDir) throw new Error('--case is required');
  const evalCase = loadCase(args.caseDir);
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

  log('Probing the judges with degraded reports', {
    case: evalCase.manifest.name,
    provider,
    model,
    probes: JUDGE_PROBES.length,
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
  });

  const blind = results.filter((r) => !r.discriminated);
  if (blind.length === 0) {
    log('All probes passed: the judges respond to report quality', {
      probes: results.length,
    });
    return;
  }

  console.error(
    `[phoenix-eval] ${blind.length} of ${results.length} probes failed. ` +
      `${model} returns the same score for a good report and a deliberately ` +
      'broken one, so its verdicts carry no information. Treat --judge ' +
      'results from this model as unusable until a probe passes.'
  );
  process.exit(1);
}
