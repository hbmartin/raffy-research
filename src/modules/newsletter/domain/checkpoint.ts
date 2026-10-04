import type {
  EditorialAngle,
  NewsletterJob,
  RepairUnitState,
} from './newsletter';
import { createStylePlan } from './style-processing';

export function normalizeCheckpoint(
  job: NewsletterJob,
  angles: EditorialAngle[] = []
): NewsletterJob['checkpoint'] {
  const checkpoint = job.checkpoint;
  if (checkpoint.version === 3) return checkpoint;
  const repairs = checkpoint.repairs ?? 0;
  const exhausted = job.stage === 'repair-exhausted' || repairs > 2;
  const legacy =
    checkpoint.version === undefined || checkpoint.legacyRepairBlocked;
  const legacyRepairs = legacy || !checkpoint.repairUnits;
  const units: Record<string, RepairUnitState> = { ...checkpoint.repairUnits };
  const completed = (unit: string) => {
    const style = /^style:(\d+)$/.exec(unit);
    if (style)
      return (
        Number(style[1]) < (checkpoint.styleCursor ?? 0) &&
        Boolean(
          checkpoint.styleNotes?.[Number(style[1])] || checkpoint.styleAggregate
        )
      );
    const evidence = /^evidence:(?:[^:]+:)?(\d+)$/.exec(unit);
    if (evidence)
      return (
        Number(evidence[1]) < (checkpoint.evidenceCursor ?? 0) &&
        Boolean(checkpoint.evidenceNotes)
      );
    const tracking = /^tracking:.*:(\d+)$/.exec(unit);
    if (tracking) return Number(tracking[1]) < (checkpoint.batchCursor ?? 0);
    if (unit.startsWith('theme:'))
      return angles.some(
        (angle) => angle.id === unit.slice(6) && Boolean(angle.supportAudit)
      );
    if (unit === 'research-plan') return Boolean(checkpoint.researchQueries);
    if (unit === 'research-assessment')
      return Boolean(checkpoint.researchAssessed);
    if (unit === 'research-audit')
      return Boolean(checkpoint.angle?.supportAudit);
    return unit === 'draft' && Boolean(checkpoint.article);
  };
  let ambiguous = false;
  if (legacyRepairs) {
    for (const [unit, count] of Object.entries(checkpoint.unitRepairs ?? {})) {
      if (!count) continue;
      const done = completed(unit);
      units[unit] = {
        ...units[unit],
        repairsUsed: Math.min(2, count),
        needsRepair: false,
        exhausted: !done && count >= 2,
      };
      if (!done && count < 2) ambiguous = true;
    }
    if (!exhausted && repairs && !checkpoint.article) ambiguous = true;
  }
  if ((legacyRepairs && repairs) || exhausted)
    units.draft = {
      repairsUsed: Math.min(2, repairs),
      needsRepair: false,
      exhausted,
    };
  const styleProgress =
    checkpoint.styleCursor !== undefined ||
    Boolean(checkpoint.styleNotes?.length) ||
    job.stage.startsWith('style');
  const stylePlan =
    checkpoint.stylePlan ??
    (styleProgress
      ? createStylePlan(job, legacy ? 'legacy-20' : 'version-2-3')
      : undefined);
  const invalidCursor =
    stylePlan &&
    (!Number.isInteger(stylePlan.cursor) ||
      stylePlan.cursor < 0 ||
      stylePlan.cursor > stylePlan.parts.length ||
      (stylePlan.legacyPatterns &&
        stylePlan.cursor === stylePlan.parts.length));
  const missingStyle =
    styleProgress &&
    (!checkpoint.profile ||
      ((checkpoint.styleCursor ?? 0) > (checkpoint.styleNotes?.length ?? 0) &&
        !checkpoint.styleAggregate));
  return {
    ...checkpoint,
    version: 3,
    stylePlan,
    normalizationIssue: missingStyle
      ? 'Stored style progress has no recoverable pinned inputs or completed notes; use Retry'
      : invalidCursor
        ? 'Stored style progress does not match its original partition plan; use Retry'
        : checkpoint.normalizationIssue,
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
