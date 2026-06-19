import { Result } from '@swan-io/boxed';

import type { EvalExperimentPort } from '../../application/ports/eval-experiment-repository';

export function createNoopEvalAdapter(): EvalExperimentPort {
  return {
    async recordReportGeneration() {
      return Result.Ok({ datasetId: 'noop', exampleId: 'noop' });
    },
    async recordReportEvaluation() {
      return Result.Ok({ experimentId: 'noop' });
    },
    async recordSummaryEvaluation() {
      return Result.Ok({ experimentId: 'noop' });
    },
  };
}
