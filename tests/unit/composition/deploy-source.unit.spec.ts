import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  assertGitDeploySource,
  CLI_DEPLOY_MESSAGE,
} from '../../../scripts/check-deploy-source.mjs';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('assertGitDeploySource', () => {
  it('skips builds outside Vercel', () => {
    expect(
      assertGitDeploySource({ isVercel: false, commitSha: null })
    ).toBeNull();
  });

  it('accepts Vercel builds from a git checkout', () => {
    expect(assertGitDeploySource({ isVercel: true, commitSha: 'abc123' })).toBe(
      'abc123'
    );
  });

  it('rejects Vercel builds uploaded without a git checkout', () => {
    expect(() =>
      assertGitDeploySource({ isVercel: true, commitSha: null })
    ).toThrow(CLI_DEPLOY_MESSAGE);
  });

  it('fails the build script in an uploaded tree without .git', () => {
    const upload = mkdtempSync(join(tmpdir(), 'raffy-deploy-source-'));
    directories.push(upload);
    for (const file of [
      'scripts/check-deploy-source.mjs',
      'scripts/lib/git-utils.mjs',
    ]) {
      mkdirSync(dirname(join(upload, file)), { recursive: true });
      copyFileSync(resolve(file), join(upload, file));
    }

    const result = spawnSync(
      process.execPath,
      ['scripts/check-deploy-source.mjs'],
      {
        cwd: upload,
        encoding: 'utf8',
        env: { ...process.env, VERCEL: '1', GIT_CEILING_DIRECTORIES: tmpdir() },
      }
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('vercel deploy');
  });
});
