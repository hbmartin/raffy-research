import type { NewsletterJob, RepairUnitState } from './newsletter';

export function normalizeCheckpoint(
  job: NewsletterJob
): NewsletterJob['checkpoint'] {
  const checkpoint = job.checkpoint;
  if (checkpoint.version === 2) return checkpoint;
  const repairs = checkpoint.repairs ?? 0;
  const exhausted = job.stage === 'repair-exhausted' || repairs > 2;
  const ambiguous =
    !exhausted &&
    !checkpoint.article &&
    (repairs > 0 ||
      Object.values(checkpoint.unitRepairs ?? {}).some((n) => n > 0));
  const units: Record<string, RepairUnitState> = {};
  if (repairs || exhausted)
    units.draft = {
      repairsUsed: Math.min(2, repairs),
      needsRepair: false,
      exhausted,
    };
  return {
    ...checkpoint,
    version: 2,
    repairUnits: units,
    legacyRepairBlocked: ambiguous || undefined,
    repairFeedback: undefined,
  };
}
export function unitFeedback(job: NewsletterJob, unit: string): string {
  const state = job.checkpoint.repairUnits?.[unit];
  return state?.needsRepair
    ? `Repair failures: ${state.issues?.join('; ') ?? ''}. Rejected output: ${JSON.stringify(state.rejected)}`
    : '';
}
export function completedUnit(
  checkpoint: NewsletterJob['checkpoint'],
  unit: string
): NewsletterJob['checkpoint'] {
  const state = checkpoint.repairUnits?.[unit];
  return {
    ...checkpoint,
    repairUnits: {
      ...checkpoint.repairUnits,
      [unit]: { repairsUsed: state?.repairsUsed ?? 0, needsRepair: false },
    },
    repairFeedback: undefined,
  };
}
