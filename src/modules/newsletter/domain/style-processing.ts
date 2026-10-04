import type {
  NewsletterJob,
  NewsletterProfile,
  StylePartition,
  StylePlan,
} from './newsletter';
import {
  jobGenerationBudget,
  processingSignature,
  promptSize,
} from './processing';

export const styleInputSignature = (profile: NewsletterProfile) =>
  processingSignature({ guidance: profile.guidance, samples: profile.samples });

export function createStylePlan(
  job: NewsletterJob,
  layout: StylePlan['layout']
): StylePlan | undefined {
  const profile = job.checkpoint.profile;
  if (!profile) return undefined;
  const capacity = Math.min(
    64_000,
    jobGenerationBudget(job)?.inputBytes ?? 1024
  );
  const chunkSize = Math.max(
    256,
    Math.floor(capacity / (layout === 'legacy-20' ? 20 : 3))
  );
  const parts: StylePartition[] = [];
  for (const [sampleIndex, text] of [
    profile.guidance,
    ...profile.samples,
  ].entries()) {
    let start = 0;
    while (start < text.length) {
      let end = Math.min(text.length, start + chunkSize);
      if (layout === 'utf8') {
        end = fittingStyleEnd(
          text,
          start,
          end,
          (value) =>
            promptSize(JSON.stringify(text.slice(start, value))) <= capacity / 3
        );
        // Never split a surrogate pair.
        if (end < text.length && /[\uDC00-\uDFFF]/.test(text[end]!)) end--;
        if (end <= start) end = Math.min(text.length, start + 2);
      }
      parts.push({ sampleIndex, start, end, unit: `style:${parts.length}` });
      start = end;
    }
  }
  const cursor = job.checkpoint.styleCursor ?? 0;
  const plan: StylePlan = {
    inputSignature: styleInputSignature(profile),
    layout,
    parts,
    cursor,
  };
  if (
    Number.isInteger(cursor) &&
    cursor >= 0 &&
    cursor <= parts.length &&
    !job.checkpoint.styleAggregate &&
    job.checkpoint.styleNotes?.length
  ) {
    plan.legacyPatterns = job.checkpoint.styleNotes.join('\n');
    plan.parts.splice(cursor, 0, {
      sampleIndex: -1,
      start: 0,
      end: plan.legacyPatterns.length,
      unit: 'style:legacy-notes',
    });
  }
  return plan;
}

/** Return a code-point boundary that fits the complete serialized prompt. */
export function fittingStyleEnd(
  text: string,
  start: number,
  end: number,
  fits: (end: number) => boolean
): number {
  const boundaries = [start];
  let offset = start;
  for (const character of text.slice(start, end)) {
    offset += character.length;
    if (offset === text.length || !/[\uDC00-\uDFFF]/.test(text[offset]!))
      boundaries.push(offset);
  }
  let low = 0,
    high = boundaries.length - 1;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (fits(boundaries[mid]!)) low = mid;
    else high = mid - 1;
  }
  return boundaries[low]!;
}
