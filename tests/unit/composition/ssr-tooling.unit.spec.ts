import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadEnv } from 'vite';

import mainConfig from '../../../playwright.config';
import ssrConfig from '../../../playwright.ssr.config';
import { fixtureEnvironment } from '../../../scripts/ssr-fixture-env';
import { assertSsrCompatibility } from '../../../scripts/check-ssr-compatibility.mjs';

const require = createRequire(import.meta.url);
const directories: string[] = [];
const temporary = () => {
  const path = mkdtempSync(join(tmpdir(), 'raffy-ssr-tooling-'));
  directories.push(path);
  return path;
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe('SSR tooling guardrails', () => {
  it('only removes the dedicated SSR basename from the normal suite', () => {
    const ignores = [mainConfig.testIgnore].flat() as RegExp[];
    expect(
      ignores.some((pattern) => pattern.test('/tests/e2e/ssr.spec.ts'))
    ).toBe(true);
    expect(
      ignores.some((pattern) => pattern.test('/tests/e2e/auth-ssr.spec.ts'))
    ).toBe(false);
    expect(
      (ssrConfig.testMatch as RegExp).test('/tests/e2e/auth-ssr.spec.ts')
    ).toBe(false);
    expect((ssrConfig.testMatch as RegExp).test('/tests/e2e/ssr.spec.ts')).toBe(
      true
    );
  });

  it('rejects a focused SSR test under CI before launching browsers', async () => {
    vi.stubEnv('CI', 'true');
    vi.resetModules();
    const { default: config } = await import('../../../playwright.ssr.config');
    const path = temporary();
    const playwright = require.resolve('@playwright/test');
    writeFileSync(
      join(path, 'ssr.spec.ts'),
      `const {test} = require(${JSON.stringify(playwright)}); test.only('focused', () => {});`
    );
    writeFileSync(
      join(path, 'playwright.config.cjs'),
      `module.exports = {testDir: ${JSON.stringify(path)}, outputDir: ${JSON.stringify(join(path, 'results'))}, forbidOnly: ${JSON.stringify(config.forbidOnly)}, reporter: 'line'};`
    );
    const result = spawnSync(
      process.execPath,
      [
        resolve(require.resolve('playwright/package.json'), '..', 'cli.js'),
        'test',
        '--config',
        join(path, 'playwright.config.cjs'),
      ],
      { cwd: path, encoding: 'utf8', timeout: 15_000 }
    );
    expect(result.status).not.toBe(0);
    expect(result.stdout + result.stderr).toContain('forbidOnly');
  });

  it('does not inherit application credentials or test behavior', () => {
    vi.stubEnv('SENTRY_AUTH_TOKEN', 'host-secret');
    vi.stubEnv('DATABASE_URL', 'postgres://host-database');
    vi.stubEnv('OPENAI_API_KEY', 'host-secret');
    vi.stubEnv('VITE_ENV_NAME', 'tests');
    const env = fixtureEnvironment('fixture-secret');
    expect(env.OPENAI_API_KEY).toBeUndefined();
    expect(env.SENTRY_AUTH_TOKEN).toBe('');
    expect(env.DATABASE_URL).toContain('127.0.0.1');
    expect(env.VITE_ENV_NAME).toBe('');
    expect(env.SSR_FIXTURE_ENV_DIR).toContain('ssr-fixture/env');
  });

  it('uses the same fixture environment despite developer env files', async () => {
    const path = temporary();
    vi.spyOn(process, 'cwd').mockReturnValue(path);
    vi.resetModules();
    const { createFixtureEnvironment, readFixtureEnvironment } =
      await import('../../../scripts/ssr-fixture-env');
    const buildEnv = await createFixtureEnvironment();
    for (const filename of ['.env', '.env.local']) {
      writeFileSync(
        join(path, filename),
        'VITE_ENV_NAME=tests\nAUTH_DEBUG=true\nVITE_BASE_URL=https://developer.invalid\n'
      );
    }
    const runtimeEnv = await readFixtureEnvironment();
    expect(runtimeEnv).toEqual(buildEnv);
    const loaded = loadEnv('production', runtimeEnv.SSR_FIXTURE_ENV_DIR!, '');
    expect(loaded.VITE_BASE_URL).not.toBe('https://developer.invalid');
    expect(loaded.AUTH_DEBUG).not.toBe('true');
  });

  it('rejects a router override and incompatible dependency resolutions', () => {
    const input = {
      workspace: { overrides: {} },
      start: {
        dependencies: {
          '@tanstack/react-router': '1.2.3',
          '@tanstack/start-client-core': '1.2.2',
        },
      },
      startClientCore: { version: '1.2.2' },
      router: {
        version: '1.2.3',
        dependencies: { '@tanstack/router-core': '1.2.4' },
      },
      core: { version: '1.2.4' },
      sentry: { version: '10.55.0' },
      sentryCore: { version: '10.55.0' },
    };
    expect(() => assertSsrCompatibility(input)).not.toThrow();
    expect(() =>
      assertSsrCompatibility({
        ...input,
        workspace: { overrides: { '@tanstack/router-core': '1.2.4' } },
      })
    ).toThrow('override');
    expect(() =>
      assertSsrCompatibility({ ...input, core: { version: '1.2.5' } })
    ).toThrow('exact versions');
    expect(() =>
      assertSsrCompatibility({
        ...input,
        startClientCore: { version: '1.2.5' },
      })
    ).toThrow('exact versions');
  });

  it.skipIf(process.platform === 'win32')(
    'installs hooks without pnpm on PATH and skips a non-worktree',
    () => {
      const path = temporary();
      const bin = join(path, 'bin');
      mkdirSync(bin);
      symlinkSync(
        execFileSync('which', ['git'], { encoding: 'utf8' }).trim(),
        join(bin, 'git')
      );
      execFileSync('git', ['init', '-q', path]);
      const env = { ...process.env, PATH: bin };
      const script = resolve('scripts/install-git-hooks.mjs');
      const installed = spawnSync(process.execPath, [script], {
        cwd: path,
        env,
        encoding: 'utf8',
        timeout: 15_000,
      });
      expect({
        status: installed.status,
        stderr: installed.stderr,
      }).toMatchObject({ status: 0 });
      const outside = temporary();
      const skipped = spawnSync(process.execPath, [script], {
        cwd: outside,
        env,
        encoding: 'utf8',
        timeout: 15_000,
      });
      expect(skipped.status).toBe(0);
      expect(skipped.stdout).toContain('no Git worktree');
    }
  );
});
