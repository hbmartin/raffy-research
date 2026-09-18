/**
 * Resolves the Phoenix dataset an eval case belongs to.
 *
 * A Phoenix dataset is a stable container; only its examples are versioned. So
 * each of a case's purposes (report generation, summary quality) maps to
 * exactly one dataset for its whole life, and editing the case appends a new
 * *version* of those examples rather than creating a second dataset. The
 * dataset ids live in the case's `case.json` (committed to git),
 * which is what makes runs weeks apart — or on a teammate's machine — line up
 * in the Phoenix UI.
 */
import {
  type CasePhoenixPurpose,
  contentHash,
  type EvalCase,
  writePhoenixBinding,
} from './case';

export type DatasetExample = {
  /** Stable id, so re-pushing updates the example instead of duplicating it. */
  id: string;
  input: Record<string, unknown>;
  output?: Record<string, unknown> | null;
  metadata?: Record<string, unknown> | null;
  /** Split labels, so an experiment can run a fixed subset of the dataset. */
  splits?: string[];
};

export type ResolvedDataset = {
  datasetId: string;
  /** Pins the experiment to the exact example content this run used. */
  versionId?: string;
  action: 'reused' | 'revised' | 'adopted' | 'created';
  contentHash: string;
};

type PhoenixClient = unknown;

/**
 * Only the calls this module uses, and only the fields it reads.
 *
 * `getDataset` resolves a dataset by id *or* name and reports the current
 * version in one round trip, which is why it is preferred over the narrower
 * info calls. Note that `getDatasetInfoByName` exists in the package's source
 * tree but is not re-exported from this entry point, so it cannot be used here.
 */
type DatasetApi = {
  createDataset: (args: {
    client: PhoenixClient;
    name: string;
    description?: string;
    examples: DatasetExample[];
  }) => Promise<{ datasetId: string }>;
  appendDatasetExamples: (args: {
    client: PhoenixClient;
    dataset: { datasetId: string };
    examples: DatasetExample[];
  }) => Promise<{ datasetId: string; versionId: string }>;
  getDataset: (args: {
    client: PhoenixClient;
    dataset: { datasetId: string } | { datasetName: string };
  }) => Promise<{ id: string; versionId?: string }>;
};

/** The calls ensureDataset cannot work without. */
export const REQUIRED_DATASET_CALLS = [
  'createDataset',
  'appendDatasetExamples',
  'getDataset',
] as const;

async function loadDatasetApi(): Promise<DatasetApi> {
  const api =
    (await import('@arizeai/phoenix-client/datasets')) as unknown as Record<
      string,
      unknown
    >;
  const missing = REQUIRED_DATASET_CALLS.filter(
    (name) => typeof api[name] !== 'function'
  );
  if (missing.length > 0) {
    throw new Error(
      `@arizeai/phoenix-client/datasets is missing: ${missing.join(', ')}. The client's export surface changed; scripts/eval/phoenix-dataset.ts needs updating.`
    );
  }
  return api as unknown as DatasetApi;
}

type RemoteDataset = { id: string; versionId?: string };

/**
 * A missing dataset is an expected outcome, not a failure — but anything other
 * than "not found" is a real problem and must not be swallowed.
 */
async function findRemote(
  api: DatasetApi,
  client: PhoenixClient,
  binding: { datasetId?: string; datasetName: string }
): Promise<RemoteDataset | null> {
  const selector = binding.datasetId
    ? { datasetId: binding.datasetId }
    : { datasetName: binding.datasetName };
  try {
    const dataset = await api.getDataset({ client, dataset: selector });
    return { id: dataset.id, versionId: dataset.versionId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/not\s*found|404/i.test(message)) return null;
    throw error;
  }
}

export async function ensureDataset(input: {
  client: PhoenixClient;
  evalCase: EvalCase;
  /** Which of the case's datasets to resolve. */
  purpose: CasePhoenixPurpose;
  datasetName: string;
  examples: DatasetExample[];
  description: string;
  log: (message: string, data?: Record<string, unknown>) => void;
}): Promise<ResolvedDataset> {
  const { client, evalCase, purpose, examples, log } = input;
  const api = await loadDatasetApi();
  const binding = evalCase.manifest.phoenix[purpose] ?? {
    datasetName: input.datasetName,
  };
  const hash = contentHash(examples);

  const remote = await findRemote(api, client, binding);

  if (remote && binding.contentHash === hash && binding.datasetId) {
    // The stored version is authoritative for what this case was scored
    // against; fall back to the dataset's current version when a create never
    // recorded one.
    const versionId = binding.versionId ?? remote.versionId;
    if (!binding.versionId && versionId) {
      // Backfill a case bound before versions were recorded, so the pin lives
      // in git from now on rather than being re-resolved every run.
      writePhoenixBinding(evalCase, purpose, { ...binding, versionId });
      log('Backfilled the missing dataset version into the case', {
        purpose,
        versionId,
      });
    }
    log('Reusing pinned Phoenix dataset', {
      purpose,
      datasetId: remote.id,
      versionId,
      examples: examples.length,
    });
    return {
      datasetId: remote.id,
      versionId,
      action: 'reused',
      contentHash: hash,
    };
  }

  if (remote) {
    // Same dataset, changed (or first-seen) content: push a new version under
    // each example's stable id so history stays on one dataset.
    const appended = await api.appendDatasetExamples({
      client,
      dataset: { datasetId: remote.id },
      examples,
    });
    const action = binding.datasetId ? 'revised' : 'adopted';
    log(
      action === 'revised'
        ? 'Case content changed, pushed new dataset version'
        : 'Adopted existing Phoenix dataset by name',
      {
        purpose,
        datasetId: appended.datasetId,
        versionId: appended.versionId,
        examples: examples.length,
      }
    );
    const resolved: ResolvedDataset = {
      datasetId: appended.datasetId,
      versionId: appended.versionId,
      action,
      contentHash: hash,
    };
    writePhoenixBinding(evalCase, purpose, {
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
      purpose,
      missingDatasetId: binding.datasetId,
    });
  }

  const created = await api.createDataset({
    client,
    name: binding.datasetName,
    description: input.description,
    examples,
  });

  // createDataset reports only the id, so read the version back — without it
  // the first experiments on a new case would run unpinned.
  const createdVersion = await findRemote(api, client, {
    datasetId: created.datasetId,
    datasetName: binding.datasetName,
  });
  const versionId = createdVersion?.versionId;
  if (!versionId) {
    log('Created dataset reported no version; experiments will run unpinned', {
      purpose,
      datasetId: created.datasetId,
    });
  }

  log('Created Phoenix dataset', {
    purpose,
    datasetId: created.datasetId,
    versionId,
    examples: examples.length,
  });
  writePhoenixBinding(evalCase, purpose, {
    datasetName: binding.datasetName,
    datasetId: created.datasetId,
    versionId,
    contentHash: hash,
    pushedAt: new Date().toISOString(),
  });
  return {
    datasetId: created.datasetId,
    versionId,
    action: 'created',
    contentHash: hash,
  };
}
