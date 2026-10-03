import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type {
  EditorialAngle,
  EvidenceSource,
  Runtime,
  TrackedTopic,
} from './newsletter';

// Conservative limits verified against provider model documentation. Unknown
// names remain valid models, but require a declared limit or adapter discovery.
const knownLimits: Record<string, number> = {
  'gpt-5': 400_000,
  'gpt-5-mini': 400_000,
  'gpt-5-nano': 400_000,
  'gpt-5.4': 1_050_000,
  'gpt-4.1': 1_000_000,
  'claude-haiku-4-5': 200_000,
  'claude-sonnet-4-5': 200_000,
  'claude-sonnet-4-6': 200_000,
  'claude-opus-4-6': 200_000,
  sonnet: 200_000,
  opus: 200_000,
  haiku: 200_000,
};
export function resolveContextBudget(runtime: Runtime): number | undefined {
  return runtime.contextWindowTokens ?? knownLimits[runtime.model];
}

/** UTF-8 bytes bound token count conservatively, including non-English text. */
export const promptSize = (value: string) =>
  new TextEncoder().encode(value).length;
export const inputBudget = (context: number) => Math.max(1024, context - 6144);

export function resolveTopicRoot(
  topics: TrackedTopic[],
  id: string
): string | undefined {
  const visited = new Set<string>();
  let current = topics.find((t) => t.id === id);
  while (current?.mergedInto) {
    if (visited.has(current.id)) return undefined;
    visited.add(current.id);
    current = topics.find((t) => t.id === current!.mergedInto);
  }
  return current?.id;
}

/** Include every input that can alter a central-claim judgment. */
export function auditSignature(
  angle: EditorialAngle,
  sources: EvidenceSource[],
  audience = ''
): string {
  return bytesToHex(
    sha256(
      new TextEncoder().encode(
        JSON.stringify({
          audience,
          claims: angle.claims,
          takeaway: angle.takeaway,
          counterevidence: angle.counterevidence,
          gaps: angle.gaps,
          sources: sources
            .filter((s) => angle.sourceIds.includes(s.id))
            .map((s) => ({
              id: s.id,
              identity: s.identity,
              content: s.contentFingerprint ?? processingSignature(s.content),
              url: s.url,
              authority: s.authority,
              explanation: s.authorityExplanation,
              junk: s.junk,
              retracted: s.retracted,
            }))
            .sort((a, b) => a.id.localeCompare(b.id)),
        })
      )
    )
  );
}

export type ProcessingSlice = { sourceId: string; start: number; end: number };
export type ProcessingBatch = {
  reportId: string;
  slices: ProcessingSlice[];
  topicIds: string[];
  angleIds: string[];
};
/** Original text is partitioned, never shortened or replaced by model paraphrases. */
export function partitionSources(
  sources: EvidenceSource[],
  bytes: number
): ProcessingSlice[][] {
  const batches: ProcessingSlice[][] = [];
  let batch: ProcessingSlice[] = [],
    size = 0;
  for (const source of sources) {
    const length = source.contentLength ?? source.content.length;
    let start = 0;
    while (start < length) {
      let end = Math.min(length, start + Math.max(1, Math.floor(bytes / 6)));
      // Overlap supports quotations across boundaries while progress stays finite.
      const sliceSize = source.content
        ? promptSize(
            JSON.stringify({
              ...source,
              content: source.content.slice(start, end),
            })
          )
        : promptSize(JSON.stringify(source)) + (end - start) * 6;
      if (batch.length && size + sliceSize > bytes) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      batch.push({ sourceId: source.id, start, end });
      size += sliceSize;
      if (size >= bytes) {
        batches.push(batch);
        batch = [];
        size = 0;
      }
      if (end === length) break;
      start = Math.max(
        start + 1,
        end - Math.min(256, Math.floor((end - start) / 4))
      );
    }
  }
  if (batch.length) batches.push(batch);
  return batches;
}

export const processingSignature = (input: unknown): string =>
  bytesToHex(sha256(new TextEncoder().encode(JSON.stringify(input))));
