import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDataset: vi.fn(),
  appendDatasetExamples: vi.fn(),
  getDataset: vi.fn(),
}));

vi.mock('@arizeai/phoenix-client/datasets', () => mocks);

import {
  CASE_FORMAT_VERSION,
  type CaseManifest,
  contentHash,
  loadCase,
  writeCase,
} from '../../../scripts/eval/case';
import {
  ensureDataset,
  REQUIRED_DATASET_CALLS,
} from '../../../scripts/eval/phoenix-dataset';

const example = {
  input: { reportId: 'report-1', sources: [{ id: 's1' }] },
  output: { title: 'Reference report' },
};

function makeCase(phoenix: CaseManifest['phoenix']) {
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
      phoenix,
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
      example,
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
    expect(manifest.phoenix.datasetId).toBe('ds-1');
    expect(manifest.phoenix.contentHash).toBe(contentHash(example));
    expect(manifest.phoenix.versionId).toBe('v-1');
  });

  it('reuses the pinned dataset without writing when content is unchanged', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      versionId: 'v-1',
      contentHash: contentHash(example),
    });
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-1' });

    const result = await ensureDataset({
      client: {},
      evalCase,
      example,
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
      contentHash: contentHash({ input: { reportId: 'stale' } }),
    });
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-1' });
    mocks.appendDatasetExamples.mockResolvedValue({
      datasetId: 'ds-1',
      versionId: 'v-2',
    });

    const result = await ensureDataset({
      client: {},
      evalCase,
      example,
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
    expect(manifest.phoenix.versionId).toBe('v-2');
  });

  it('recreates the dataset when the pinned id is gone from Phoenix', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-deleted',
      versionId: 'v-1',
      contentHash: contentHash(example),
    });
    mocks.getDataset
      .mockRejectedValueOnce(new Error('404'))
      .mockResolvedValueOnce({ id: 'ds-2', versionId: 'v-1' });
    mocks.createDataset.mockResolvedValue({ datasetId: 'ds-2' });

    const result = await ensureDataset({
      client: {},
      evalCase,
      example,
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
      example,
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
      contentHash: contentHash(example),
    });
    mocks.getDataset.mockResolvedValue({ id: 'ds-1', versionId: 'v-7' });

    const result = await ensureDataset({
      client: {},
      evalCase,
      example,
      description: 'd',
      log,
    });

    expect(result).toMatchObject({ action: 'reused', versionId: 'v-7' });
    const manifest = JSON.parse(
      readFileSync(join(evalCase.dir, 'case.json'), 'utf8')
    ) as CaseManifest;
    expect(manifest.phoenix.versionId).toBe('v-7');
    expect(mocks.appendDatasetExamples).not.toHaveBeenCalled();
  });

  it('surfaces a lookup failure that is not a missing dataset', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      contentHash: contentHash(example),
    });
    mocks.getDataset.mockRejectedValue(new Error('503 upstream unavailable'));

    await expect(
      ensureDataset({ client: {}, evalCase, example, description: 'd', log })
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

  it('hashes content independently of key order', () => {
    expect(contentHash({ a: 1, b: { c: 2, d: 3 } })).toBe(
      contentHash({ b: { d: 3, c: 2 }, a: 1 })
    );
  });

  it('rejects a case written in a different format version', () => {
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
