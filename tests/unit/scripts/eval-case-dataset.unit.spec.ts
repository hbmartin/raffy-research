import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDataset: vi.fn(),
  appendDatasetExamples: vi.fn(),
  getDataset: vi.fn(),
  getDatasetExamples: vi.fn(),
}));

vi.mock('@arizeai/phoenix-client/datasets', () => mocks);

import {
  CASE_FORMAT_VERSION,
  type CaseManifest,
  contentHash,
  loadCase,
  readExistingPhoenixBindings,
  writeCase,
} from '../../../scripts/eval/case';
import {
  ensureDataset,
  REQUIRED_DATASET_CALLS,
} from '../../../scripts/eval/phoenix-dataset';

const example = {
  id: 'case-acme-2026-06-15',
  input: { reportId: 'report-1', sources: [{ id: 's1' }] },
  output: { title: 'Reference report' },
};
const examples = [example];

function makeCase(
  reportGeneration: NonNullable<CaseManifest['phoenix']['reportGeneration']>
) {
  const dir = mkdtempSync(join(tmpdir(), 'eval-case-'));
  mkdirSync(dir, { recursive: true });
  writeCase(dir, {
    manifest: {
      formatVersion: CASE_FORMAT_VERSION,
      name: 'acme-2026-06-15',
      workspaceId: 'ws-1',
      reportId: 'report-1',
      periodStart: '2026-06-15T00:00:00.000Z',
      periodEnd: '2026-06-22T00:00:00.000Z',
      exportedAt: '2026-06-23T00:00:00.000Z',
      sourceCount: 1,
      phoenix: { reportGeneration },
    },
    workspace: {
      workspace: { id: 'ws-1', timezone: 'America/Los_Angeles' },
      keywords: [],
      competitors: [],
      socialAccounts: [],
    },
    sources: [],
    report: {
      id: 'report-1',
      reportData: { title: 'Reference report' },
      periodStart: '2026-06-15T00:00:00.000Z',
      periodEnd: '2026-06-22T00:00:00.000Z',
    },
    priorReports: [],
    summaries: [],
  });
  return loadCase(dir);
}

const log = () => undefined;

describe('eval case Phoenix dataset binding', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('creates a dataset and records its id in the case on first push', async () => {
    const evalCase = makeCase({ datasetName: 'report-generation-acme' });
    mocks.getDataset
      .mockRejectedValueOnce(new Error('Dataset not found'))
      .mockResolvedValueOnce({ id: 'ds-1', versionId: 'v-1' });
    mocks.createDataset.mockResolvedValue({ datasetId: 'ds-1' });

    const result = await ensureDataset({
      client: {},
      evalCase,
      purpose: 'reportGeneration',
      datasetName: 'report-generation-acme',
      examples,
      description: 'd',
      log,
    });

    expect(result.action).toBe('created');
    expect(result.datasetId).toBe('ds-1');
    // createDataset returns no version, so it is read back explicitly.
    expect(result.versionId).toBe('v-1');
    const manifest = JSON.parse(
      readFileSync(join(evalCase.dir, 'case.json'), 'utf8')
    ) as CaseManifest;
    expect(manifest.phoenix.reportGeneration?.datasetId).toBe('ds-1');
    expect(manifest.phoenix.reportGeneration?.contentHash).toBe(
      contentHash(examples)
    );
    expect(manifest.phoenix.reportGeneration?.versionId).toBe('v-1');
  });

  it('reuses the pinned dataset without writing when content is unchanged', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      versionId: 'v-1',
      contentHash: contentHash(examples),
    });
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-1' });

    const result = await ensureDataset({
      client: {},
      evalCase,
      purpose: 'reportGeneration',
      datasetName: 'report-generation-acme',
      examples,
      description: 'd',
      log,
    });

    expect(result).toMatchObject({
      action: 'reused',
      datasetId: 'ds-1',
      versionId: 'v-1',
    });
    expect(mocks.createDataset).not.toHaveBeenCalled();
    expect(mocks.appendDatasetExamples).not.toHaveBeenCalled();
  });

  it('appends a new version to the same dataset when the case changes', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      versionId: 'v-1',
      contentHash: contentHash([{ input: { reportId: 'stale' } }]),
    });
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-1' });
    mocks.appendDatasetExamples.mockResolvedValue({
      datasetId: 'ds-1',
      versionId: 'v-2',
    });

    const result = await ensureDataset({
      client: {},
      evalCase,
      purpose: 'reportGeneration',
      datasetName: 'report-generation-acme',
      examples,
      description: 'd',
      log,
    });

    expect(result).toMatchObject({
      action: 'revised',
      datasetId: 'ds-1',
      versionId: 'v-2',
    });
    expect(mocks.createDataset).not.toHaveBeenCalled();
    expect(mocks.appendDatasetExamples).toHaveBeenCalledWith(
      expect.objectContaining({
        dataset: { datasetId: 'ds-1' },
        examples: [expect.objectContaining({ id: 'case-acme-2026-06-15' })],
      })
    );
    const manifest = JSON.parse(
      readFileSync(join(evalCase.dir, 'case.json'), 'utf8')
    ) as CaseManifest;
    expect(manifest.phoenix.reportGeneration?.versionId).toBe('v-2');
  });

  it('recreates the dataset when the pinned id is gone from Phoenix', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-deleted',
      versionId: 'v-1',
      contentHash: contentHash(examples),
    });
    mocks.getDataset
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ id: 'ds-2', versionId: 'v-1' });
    mocks.createDataset.mockResolvedValue({ datasetId: 'ds-2' });

    const result = await ensureDataset({
      client: {},
      evalCase,
      purpose: 'reportGeneration',
      datasetName: 'report-generation-acme',
      examples,
      description: 'd',
      log,
    });

    expect(result).toMatchObject({ action: 'created', datasetId: 'ds-2' });
  });

  it('adopts a dataset that already exists under the case name', async () => {
    const evalCase = makeCase({ datasetName: 'report-generation-acme' });
    mocks.getDataset.mockResolvedValue({ id: 'ds-existing' });
    mocks.appendDatasetExamples.mockResolvedValue({
      datasetId: 'ds-existing',
      versionId: 'v-9',
    });

    const result = await ensureDataset({
      client: {},
      evalCase,
      purpose: 'reportGeneration',
      datasetName: 'report-generation-acme',
      examples,
      description: 'd',
      log,
    });

    expect(result).toMatchObject({
      action: 'adopted',
      datasetId: 'ds-existing',
    });
    expect(mocks.createDataset).not.toHaveBeenCalled();
  });

  it('backfills a version into a case bound before versions were recorded', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      contentHash: contentHash(examples),
    });
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-7' });

    const result = await ensureDataset({
      client: {},
      evalCase,
      purpose: 'reportGeneration',
      datasetName: 'report-generation-acme',
      examples,
      description: 'd',
      log,
    });

    expect(result).toMatchObject({ action: 'reused', versionId: 'v-7' });
    const manifest = JSON.parse(
      readFileSync(join(evalCase.dir, 'case.json'), 'utf8')
    ) as CaseManifest;
    expect(manifest.phoenix.reportGeneration?.versionId).toBe('v-7');
    expect(mocks.appendDatasetExamples).not.toHaveBeenCalled();
  });

  it('surfaces a lookup failure that is not a missing dataset', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      contentHash: contentHash(examples),
    });
    mocks.getDataset.mockRejectedValue(new Error('503 upstream unavailable'));

    await expect(
      ensureDataset({
        client: {},
        evalCase,
        purpose: 'reportGeneration',
        datasetName: 'report-generation-acme',
        examples,
        description: 'd',
        log,
      })
    ).rejects.toThrow(/503/);
    expect(mocks.createDataset).not.toHaveBeenCalled();
  });

  // The mock above cannot catch a call that the real package never exported,
  // which is how an unreachable code path slipped through once already.
  it('depends only on calls the real Phoenix client exports', async () => {
    const actual = await vi.importActual<Record<string, unknown>>(
      '@arizeai/phoenix-client/datasets'
    );
    for (const call of REQUIRED_DATASET_CALLS) {
      expect(typeof actual[call]).toBe('function');
    }
  });

  it('migrates a v1 flat binding onto the report-generation purpose', () => {
    const evalCase = makeCase({ datasetName: 'n' });
    const manifestPath = join(evalCase.dir, 'case.json');
    // v1 stored a single binding directly under `phoenix`.
    writeFileSync(
      manifestPath,
      JSON.stringify(
        {
          ...evalCase.manifest,
          formatVersion: 1,
          phoenix: {
            datasetName: 'report-generation-acme',
            datasetId: 'ds-legacy',
            versionId: 'v-legacy',
            contentHash: 'sha256:abc',
          },
        },
        null,
        2
      )
    );

    const migrated = loadCase(evalCase.dir);
    expect(migrated.manifest.formatVersion).toBe(CASE_FORMAT_VERSION);
    expect(migrated.manifest.phoenix.reportGeneration).toMatchObject({
      datasetId: 'ds-legacy',
      versionId: 'v-legacy',
    });
    // Re-exporting must not orphan an already-pushed dataset.
    expect(
      readExistingPhoenixBindings(evalCase.dir).reportGeneration
    ).toMatchObject({ datasetId: 'ds-legacy' });
  });

  it('reports no bindings for a directory that holds no case', () => {
    expect(
      readExistingPhoenixBindings(mkdtempSync(join(tmpdir(), 'empty-')))
    ).toEqual({});
  });

  it('replaces examples the case no longer pushes', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      versionId: 'v-1',
      contentHash: contentHash(examples),
    });
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-2' });
    // An example pushed before ids were stable keeps its server-assigned id.
    mocks.getDatasetExamples.mockResolvedValue({
      examples: [{ id: 'server-assigned-1' }, { id: example.id }],
    });
    mocks.createDataset.mockResolvedValue({ datasetId: 'ds-1' });

    const result = await ensureDataset({
      client: {},
      evalCase,
      purpose: 'reportGeneration',
      datasetName: 'report-generation-acme',
      examples,
      description: 'd',
      reconcile: true,
      log,
    });

    expect(result).toMatchObject({ action: 'reconciled', datasetId: 'ds-1' });
    // A same-name create replaces the set, so the dataset id and its history survive.
    expect(mocks.createDataset).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'report-generation-acme', examples })
    );
    expect(mocks.appendDatasetExamples).not.toHaveBeenCalled();
    const manifest = JSON.parse(
      readFileSync(join(evalCase.dir, 'case.json'), 'utf8')
    ) as CaseManifest;
    expect(manifest.phoenix.reportGeneration?.versionId).toBe('v-2');
  });

  it('leaves a clean dataset untouched when reconciling', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      versionId: 'v-1',
      contentHash: contentHash(examples),
    });
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-1' });
    mocks.getDatasetExamples.mockResolvedValue({
      examples: [{ id: example.id }],
    });

    const result = await ensureDataset({
      client: {},
      evalCase,
      purpose: 'reportGeneration',
      datasetName: 'report-generation-acme',
      examples,
      description: 'd',
      reconcile: true,
      log,
    });

    expect(result.action).toBe('reused');
    expect(mocks.createDataset).not.toHaveBeenCalled();
    expect(mocks.appendDatasetExamples).not.toHaveBeenCalled();
  });

  // The defect this guards against: a shared, workspace-level dataset that
  // each call replaced, with experiments bound to a bare dataset id that a
  // concurrent run could rewrite before the experiment read it -- so one
  // run's output could be recorded against another's example.
  // The defect this guards against: a shared, workspace-level dataset that
  // each call replaced, with experiments bound to a bare dataset id that
  // another run could rewrite before the experiment read it -- so one run's
  // output could be recorded against another's example.
  //
  // Two pushes are interleaved rather than run in parallel: Vitest's module
  // mocking is not reentrant under concurrent dynamic imports, and the
  // property that prevents misattribution is that each push binds to the
  // version its own call returned, which does not depend on real parallelism.
  it('binds each push of a case to the version that push created', async () => {
    const staleBinding = {
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      versionId: 'v-0',
      contentHash: 'sha256:stale',
    };
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-0' });
    mocks.appendDatasetExamples
      .mockResolvedValueOnce({ datasetId: 'ds-1', versionId: 'v-1' })
      .mockResolvedValueOnce({ datasetId: 'ds-1', versionId: 'v-2' });

    const push = (evalCase: ReturnType<typeof makeCase>) =>
      ensureDataset({
        client: {},
        evalCase,
        purpose: 'reportGeneration',
        datasetName: 'report-generation-acme',
        examples,
        description: 'd',
        log,
      });

    const a = await push(makeCase(staleBinding));
    const b = await push(makeCase(staleBinding));

    // Distinct versions, so an experiment cannot read examples a later push
    // replaced.
    expect(a.versionId).toBe('v-1');
    expect(b.versionId).toBe('v-2');
    expect(a.datasetId).toBe('ds-1');
    expect(b.datasetId).toBe('ds-1');

    // Both pushed the same stable example id, so the dataset converges on one
    // example rather than accumulating a copy per run.
    const pushed = mocks.appendDatasetExamples.mock.calls.flatMap(
      (call) => (call[0] as { examples: { id: string }[] }).examples
    );
    expect(pushed).toHaveLength(2);
    expect(new Set(pushed.map((e) => e.id)).size).toBe(1);
    expect(mocks.createDataset).not.toHaveBeenCalled();
  });

  it('hashes content independently of key order', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      contentHash({ b: { d: 3, c: 2 }, a: 1 })
    );
  });

  it('rejects a case written by newer tooling', () => {
    const evalCase = makeCase({ datasetName: 'n' });
    const manifestPath = join(evalCase.dir, 'case.json');
    const manifest = JSON.parse(
      readFileSync(manifestPath, 'utf8')
    ) as CaseManifest;
    writeFileSync(
      manifestPath,
      JSON.stringify({ ...manifest, formatVersion: 99 }, null, 2)
    );
    expect(() => loadCase(evalCase.dir)).toThrow(/formatVersion 99/);
  });
});
