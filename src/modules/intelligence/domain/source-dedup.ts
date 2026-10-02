import type { SourceRelevanceLabel } from './source';
import { canonicalizeSourceUrl } from './url';

/**
 * The minimum a record needs to be collapsed. Structural rather than tied to
 * `SourceRecord` so the eval harness's own `CaseSource` shape — the same data
 * after a JSON round trip, which turns the timestamps into strings — can be
 * collapsed by exactly the same function the generator uses. Measuring a
 * different selection than production builds is worse than not measuring.
 */
export type CollapsibleSource = {
  externalUrl: string | null;
  capturedAt: Date | string;
  diffAddedText: string | null;
  diffRemovedText: string | null;
  relevanceLabel: string | null;
  labeledAt?: Date | string | null;
};

export type CollapseSourcesResult<T> = {
  /** One record per page, in order of each page's first capture. */
  selected: T[];
  /** How many records were dropped as re-captures, for logging. */
  collapsedCount: number;
  /** How many survivors inherited a label from a dropped duplicate. */
  inheritedLabelCount: number;
};

const capturedAtMs = (value: Date | string): number => {
  const ms = value instanceof Date ? value.getTime() : Date.parse(value);
  // An unparseable timestamp sorts oldest rather than throwing: losing the
  // newest-wins tiebreak is recoverable, failing a whole report is not.
  return Number.isNaN(ms) ? 0 : ms;
};

/**
 * `junk` outranks `keep` outranks unreviewed.
 *
 * An analyst labels what they are looking at — a page — but the label is stored
 * against one `sourceRecord` id, and a page captured seventeen times has
 * sixteen other rows still unreviewed. Ranking `junk` highest means a single
 * junk verdict suppresses the whole page rather than one arbitrary row of it.
 */
const labelRank = (label: string | null | undefined): number => {
  if (label === 'junk') return 2;
  if (label === 'keep') return 1;
  return 0;
};

/**
 * Reduce a period's source records to one per page.
 *
 * Ingestion stores every capture, by design (see ADR 0003), so a page returned
 * by several keywords in one run or re-fetched on later runs appears many times.
 * Rendering each copy spends the prompt budget re-reading text the model has
 * already seen, and lets one page be cited under several unrelated ids, which
 * inflates apparent coverage.
 *
 * Collapsing here rather than at ingestion keeps every row on disk: the
 * selection is a view, so a change to the identity rule is a re-run, not a
 * migration.
 *
 * The survivor is the newest capture, carrying the strongest label found across
 * all captures of that page. That makes a label effective for the page rather
 * than for whichever row the analyst happened to have open — without it, a
 * `keep` on an older capture would vanish behind a newer unreviewed one, and a
 * `junk` verdict would only ever suppress one row of many.
 *
 * Two kinds of record are passed through untouched:
 * - **Change events.** `visualping` and `distill` emit one record per change to
 *   a URL that is stable *by design* — it is the thing being monitored. Their
 *   identity is the event, not the page, so collapsing them would discard
 *   exactly the signal they exist to deliver. A diff-only record can also carry
 *   no `contentText` at all.
 * - **Records with no usable address**, since nothing then proves two of them
 *   are the same page.
 */
export function collapseDuplicateSources<T extends CollapsibleSource>(
  sources: T[]
): CollapseSourcesResult<T> {
  const selected: T[] = [];
  const indexByCanonicalUrl = new Map<string, number>();
  /** Strongest label seen for the page now held at each index. */
  const strongestLabel = new Map<
    number,
    { label: string; labeledAt: Date | string | null }
  >();
  let collapsedCount = 0;

  const noteLabel = (index: number, source: T) => {
    if (!source.relevanceLabel) return;
    const held = strongestLabel.get(index);
    if (held && labelRank(held.label) >= labelRank(source.relevanceLabel)) {
      return;
    }
    strongestLabel.set(index, {
      label: source.relevanceLabel,
      labeledAt: source.labeledAt ?? null,
    });
  };

  for (const source of sources) {
    if (source.diffAddedText || source.diffRemovedText) {
      selected.push(source);
      continue;
    }

    const canonicalUrl = canonicalizeSourceUrl(source.externalUrl);
    if (canonicalUrl === null) {
      selected.push(source);
      continue;
    }

    const seenAt = indexByCanonicalUrl.get(canonicalUrl);
    if (seenAt === undefined) {
      const index = selected.length;
      indexByCanonicalUrl.set(canonicalUrl, index);
      selected.push(source);
      noteLabel(index, source);
      continue;
    }

    collapsedCount += 1;
    noteLabel(seenAt, source);
    const incumbent = selected[seenAt];
    // Newest capture wins: a page's current text is what a reader would see.
    // `>=` keeps the later of two equal timestamps, which is the common case
    // when one run inserts the same page for several keywords.
    if (
      incumbent === undefined ||
      capturedAtMs(source.capturedAt) >= capturedAtMs(incumbent.capturedAt)
    ) {
      selected[seenAt] = source;
    }
  }

  let inheritedLabelCount = 0;
  for (const [index, { label, labeledAt }] of strongestLabel) {
    const survivor = selected[index];
    if (!survivor) continue;
    if (survivor.relevanceLabel === label) continue;
    inheritedLabelCount += 1;
    selected[index] = { ...survivor, relevanceLabel: label, labeledAt };
  }

  return { selected, collapsedCount, inheritedLabelCount };
}

/** Narrowing helper for callers that want the domain union back. */
export const asSourceRelevanceLabel = (
  label: string | null
): SourceRelevanceLabel | null =>
  label === 'keep' || label === 'junk' ? label : null;
