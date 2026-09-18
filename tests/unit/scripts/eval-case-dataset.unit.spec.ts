import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createDataset: vi.fn(),
  appendDatasetExamples: vi.fn(),
  getDatasetInfo: vi.fn(),
  getDatasetInfoByName: vi.fn(),
}));

vi.mock('@arizeai/phoenix-client/datasets', () => mocks);

import {
  CASE_FORMAT_VERSION,
  type CaseManifest,
  contentHash,
  loadCase,
  writeCase,
} from '../../../scripts/eval/case';
import { ensureDataset } from '../../../scripts/eval/phoenix-dataset';

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
    mocks.getDatasetInfoByName.mockRejectedValue(new Error('not found'));
    mocks.createDataset.mockResolvedValue({
      datasetId: 'ds-1',
      versionId: 'v-1',
    });

    const result = await ensureDataset({
      client: {},
      evalCase,
      example,
      description: 'd',
      log,
    });

    expect(result.action).toBe('created');
    expect(result.datasetId).toBe('ds-1');
    const manifest = JSON.parse(
      readFileSync(join(evalCase.dir, 'case.json'), 'utf8')
    ) as CaseManifest;
    expect(manifest.phoenix.datasetId).toBe('ds-1');
    expect(manifest.phoenix.contentHash).toBe(contentHash(example));
  });

  it('reuses the pinned dataset without writing when content is unchanged', async () => {
    const evalCase = makeCase({
      datasetName: 'report-generation-acme',
      datasetId: 'ds-1',
      versionId: 'v-1',
      contentHash: contentHash(example),
    });
    mocks.getDatasetInfo.mockResolvedValue({ id: 'ds-1' });

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
    mocks.getDatasetInfo.mockResolvedValue({ id: 'ds-1' });
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
    mocks.getDatasetInfo.mockRejectedValue(new Error('404'));
    mocks.createDataset.mockResolvedValue({
      datasetId: 'ds-2',
      versionId: 'v-1',
    });

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
    mocks.getDatasetInfoByName.mockResolvedValue({ id: 'ds-existing' });
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
