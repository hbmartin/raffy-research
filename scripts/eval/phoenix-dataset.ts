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
  type CasePhoenixBinding,
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
  action: 'reused' | 'revised' | 'adopted' | 'created' | 'reconciled';
  contentHash: string;
};

/**
 * Example ids present remotely that this case no longer pushes.
 *
 * These are left behind when an example's id changes — an example pushed
 * before ids were stable keeps its server-assigned one, and the next push
 * creates a sibling rather than replacing it. Every run then evaluates the
 * duplicate too, silently doubling cost and averaging two runs into one score.
 */
async function findStaleExampleIds(
  api: DatasetApi,
  client: PhoenixClient,
  datasetId: string,
  examples: DatasetExample[]
): Promise<string[]> {
  const ours = new Set(examples.map((example) => example.id));
  const remote = await api.getDatasetExamples({
    client,
    dataset: { datasetId },
  });
  return remote.examples
    .map((example) => example.id)
    .filter((id) => !ours.has(id));
}

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
  getDatasetExamples: (args: {
    client: PhoenixClient;
    dataset: { datasetId: string };
  }) => Promise<{ examples: { id: string }[] }>;
};

/** The calls ensureDataset cannot work without. */
export const REQUIRED_DATASET_CALLS = [
  'createDataset',
  'appendDatasetExamples',
  'getDataset',
  'getDatasetExamples',
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

/** Everything the four resolution paths share. */
type ResolveContext = {
  api: DatasetApi;
  client: PhoenixClient;
  evalCase: EvalCase;
  purpose: CasePhoenixPurpose;
  binding: CasePhoenixBinding;
  examples: DatasetExample[];
  hash: string;
  description: string;
  log: (message: string, data?: Record<string, unknown>) => void;
};

/** Record where this case now lives, and report it. */
function commit(
  ctx: ResolveContext,
  resolved: Omit<ResolvedDataset, 'contentHash'>
): ResolvedDataset {
  writePhoenixBinding(ctx.evalCase, ctx.purpose, {
    datasetName: ctx.binding.datasetName,
    datasetId: resolved.datasetId,
    versionId: resolved.versionId,
    contentHash: ctx.hash,
    pushedAt: new Date().toISOString(),
  });
  return { ...resolved, contentHash: ctx.hash };
}

/**
 * Replace the example set when the dataset holds examples this case no longer
 * pushes. A same-name create replaces the set and keeps the dataset id, so the
 * experiments recorded against it survive the repair.
 *
 * Returns null when there is nothing stale, leaving the normal paths to run.
 */
async function reconcileStaleExamples(
  ctx: ResolveContext,
  remote: RemoteDataset
): Promise<ResolvedDataset | null> {
  const stale = await findStaleExampleIds(
    ctx.api,
    ctx.client,
    remote.id,
    ctx.examples
  );
  if (stale.length === 0) {
    ctx.log(
      "Dataset holds exactly this case's examples; nothing to reconcile",
      {
        purpose: ctx.purpose,
        datasetId: remote.id,
        examples: ctx.examples.length,
      }
    );
    return null;
  }

  ctx.log('Replacing stale examples left by an earlier push', {
    purpose: ctx.purpose,
    datasetId: remote.id,
    stale,
  });
  const recreated = await ctx.api.createDataset({
    client: ctx.client,
    name: ctx.binding.datasetName,
    description: ctx.description,
    examples: ctx.examples,
  });
  const after = await findRemote(ctx.api, ctx.client, {
    datasetId: recreated.datasetId,
    datasetName: ctx.binding.datasetName,
  });
  ctx.log('Reconciled Phoenix dataset', {
    purpose: ctx.purpose,
    datasetId: recreated.datasetId,
    examples: ctx.examples.length,
  });
  return commit(ctx, {
    datasetId: recreated.datasetId,
    versionId: after?.versionId,
    action: 'reconciled',
  });
}

/** Content unchanged: keep the pinned dataset and write nothing. */
function reusePinnedDataset(
  ctx: ResolveContext,
  remote: RemoteDataset
): ResolvedDataset {
  // The stored version is authoritative for what this case was scored
  // against; fall back to the dataset's current version when a create never
  // recorded one.
  const versionId = ctx.binding.versionId ?? remote.versionId;
  if (!ctx.binding.versionId && versionId) {
    // Backfill a case bound before versions were recorded, so the pin lives
    // in git from now on rather than being re-resolved every run.
    writePhoenixBinding(ctx.evalCase, ctx.purpose, {
      ...ctx.binding,
      versionId,
    });
    ctx.log('Backfilled the missing dataset version into the case', {
      purpose: ctx.purpose,
      versionId,
    });
  }
  ctx.log('Reusing pinned Phoenix dataset', {
    purpose: ctx.purpose,
    datasetId: remote.id,
    versionId,
    examples: ctx.examples.length,
  });
  return {
    datasetId: remote.id,
    versionId,
    action: 'reused',
    contentHash: ctx.hash,
  };
}

/**
 * Same dataset, changed (or first-seen) content: push a new version under each
 * example's stable id so history stays on one dataset.
 */
async function appendNewVersion(
  ctx: ResolveContext,
  remote: RemoteDataset
): Promise<ResolvedDataset> {
  const appended = await ctx.api.appendDatasetExamples({
    client: ctx.client,
    dataset: { datasetId: remote.id },
    examples: ctx.examples,
  });
  const action = ctx.binding.datasetId ? 'revised' : 'adopted';
  ctx.log(
    action === 'revised'
      ? 'Case content changed, pushed new dataset version'
      : 'Adopted existing Phoenix dataset by name',
    {
      purpose: ctx.purpose,
      datasetId: appended.datasetId,
      versionId: appended.versionId,
      examples: ctx.examples.length,
    }
  );
  return commit(ctx, {
    datasetId: appended.datasetId,
    versionId: appended.versionId,
    action,
  });
}

/** No dataset to reuse: create one and pin the version it starts at. */
async function createPinnedDataset(
  ctx: ResolveContext
): Promise<ResolvedDataset> {
  if (ctx.binding.datasetId) {
    ctx.log('Pinned dataset no longer exists in Phoenix, creating a new one', {
      purpose: ctx.purpose,
      missingDatasetId: ctx.binding.datasetId,
    });
  }

  const created = await ctx.api.createDataset({
    client: ctx.client,
    name: ctx.binding.datasetName,
    description: ctx.description,
    examples: ctx.examples,
  });

  // createDataset reports only the id, so read the version back — without it
  // the first experiments on a new case would run unpinned.
  const createdVersion = await findRemote(ctx.api, ctx.client, {
    datasetId: created.datasetId,
    datasetName: ctx.binding.datasetName,
  });
  const versionId = createdVersion?.versionId;
  if (!versionId) {
    ctx.log(
      'Created dataset reported no version; experiments will run unpinned',
      { purpose: ctx.purpose, datasetId: created.datasetId }
    );
  }

  ctx.log('Created Phoenix dataset', {
    purpose: ctx.purpose,
    datasetId: created.datasetId,
    versionId,
    examples: ctx.examples.length,
  });
  return commit(ctx, {
    datasetId: created.datasetId,
    versionId,
    action: 'created',
  });
}

export async function ensureDataset(input: {
  client: PhoenixClient;
  evalCase: EvalCase;
  /** Which of the case's datasets to resolve. */
  purpose: CasePhoenixPurpose;
  datasetName: string;
  examples: DatasetExample[];
  description: string;
  /** Check for, and replace, examples the case no longer pushes. */
  reconcile?: boolean;
  log: (message: string, data?: Record<string, unknown>) => void;
}): Promise<ResolvedDataset> {
  const api = await loadDatasetApi();
  const binding = input.evalCase.manifest.phoenix[input.purpose] ?? {
    datasetName: input.datasetName,
  };
  const ctx: ResolveContext = {
    api,
    client: input.client,
    evalCase: input.evalCase,
    purpose: input.purpose,
    binding,
    examples: input.examples,
    hash: contentHash(input.examples),
    description: input.description,
    log: input.log,
  };

  const remote = await findRemote(api, input.client, binding);
  if (!remote) return createPinnedDataset(ctx);

  if (input.reconcile) {
    const reconciled = await reconcileStaleExamples(ctx, remote);
    if (reconciled) return reconciled;
  }

  const unchanged = binding.contentHash === ctx.hash && binding.datasetId;
  return unchanged
    ? reusePinnedDataset(ctx, remote)
    : appendNewVersion(ctx, remote);
}
