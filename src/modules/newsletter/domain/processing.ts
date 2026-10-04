import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex } from '@noble/hashes/utils.js';

import type {
  EditorialAngle,
  EvidenceSource,
  GenerationBudget,
  NewsletterJob,
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
  const limit = runtime.contextLimit;
  const bound =
    limit?.model === runtime.model && limit.provider === runtime.provider
      ? limit.tokens
      : knownContextLimit(runtime.model, runtime.provider);
  if (runtime.contextWindowTokens && bound)
    return Math.min(runtime.contextWindowTokens, bound);
  return runtime.contextWindowTokens ?? bound;
}
export const knownContextLimit = (
  model: string,
  provider?: Runtime['provider']
) => {
  if (
    provider === 'ollama' ||
    (provider === 'openai' && !model.startsWith('gpt-')) ||
    (provider === 'claude-code' && model.startsWith('gpt-')) ||
    (provider === 'codex-cli' && !model.startsWith('gpt-'))
  )
    return undefined;
  return knownLimits[model];
};
export const DEFAULT_HOSTED_OUTPUT_TOKENS = 16384;
export function resolveGenerationBudget(
  runtime: Runtime,
  operatorCeiling?: number
):
  | { type: 'budget_resolved'; budget: GenerationBudget }
  | { type: 'context_required' }
  | { type: 'local_allocation_required' }
  | { type: 'budget_invalid'; message: string } {
  const context = resolveContextBudget(runtime);
  if (!context) return { type: 'context_required' };
  if (runtime.provider === 'ollama' && !operatorCeiling)
    return { type: 'local_allocation_required' };
  const contextTokens =
    runtime.provider === 'ollama'
      ? Math.min(context, operatorCeiling!)
      : context;
  const outputTokens =
    runtime.mode === 'hosted'
      ? (runtime.maxOutputTokens ?? DEFAULT_HOSTED_OUTPUT_TOKENS)
      : 4096;
  const safetyTokens = 2048;
  const inputBytes = contextTokens - outputTokens - safetyTokens;
  if (inputBytes < 1024)
    return {
      type: 'budget_invalid',
      message:
        'The context must fit the response allowance, a 2,048-token margin, and at least 1,024 input tokens. Lower the response cap or increase the available context.',
    };
  return {
    type: 'budget_resolved',
    budget: {
      contextTokens,
      outputTokens,
      inputBytes,
      safetyTokens,
      origin: runtime.contextWindowTokens
        ? 'declared'
        : (runtime.contextLimit?.origin ?? 'known'),
      ...(runtime.provider === 'ollama' ? { operatorCeiling } : {}),
    },
  };
}
export function jobGenerationBudget(
  job: NewsletterJob
): GenerationBudget | undefined {
  if (job.budget) return job.budget;
  const contextTokens = job.contextBudget ?? resolveContextBudget(job.runtime);
  if (!contextTokens) return undefined;
  return {
    contextTokens,
    outputTokens: 4096,
    inputBytes: contextTokens - 6144,
    safetyTokens: 2048,
    origin: 'legacy',
  };
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
