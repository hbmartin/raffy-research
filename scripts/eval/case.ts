/**
 * An eval case is a self-contained, git-stored snapshot of everything the
 * report prompt consumes: the workspace and its tracked entities, the source
 * records for one period, the prior reports that were in context, and the
 * published report that serves as the reference output.
 *
 * Cases are the source of truth. Phoenix datasets are a projection of them, so
 * a case carries the Phoenix identity it was pushed under (see `case.json`),
 * which is what lets runs weeks apart land in the same dataset.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

export const CASE_FORMAT_VERSION = 2;

export const CASE_FILES = {
  manifest: 'case.json',
  workspace: 'workspace.json',
  sources: 'sources.json',
  report: 'report.json',
  priorReports: 'prior-reports.json',
  summaries: 'summaries.json',
} as const;

export type CaseSource = {
  id: string;
  providerName: string;
  sourceType: string;
  title: string | null;
  authorOrAccount: string | null;
  externalUrl: string | null;
  contentText: string | null;
  diffAddedText: string | null;
  diffRemovedText: string | null;
  relevanceLabel: string | null;
  publishedAt: string | null;
  [key: string]: unknown;
};

export type CaseWorkspace = {
  workspace: Record<string, unknown>;
  keywords: Record<string, unknown>[];
  competitors: Record<string, unknown>[];
  socialAccounts: Record<string, unknown>[];
};

export type CaseReport = {
  id: string;
  reportData: Record<string, unknown> | null;
  periodStart: string;
  periodEnd: string;
  modelMetadata?: Record<string, unknown> | null;
};

export type CaseSummary = {
  id: string;
  sourceRecordId: string;
  summaryText: string | null;
  evidenceCandidateText: string | null;
  modelName: string | null;
  modelProvider: string | null;
  promptVersion: string | null;
  createdAt: string;
};

/**
 * A case owns one Phoenix dataset per purpose — report generation and summary
 * quality are scored on different examples and must not share a dataset.
 */
export type CasePhoenixPurpose = 'reportGeneration' | 'summary';

/** Phoenix identity, recorded on first push and reused by every later run. */
export type CasePhoenixBinding = {
  datasetName: string;
  datasetId?: string;
  versionId?: string;
  /** Content hash of the example payload that was last pushed. */
  contentHash?: string;
  pushedAt?: string;
};

export type CaseManifest = {
  formatVersion: number;
  name: string;
  workspaceId: string;
  reportId: string;
  periodStart: string;
  periodEnd: string;
  exportedAt: string;
  sourceCount: number;
  summaryCount?: number;
  /** Models whose summaries were exported into this case. */
  summaryModels?: string[];
  /**
   * A fixed subset of sources, published to Phoenix as the `sample` split.
   *
   * Membership lives in git so the sample is the same on every run and every
   * machine: a ten-source experiment today is comparable with one next month.
   */
  sampleSourceIds?: string[];
  phoenix: Partial<Record<CasePhoenixPurpose, CasePhoenixBinding>>;
};

export type EvalCase = {
  dir: string;
  manifest: CaseManifest;
  workspace: CaseWorkspace;
  sources: CaseSource[];
  report: CaseReport;
  priorReports: Record<string, unknown>[];
  summaries: CaseSummary[];
};

function readJson<T>(dir: string, file: string): T {
  const path = join(dir, file);
  if (!existsSync(path)) {
    throw new Error(
      `Eval case at ${dir} is missing ${file}. Legacy two-file fixtures are no longer complete enough to run without a database — re-export with: pnpm eval:phoenix export --workspace <id> --report <id> --out ${dir}`
    );
  }
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

function readOptionalJson<T>(dir: string, file: string, fallback: T): T {
  const path = join(dir, file);
  if (!existsSync(path)) return fallback;
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/**
 * v1 carried a single flat Phoenix binding, before a case could own more than
 * one dataset. Migrating in memory keeps already-pushed dataset ids working;
 * the next push rewrites the file in the current shape.
 */
function migrateManifest(
  manifest: CaseManifest & {
    phoenix?:
      | CasePhoenixBinding
      | Partial<Record<CasePhoenixPurpose, CasePhoenixBinding>>;
  }
): CaseManifest {
  if (manifest.formatVersion > CASE_FORMAT_VERSION) {
    throw new Error(
      `Eval case has formatVersion ${manifest.formatVersion}, which is newer than this tooling supports (${CASE_FORMAT_VERSION})`
    );
  }
  const phoenix = manifest.phoenix as Record<string, unknown> | undefined;
  const isFlatV1 = Boolean(phoenix && 'datasetName' in phoenix);
  return {
    ...manifest,
    formatVersion: CASE_FORMAT_VERSION,
    phoenix: isFlatV1
      ? { reportGeneration: phoenix as unknown as CasePhoenixBinding }
      : ((phoenix ?? {}) as Partial<
          Record<CasePhoenixPurpose, CasePhoenixBinding>
        >),
  };
}

/**
 * Phoenix bindings already recorded for a case, if any.
 *
 * Re-exporting a case refreshes its content but must not orphan the datasets
 * it has already been pushed to — the whole point of pinning ids in git.
 */
export function readExistingPhoenixBindings(
  caseDir: string
): Partial<Record<CasePhoenixPurpose, CasePhoenixBinding>> {
  const dir = resolve(process.cwd(), caseDir);
  const path = join(dir, CASE_FILES.manifest);
  if (!existsSync(path)) return {};
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as CaseManifest;
    return migrateManifest(manifest).phoenix;
  } catch {
    return {};
  }
}

export function loadCase(caseDir: string): EvalCase {
  const dir = resolve(process.cwd(), caseDir);
  const manifest = migrateManifest(
    readJson<CaseManifest>(dir, CASE_FILES.manifest)
  );
  return {
    dir,
    manifest,
    workspace: readJson<CaseWorkspace>(dir, CASE_FILES.workspace),
    sources: readJson<CaseSource[]>(dir, CASE_FILES.sources),
    report: readJson<CaseReport>(dir, CASE_FILES.report),
    priorReports: readJson<Record<string, unknown>[]>(
      dir,
      CASE_FILES.priorReports
    ),
    summaries: readOptionalJson<CaseSummary[]>(dir, CASE_FILES.summaries, []),
  };
}

/**
 * Loads a case and refuses one belonging to a different workspace.
 *
 * The case carries its own identity, so a mismatched --workspace was simply
 * ignored -- which let one workspace's reference report be scored against
 * another workspace's context without complaint.
 */
export function loadCaseForWorkspace(
  caseDir: string,
  workspaceId: string
): EvalCase {
  const evalCase = loadCase(caseDir);
  if (evalCase.manifest.workspaceId !== workspaceId) {
    throw new Error(
      `Eval case ${evalCase.manifest.name} belongs to workspace ${evalCase.manifest.workspaceId}, not ${workspaceId}`
    );
  }
  return evalCase;
}

export function writeCase(
  caseDir: string,
  input: Omit<EvalCase, 'dir'>
): string {
  const dir = resolve(process.cwd(), caseDir);
  mkdirSync(dir, { recursive: true });
  const write = (file: string, value: unknown) =>
    writeFileSync(
      join(dir, file),
      `${JSON.stringify(value, null, 2)}\n`,
      'utf8'
    );

  write(CASE_FILES.workspace, input.workspace);
  write(CASE_FILES.sources, input.sources);
  write(CASE_FILES.report, input.report);
  write(CASE_FILES.priorReports, input.priorReports);
  write(CASE_FILES.summaries, input.summaries);
  write(CASE_FILES.manifest, input.manifest);
  return dir;
}

/** Persist one purpose's Phoenix binding, leaving case content untouched. */
export function writePhoenixBinding(
  evalCase: EvalCase,
  purpose: CasePhoenixPurpose,
  binding: CasePhoenixBinding
): void {
  const manifest: CaseManifest = {
    ...evalCase.manifest,
    phoenix: { ...evalCase.manifest.phoenix, [purpose]: binding },
  };
  writeFileSync(
    join(evalCase.dir, CASE_FILES.manifest),
    `${JSON.stringify(manifest, null, 2)}\n`,
    'utf8'
  );
  evalCase.manifest = manifest;
}

/** Sources an analyst has not labelled as junk — what the prompt is built from. */
export function usableSources(evalCase: EvalCase): CaseSource[] {
  return evalCase.sources.filter((source) => source.relevanceLabel !== 'junk');
}

/**
 * Stable per-case example id, so re-pushing a changed case updates the same
 * example (producing a new dataset version) instead of appending a duplicate.
 */
export function exampleId(evalCase: EvalCase): string {
  return `case-${evalCase.manifest.name}`;
}

/** The Phoenix split holding a case's fixed sample of sources. */
export const SAMPLE_SPLIT = 'sample';

export const DEFAULT_SAMPLE_SIZE = 10;

/**
 * Byte order, not alphabetical order.
 *
 * Sample membership is written into case.json and committed, so it has to
 * resolve identically on every machine and in CI. localeCompare is the usual
 * advice for sorting strings, but it is locale-sensitive by definition and can
 * shift with the ICU data a given Node build ships -- which would silently
 * change which sources are in the sample. These ids are opaque tokens no
 * human reads, so deterministic ordering is the only property worth having.
 */
const byCodeUnit = (a: string, b: string): number => {
  if (a < b) return -1;
  return a > b ? 1 : 0;
};

/**
 * A deterministic subset of source ids: sorted, then the first n. Stable
 * across exports as long as the case's sources do not change.
 */
export function pickSampleSourceIds(
  sourceIds: string[],
  size: number
): string[] {
  return [...sourceIds].sort(byCodeUnit).slice(0, Math.max(0, size));
}

/** Stable per-source example id for the summary dataset. */
export function summaryExampleId(sourceRecordId: string): string {
  return `source-${sourceRecordId}`;
}

/** Key/value ordering must be stable, or the hash changes for identical content. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalize(record[key]);
        return acc;
      }, {});
  }
  return value;
}

export function contentHash(payload: unknown): string {
  return `sha256:${createHash('sha256')
    .update(JSON.stringify(canonicalize(payload)))
    .digest('hex')
    .slice(0, 32)}`;
}
