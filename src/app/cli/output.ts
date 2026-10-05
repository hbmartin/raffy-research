import { Result } from '@swan-io/boxed';
import { match, P } from 'ts-pattern';

import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { BusinessOutcome } from '@/modules/operations';

const recovery: Record<string, string> = {
  angle_unavailable:
    'Run newsletter offers for the current preparation and choose an available angle.',
  selection_conflict:
    'Inspect newsletter offers/settings and the current selection; use --replace only for an authorized replacement.',
  latest_report_required:
    'Run research latest and newsletter offers; use the current report ID.',
  style_required:
    'Run newsletter settings, then configure audience/style guidance or samples with a new idempotency key.',
  override_required:
    'Inspect the angle evidence; provide --override-reason only for an explicitly authorized editorial override.',
  context_unknown:
    'Inspect newsletter settings and configure a supported model/context allocation.',
  context_capacity_exceeded:
    'Inspect model context allocation and the configured operator ceiling before preparing again.',
  equivalence_conflict:
    'Run newsletter reviews and inspect the conflicting selection; confirm, separate, or reverse only as an authorized editorial decision.',
  published_report_required:
    'Run research reports and choose a published immutable report version.',
  workspace_not_found:
    'Run research workspaces and pass --workspace with an existing workspace ID.',
  source_record_not_found:
    'Run research sources in the selected workspace and retrieve an existing capture ID.',
  report_not_found:
    'Run research reports in the selected workspace and retrieve an existing report ID.',
  forbidden:
    'Check auth whoami, the workspace, current role, and the granted capability groups.',
};

export function serializeResult(result: ApplicationResult<BusinessOutcome>) {
  return match(result)
    .with(Result.P.Ok(P.select()), (outcome) => ({
      schemaVersion: 1,
      kind: 'ok' as const,
      outcome: {
        ...outcome,
        ...(outcome.recovery
          ? {}
          : recovery[outcome.type]
            ? { recovery: recovery[outcome.type] }
            : {}),
      },
    }))
    .with(Result.P.Error(P.select()), (error) => ({
      schemaVersion: 1,
      kind: 'error' as const,
      error: {
        code: error.code,
        category: error.category,
        message:
          error.category === 'system'
            ? 'Raffy operation failed. Inspect diagnostics.'
            : error.message,
      },
    }))
    .exhaustive();
}
