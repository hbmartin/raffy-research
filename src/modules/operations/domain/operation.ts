import { z } from 'zod';

export const OPERATION_KINDS = [
  'ingest',
  'discover',
  'generate',
  'summarize',
  'evaluate',
  'full_workflow',
  'newsletter',
] as const;
export const zOperationKind = z.enum(OPERATION_KINDS);
export type OperationKind = z.infer<typeof zOperationKind>;
export type BusinessOutcome = { type: string; [key: string]: unknown };
export type OperationStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled'
  | 'reconciliation_required';
export type Operation = {
  id: string;
  workspaceId: string;
  userId: string;
  credentialId: string;
  kind: OperationKind;
  key: string;
  fingerprint: string;
  input: Record<string, unknown>;
  checkpoint: Record<string, unknown>;
  status: OperationStatus;
  stage: string;
  leaseToken: string | null;
  leaseUntil: Date | null;
  cancelRequested: boolean;
  result: BusinessOutcome | null;
  failure: string | null;
  parentId: string | null;
  externalJobId: string | null;
  createdAt: Date;
};
export const zPage = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.string().max(500).optional(),
});
export type PageInput = z.infer<typeof zPage>;
export const operationSummary = (operation: Operation) => {
  const {
    input: _input,
    checkpoint: _checkpoint,
    result: _result,
    leaseToken: _token,
    ...summary
  } = operation;
  return summary;
};

export function completedArtifacts(checkpoint: Record<string, unknown>) {
  const parsed = z
    .record(
      z.string(),
      z.object({
        status: z.string(),
        result: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .safeParse(checkpoint.steps ?? {});
  if (!parsed.success) return [];
  return Object.entries(parsed.data).flatMap(([stage, step]) => {
    if (step.status !== 'completed' || !step.result) return [];
    const result = step.result;
    const report = z.object({ id: z.string() }).safeParse(result.report);
    const judgment = z.object({ id: z.string() }).safeParse(result.judgment);
    const reportId =
      typeof result.reportId === 'string'
        ? result.reportId
        : report.success
          ? report.data.id
          : undefined;
    const sourceId =
      typeof result.sourceRecordId === 'string'
        ? result.sourceRecordId
        : undefined;
    const summaryId =
      typeof result.summaryId === 'string' ? result.summaryId : undefined;
    const judgmentId = judgment.success ? judgment.data.id : undefined;
    return reportId || sourceId || summaryId || judgmentId
      ? [
          {
            stage,
            type: result.type,
            reportId,
            sourceId,
            summaryId,
            judgmentId,
          },
        ]
      : [];
  });
}
