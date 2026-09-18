/**
 * Resolves the Phoenix dataset an eval case belongs to.
 *
 * A Phoenix dataset is a stable container; only its examples are versioned. So
 * one case maps to exactly one dataset for its whole life, and editing the case
 * appends a new *version* of the same example rather than creating a second
 * dataset. The dataset id lives in the case's `case.json` (committed to git),
 * which is what makes runs weeks apart — or on a teammate's machine — line up
 * in the Phoenix UI.
 */
import {
  contentHash,
  type EvalCase,
  exampleId,
  writePhoenixBinding,
} from './case';

export type DatasetExample = {
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
};

export type ResolvedDataset = {
  datasetId: string;
  /** Pins the experiment to the exact example content this run used. */
  versionId?: string;
  action: 'reused' | 'revised' | 'adopted' | 'created';
  contentHash: string;
};

type PhoenixClient = unknown;

type DatasetApi = {
  createDataset: (args: {
    client: PhoenixClient;
    name: string;
    description?: string;
    examples: DatasetExample[];
  }) => Promise<{ datasetId: string; versionId?: string }>;
  appendDatasetExamples: (args: {
    client: PhoenixClient;
    dataset: { datasetId: string };
    examples: (DatasetExample & { id?: string })[];
  }) => Promise<{ datasetId: string; versionId: string }>;
  getDatasetInfo: (args: {
    client: PhoenixClient;
    dataset: { datasetId: string };
  }) => Promise<{ id: string }>;
  getDatasetInfoByName: (args: {
    client: PhoenixClient;
    datasetName: string;
  }) => Promise<{ id: string }>;
};

async function loadDatasetApi(): Promise<DatasetApi> {
  return (await import('@arizeai/phoenix-client/datasets')) as unknown as DatasetApi;
}

/** A missing dataset is an expected outcome, not a failure. */
async function findRemote(
  api: DatasetApi,
  client: PhoenixClient,
  binding: { datasetId?: string; datasetName: string }
): Promise<string | null> {
  if (binding.datasetId) {
    try {
      const info = await api.getDatasetInfo({
        client,
        dataset: { datasetId: binding.datasetId },
      });
      return info.id;
    } catch {
      return null;
    }
  }
  try {
    const info = await api.getDatasetInfoByName({
      client,
      datasetName: binding.datasetName,
    });
    return info.id;
  } catch {
    return null;
  }
}

export async function ensureDataset(input: {
  client: PhoenixClient;
  evalCase: EvalCase;
  example: DatasetExample;
  description: string;
  log: (message: string, data?: Record<string, unknown>) => void;
}): Promise<ResolvedDataset> {
  const { client, evalCase, example, log } = input;
  const api = await loadDatasetApi();
  const binding = evalCase.manifest.phoenix;
  const hash = contentHash(example);

  const remoteId = await findRemote(api, client, binding);

  if (remoteId && binding.contentHash === hash && binding.datasetId) {
    log('Reusing pinned Phoenix dataset', {
      datasetId: remoteId,
      versionId: binding.versionId,
    });
    return {
      datasetId: remoteId,
      versionId: binding.versionId,
      action: 'reused',
      contentHash: hash,
    };
  }

  if (remoteId) {
    // Same dataset, changed (or first-seen) content: push a new version under
    // the case's stable example id so history stays on one dataset.
    const appended = await api.appendDatasetExamples({
      client,
      dataset: { datasetId: remoteId },
      examples: [{ ...example, id: exampleId(evalCase) }],
    });
    const action = binding.datasetId ? 'revised' : 'adopted';
    log(
      action === 'revised'
        ? 'Case content changed, pushed new dataset version'
        : 'Adopted existing Phoenix dataset by name',
      { datasetId: appended.datasetId, versionId: appended.versionId }
    );
    const resolved: ResolvedDataset = {
      datasetId: appended.datasetId,
      versionId: appended.versionId,
      action,
      contentHash: hash,
    };
    writePhoenixBinding(evalCase, {
      datasetName: binding.datasetName,
      datasetId: resolved.datasetId,
      versionId: resolved.versionId,
      contentHash: hash,
      pushedAt: new Date().toISOString(),
    });
    return resolved;
  }

  if (binding.datasetId) {
    log('Pinned dataset no longer exists in Phoenix, creating a new one', {
      missingDatasetId: binding.datasetId,
    });
  }

  const created = await api.createDataset({
    client,
    name: binding.datasetName,
    description: input.description,
    examples: [example],
  });
  log('Created Phoenix dataset', { datasetId: created.datasetId });
  writePhoenixBinding(evalCase, {
    datasetName: binding.datasetName,
    datasetId: created.datasetId,
    versionId: created.versionId,
    contentHash: hash,
    pushedAt: new Date().toISOString(),
  });
  return {
    datasetId: created.datasetId,
    versionId: created.versionId,
    action: 'created',
    contentHash: hash,
  };
}
