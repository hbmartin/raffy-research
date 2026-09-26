/**
 * Reference-free quality checks for source summaries.
 *
 * There is no gold summary to compare against, so every check scores a summary
 * against the source it came from. Each is deterministic: no model is called,
 * so a whole case can be scored for free and re-scored as prompts change.
 *
 * All of them read `sourceText`, which is the source *as the summarizer saw
 * it* — already truncated to the prompt's content budget. Scoring against the
 * full stored text would mark faithful summaries as ungrounded, because the
 * model never saw the part they would be judged on.
 */

export type SummaryExampleInput = {
  sourceRecordId: string;
  sourceText: string;
  sourceLength: number;
  truncated: boolean;
};

export type SummaryExampleOutput = {
  summaryText: string | null;
  evidenceCandidateText: string | null;
  parseError?: boolean;
};

export type EvaluatorResult = {
  score: number | null;
  label?: string;
  metadata?: Record<string, unknown>;
};

/** The budget `renderSourceSummary` truncates a summary to in the report prompt. */
export const SUMMARY_LENGTH_BUDGET = 500;
/** Below this a "summary" carries no usable information. */
const SUMMARY_MIN_LENGTH = 80;

const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Longest run of consecutive words from `needle` that appears in `haystack`,
 * as a fraction of `needle`'s words. A verbatim excerpt scores 1; a
 * paraphrase degrades smoothly rather than failing outright.
 */
function longestPhraseOverlap(needle: string, haystack: string): number {
  const needleWords = normalize(needle).split(' ').filter(Boolean);
  if (needleWords.length === 0) return 0;
  const hay = ` ${normalize(haystack)} `;

  let best = 0;
  for (let start = 0; start < needleWords.length; start++) {
    // Only extend past the current best: shorter runs cannot improve the score.
    let end = start + best;
    while (end < needleWords.length) {
      const phrase = needleWords.slice(start, end + 1).join(' ');
      if (!hay.includes(` ${phrase} `)) break;
      best = end - start + 1;
      end++;
    }
  }
  return best / needleWords.length;
}

/** Figures a summary can get wrong in ways that matter: money, dates, counts. */
function extractFigures(text: string): string[] {
  const matches = text.match(
    /(?:\$|€|£|PKR\s?)?\d[\d,.]*\s?(?:%|percent|k|m|bn|billion|million|\/mo|\/month)?/gi
  );
  return (matches ?? [])
    .map((m) => m.trim())
    .filter((m) => /\d/.test(m) && m.replace(/\D/g, '').length >= 2);
}

const RECOMMENDATION_PATTERNS = [
  /\byou (?:should|need to|must|ought to)\b/i,
  /\bwe (?:should|recommend|suggest)\b/i,
  /\b(?:recommend|recommendation|advisable)\b/i,
  /\bconsider (?:launching|increasing|reducing|investing|prioritizing)\b/i,
];

const INSTRUCTION_ECHO_PATTERNS = [
  /\bignore (?:all )?(?:previous|prior|above)\b/i,
  /\bas an ai\b/i,
  /\byou are (?:a|an) [a-z ]*(?:assistant|model)\b/i,
  /\bsystem prompt\b/i,
  /\bdisregard\b.{0,20}\binstructions\b/i,
];

export type SummaryEvaluator = {
  name: string;
  evaluate: (args: {
    input: SummaryExampleInput;
    output: SummaryExampleOutput;
  }) => EvaluatorResult;
};

export const SUMMARY_EVALUATORS: SummaryEvaluator[] = [
  {
    // The pipeline falls back to raw model text when JSON parsing fails, which
    // otherwise makes a malformed response indistinguishable from a good one.
    name: 'valid_schema',
    evaluate: ({ output }) => {
      const hasSummary = Boolean(output.summaryText?.trim());
      const hasEvidence = Boolean(output.evidenceCandidateText?.trim());
      const ok = !output.parseError && hasSummary && hasEvidence;
      return {
        score: ok ? 1 : 0,
        label: ok
          ? 'valid'
          : output.parseError
            ? 'parse-error'
            : !hasSummary
              ? 'missing-summary'
              : 'missing-evidence',
        metadata: { hasSummary, hasEvidence },
      };
    },
  },
  {
    // evidence_candidate is what a later report cites, so it has to be text
    // that actually exists in the source.
    name: 'evidence_verbatim',
    evaluate: ({ input, output }) => {
      const evidence = output.evidenceCandidateText?.trim();
      if (!evidence) return { score: null, label: 'no-evidence' };
      const overlap = longestPhraseOverlap(evidence, input.sourceText);
      return {
        score: overlap,
        label: overlap === 1 ? 'verbatim' : `${Math.round(overlap * 100)}%`,
        metadata: { evidenceLength: evidence.length },
      };
    },
  },
  {
    name: 'grounded_figures',
    evaluate: ({ input, output }) => {
      const summary = output.summaryText?.trim();
      if (!summary) return { score: null };
      const figures = extractFigures(summary);
      if (figures.length === 0) {
        return { score: null, label: 'no-figures' };
      }
      const source = normalize(input.sourceText);
      const grounded = figures.filter((figure) =>
        source.includes(normalize(figure))
      );
      return {
        score: grounded.length / figures.length,
        label: `${grounded.length}/${figures.length}`,
        metadata: {
          figures,
          ungrounded: figures.filter(
            (figure) => !source.includes(normalize(figure))
          ),
        },
      };
    },
  },
  {
    // Anything past the budget is cut mid-sentence before a model reads it.
    name: 'length_fit',
    evaluate: ({ output }) => {
      const length = output.summaryText?.trim().length ?? 0;
      if (length === 0) return { score: 0, label: 'empty' };
      if (length < SUMMARY_MIN_LENGTH) {
        return {
          score: length / SUMMARY_MIN_LENGTH,
          label: `short (${length})`,
          metadata: { length },
        };
      }
      if (length <= SUMMARY_LENGTH_BUDGET) {
        return { score: 1, label: `fits (${length})`, metadata: { length } };
      }
      const overflow = length - SUMMARY_LENGTH_BUDGET;
      return {
        score: Math.max(0, 1 - overflow / SUMMARY_LENGTH_BUDGET),
        label: `over by ${overflow}`,
        metadata: { length, truncatedChars: overflow },
      };
    },
  },
  {
    name: 'compression_ratio',
    evaluate: ({ input, output }) => {
      const length = output.summaryText?.trim().length ?? 0;
      if (length === 0 || input.sourceText.length === 0) return { score: null };
      const ratio = length / input.sourceText.length;
      return {
        score: ratio,
        label: `${(ratio * 100).toFixed(1)}%`,
        metadata: {
          summaryLength: length,
          sourceLength: input.sourceText.length,
        },
      };
    },
  },
  {
    // The product forbids recommendations; enforce it rather than hope.
    name: 'no_recommendation',
    evaluate: ({ output }) => {
      const summary = output.summaryText ?? '';
      const hits = RECOMMENDATION_PATTERNS.filter((pattern) =>
        pattern.test(summary)
      ).map((pattern) => pattern.source);
      return {
        score: hits.length === 0 ? 1 : 0,
        label: hits.length === 0 ? 'clean' : `${hits.length} hit(s)`,
        metadata: { hits },
      };
    },
  },
  {
    // Sources are untrusted input; a summary echoing instruction-like text is
    // a sign the model treated source content as direction.
    name: 'no_instruction_echo',
    evaluate: ({ output }) => {
      const text = `${output.summaryText ?? ''} ${output.evidenceCandidateText ?? ''}`;
      const hits = INSTRUCTION_ECHO_PATTERNS.filter((pattern) =>
        pattern.test(text)
      ).map((pattern) => pattern.source);
      return {
        score: hits.length === 0 ? 1 : 0,
        label: hits.length === 0 ? 'clean' : `${hits.length} hit(s)`,
        metadata: { hits },
      };
    },
  },
];
