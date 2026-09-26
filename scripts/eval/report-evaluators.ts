/**
 * Deterministic evaluators for a generated report.
 *
 * Four of them compare against the case's reference report, which is the
 * report that was published for that period -- agreement with it, not
 * correctness. The other three judge the generated report on its own.
 *
 * They live here rather than inline in the experiment so they can be executed
 * against fixtures in tests; three of them were returning wrong numbers for a
 * while precisely because nothing could call them without Phoenix.
 */
import { collectCitedSourceIds } from '@/modules/intelligence';

export type ReportEvaluatorArgs = {
  input: unknown;
  output: unknown;
  expected?: unknown;
};

export type ReportEvaluatorResult = {
  score: number | null;
  label?: string;
  metadata?: Record<string, unknown>;
};

export type ReportEvaluator = {
  name: string;
  evaluate: (args: ReportEvaluatorArgs) => ReportEvaluatorResult;
};

export const REPORT_EVALUATORS: ReportEvaluator[] = [
  {
    name: 'source_overlap',
    evaluate: ({ output, expected }) => {
      const refData = expected as Record<string, unknown> | undefined;
      const genData = output as Record<string, unknown> | null;
      if (!refData || !genData) return { score: null };

      const extractSourceIds = (data: Record<string, unknown>): Set<string> => {
        const ids = new Set<string>();
        const walk = (obj: unknown) => {
          if (!obj || typeof obj !== 'object') return;
          if (Array.isArray(obj)) {
            obj.forEach(walk);
            return;
          }
          const record = obj as Record<string, unknown>;
          if ('source_ids' in record && Array.isArray(record.source_ids)) {
            record.source_ids.forEach((id) => {
              if (typeof id === 'string') ids.add(id);
            });
          }
          Object.values(record).forEach(walk);
        };
        walk(data);
        return ids;
      };

      const refIds = extractSourceIds(refData);
      const genIds = extractSourceIds(genData);
      if (refIds.size === 0) return { score: null };
      const overlap = [...refIds].filter((id) => genIds.has(id)).length;
      const score = overlap / refIds.size;
      return {
        score,
        label: `${overlap}/${refIds.size}`,
        metadata: {
          referenceSourceCount: refIds.size,
          generatedSourceCount: genIds.size,
          overlapCount: overlap,
        },
      };
    },
  },
  {
    name: 'cluster_count',
    evaluate: ({ output, expected }) => {
      const refData = expected as Record<string, unknown> | undefined;
      const genData = output as Record<string, unknown> | null;
      if (!refData || !genData) return { score: null };
      const refClusters = Array.isArray(refData.topic_clusters)
        ? refData.topic_clusters.length
        : 0;
      const genClusters = Array.isArray(genData.topic_clusters)
        ? genData.topic_clusters.length
        : 0;
      const match = refClusters === genClusters ? 1 : 0;
      return {
        score: match,
        label: `${genClusters}/${refClusters}`,
        metadata: {
          referenceClusters: refClusters,
          generatedClusters: genClusters,
        },
      };
    },
  },
  {
    name: 'valid_json',
    evaluate: ({ output }) => {
      const data = output as Record<string, unknown> | null;
      const isValid = data !== null && !data?.parseError;
      return {
        score: isValid ? 1 : 0,
        label: isValid ? 'valid' : 'invalid',
      };
    },
  },
  {
    name: 'source_utilization',
    evaluate: ({ input, output }) => {
      const genData = output as Record<string, unknown> | null;
      const inputData = input as Record<string, unknown>;
      if (!genData || genData.parseError) return { score: null };
      const offered = new Set(
        (Array.isArray(inputData.sources) ? inputData.sources : []).map(
          (source) => String((source as Record<string, unknown>).id)
        )
      );
      const availableCount = offered.size || 1;
      const cited = new Set(collectCitedSourceIds(genData));
      // Only citations to sources that were actually offered count as
      // utilisation. Counting every id the model emitted let a report
      // score above 1.0 by inventing them -- rewarding exactly the
      // failure this is meant to expose.
      const real = [...cited].filter((id) => offered.has(id));
      const invented = [...cited].filter((id) => !offered.has(id));
      return {
        score: real.length / availableCount,
        label: `${real.length}/${availableCount}${invented.length > 0 ? ` (+${invented.length} invented)` : ''}`,
        metadata: {
          citedCount: real.length,
          availableCount,
          inventedCount: invented.length,
          invented: invented.slice(0, 20),
        },
      };
    },
  },
  {
    name: 'competitor_overlap',
    evaluate: ({ output, expected }) => {
      const refData = expected as Record<string, unknown> | undefined;
      const genData = output as Record<string, unknown> | null;
      if (!refData || !genData) return { score: null };
      const extractNames = (data: Record<string, unknown>): Set<string> => {
        const names = new Set<string>();
        const items = data.competitor_watch;
        if (Array.isArray(items)) {
          items.forEach((item) => {
            const name = (item as Record<string, unknown>)?.competitor_name;
            if (typeof name === 'string') names.add(name.toLowerCase());
          });
        }
        return names;
      };
      const refNames = extractNames(refData);
      const genNames = extractNames(genData);
      if (refNames.size === 0) return { score: null };
      const overlap = [...refNames].filter((n) => genNames.has(n)).length;
      return {
        score: overlap / refNames.size,
        label: `${overlap}/${refNames.size}`,
        metadata: {
          referenceCompetitors: [...refNames],
          generatedCompetitors: [...genNames],
          overlapCount: overlap,
        },
      };
    },
  },
  {
    name: 'lead_overlap',
    evaluate: ({ output, expected }) => {
      const refData = expected as Record<string, unknown> | undefined;
      const genData = output as Record<string, unknown> | null;
      if (!refData || !genData) return { score: null };
      // Match on who the lead is, not on the id the model invented for
      // the entry: those are generated per run, so comparing them scored
      // zero however well the two reports agreed.
      const extractIds = (data: Record<string, unknown>): Set<string> => {
        const names = new Set<string>();
        const items = data.possible_leads;
        if (Array.isArray(items)) {
          items.forEach((item) => {
            const name = (item as Record<string, unknown>)?.person_or_company;
            if (typeof name === 'string' && name.trim()) {
              names.add(name.trim().toLowerCase());
            }
          });
        }
        return names;
      };
      const refIds = extractIds(refData);
      const genIds = extractIds(genData);
      if (refIds.size === 0) return { score: null };
      const overlap = [...refIds].filter((id) => genIds.has(id)).length;
      return {
        score: overlap / refIds.size,
        label: `${overlap}/${refIds.size}`,
        metadata: {
          referenceLeads: refIds.size,
          generatedLeads: genIds.size,
          overlapCount: overlap,
        },
      };
    },
  },
  {
    name: 'evidence_density',
    evaluate: ({ output }) => {
      const genData = output as Record<string, unknown> | null;
      if (!genData || genData.parseError) return { score: null };
      const clusters = Array.isArray(genData.topic_clusters)
        ? genData.topic_clusters
        : [];
      if (clusters.length === 0) return { score: null, label: 'no-clusters' };

      // representative_evidence is a subset of all_evidence, so summing
      // both counted every item twice and reported double the density.
      const ids = new Set<string>();
      let unidentified = 0;
      for (const cluster of clusters) {
        const record = cluster as Record<string, unknown>;
        for (const key of ['all_evidence', 'representative_evidence']) {
          const items = record[key];
          if (!Array.isArray(items)) continue;
          for (const item of items) {
            const id = (item as Record<string, unknown>)?.id;
            if (typeof id === 'string' && id) ids.add(id);
            else unidentified += 1;
          }
        }
      }
      const totalEvidence = ids.size + unidentified;
      const density = totalEvidence / clusters.length;
      return {
        score: density,
        label: `${totalEvidence}ev/${clusters.length}cl`,
        metadata: {
          totalEvidence,
          clusterCount: clusters.length,
          avgPerCluster: density,
        },
      };
    },
  },
];
