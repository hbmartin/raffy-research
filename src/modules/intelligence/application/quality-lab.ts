import { Result } from '@swan-io/boxed';
import { z } from 'zod';

import type { ApplicationResult } from '@/modules/kernel/application/result';

import {
  buildEvalPrompt,
  EVAL_PROMPT_VERSION,
} from './generation/build-eval-prompt';
import {
  buildSourceSummaryPrompt,
  SOURCE_SUMMARY_PROMPT_VERSION,
} from './generation/build-source-summary-prompt';
import type { SourceRepository } from './ports/source-repository';
import { zEvaluation } from '../domain/judgment';
import type { WeeklyReport } from '../domain/report';
import { parseJsonText } from '../domain/report-data';
import type { SourceRecord } from '../domain/source';

export type LabTextOutcome = {
  type: 'text_generated';
  text: string;
  modelName: string;
  modelProvider: string;
  metadata?: Record<string, unknown>;
};
export type LabTextPort = (input: { prompt: string; label: string }) => Promise<
  ApplicationResult<
    | LabTextOutcome
    | {
        type:
          | 'reconciliation_required'
          | 'operation_interrupted'
          | 'lease_lost';
        stage?: string;
      }
  >
>;

export async function summarizeLabSource(
  deps: {
    generate: LabTextPort;
    sources: SourceRepository;
    persist?: SourceRepository['createSourceSummary'];
  },
  source: SourceRecord
): Promise<
  ApplicationResult<
    | {
        type: 'source_summarized';
        summaryId: string;
        summary: import('../domain/source').SourceSummary;
        sourceRecordId: string;
        modelName: string;
        modelProvider: string;
      }
    | {
        type:
          | 'reconciliation_required'
          | 'operation_interrupted'
          | 'lease_lost';
        stage?: string;
      }
  >
> {
  const generated = await deps.generate({
    prompt: buildSourceSummaryPrompt(source),
    label: `summary:${source.id}`,
  });
  if (generated.isError()) return Result.Error(generated.getError());
  const output = generated.get();
  if (output.type !== 'text_generated') return Result.Ok(output);
  const json = parseJsonText(output.text);
  const candidate = z
    .object({ summary: z.string(), evidence_candidate: z.string().optional() })
    .safeParse(json.type === 'json_valid' ? json.value : undefined);
  const saved = await (
    deps.persist ?? deps.sources.createSourceSummary.bind(deps.sources)
  )({
    workspaceId: source.workspaceId,
    sourceRecordId: source.id,
    summaryText: candidate.success
      ? candidate.data.summary
      : output.text.slice(0, 4000),
    evidenceCandidateText: candidate.success
      ? (candidate.data.evidence_candidate ?? null)
      : null,
    modelName: output.modelName,
    modelProvider: output.modelProvider,
    promptVersion: SOURCE_SUMMARY_PROMPT_VERSION,
    inputMetadata: {
      sourceTitle: source.title,
      sourceProvider: source.providerName,
    },
    outputPayload: { rawText: output.text },
  });
  if (saved.isError()) return Result.Error(saved.getError());
  return Result.Ok({
    type: 'source_summarized' as const,
    summaryId: saved.get().id,
    summary: saved.get(),
    sourceRecordId: source.id,
    modelName: output.modelName,
    modelProvider: output.modelProvider,
  });
}

export async function evaluateLabReport(
  generate: LabTextPort,
  report: WeeklyReport,
  sources: SourceRecord[]
): Promise<
  ApplicationResult<
    | {
        type: 'report_evaluated';
        reportId: string;
        evaluation: z.infer<typeof zEvaluation>;
        modelName: string;
        modelProvider: string;
        promptVersion: string;
      }
    | {
        type: 'evaluation_invalid';
        reportId: string;
        diagnostics: { path: string; message: string }[];
        rawOutput: string;
      }
    | {
        type:
          | 'reconciliation_required'
          | 'operation_interrupted'
          | 'lease_lost';
        stage?: string;
      }
  >
> {
  const generated = await generate({
    prompt: buildEvalPrompt({ report, sources }),
    label: `evaluation:${report.id}`,
  });
  if (generated.isError()) return Result.Error(generated.getError());
  const output = generated.get();
  if (output.type !== 'text_generated') return Result.Ok(output);
  const json = parseJsonText(output.text);
  const parsed = zEvaluation.safeParse(
    json.type === 'json_valid' ? json.value : undefined
  );
  if (!parsed.success)
    return Result.Ok({
      type: 'evaluation_invalid' as const,
      reportId: report.id,
      diagnostics: parsed.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
      })),
      rawOutput: output.text,
    });
  const ids = new Set(sources.map((source) => source.id as string));
  if (
    parsed.data.violations.some((v) =>
      v.source_ids.some((id) => !ids.has(id))
    ) ||
    parsed.data.missed_signals.some((v) => !ids.has(v.source_id))
  )
    return Result.Ok({
      type: 'evaluation_invalid' as const,
      reportId: report.id,
      diagnostics: [
        {
          path: 'source_ids',
          message: 'Judge referenced unavailable evidence',
        },
      ],
      rawOutput: output.text,
    });
  return Result.Ok({
    type: 'report_evaluated' as const,
    reportId: report.id,
    evaluation: parsed.data,
    modelName: output.modelName,
    modelProvider: output.modelProvider,
    promptVersion: EVAL_PROMPT_VERSION,
  });
}
