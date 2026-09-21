import { execFileSync, spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { loadEnv } from 'vite';
import { afterEach, describe, expect, it, vi } from 'vitest';

import mainConfig from '../../../playwright.config';
import ssrConfig from '../../../playwright.ssr.config';
import { assertSsrCompatibility } from '../../../scripts/check-ssr-compatibility.mjs';
import {
  digestBuiltOutput,
  fixtureEnvironment,
} from '../../../scripts/ssr-fixture-env';

const require = createRequire(import.meta.url);
const directories: string[] = [];
const temporary = () => {
  const path = mkdtempSync(join(tmpdir(), 'raffy-ssr-tooling-'));
  directories.push(path);
  return path;
};
const writeSsrBuild = (path: string) => {
  mkdirSync(join(path, '.output/server/_ssr'), { recursive: true });
  mkdirSync(join(path, '.output/public'), { recursive: true });
  writeFileSync(
    join(path, '.output/nitro.json'),
    '{"preset":"node-server","serverEntry":"server/index.mjs","publicDir":"public"}'
  );
  writeFileSync(join(path, '.output/server/index.mjs'), 'server entry');
  writeFileSync(join(path, '.output/server/_ssr/ssr.mjs'), 'ssr entry');
  writeFileSync(
    join(path, '.output/server/_tanstack-start-manifest_fixture.mjs'),
    'export default {}'
  );
};
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  for (const path of directories.splice(0))
    rmSync(path, { recursive: true, force: true });
});

describe('SSR tooling guardrails', () => {
  it('does not treat Vite serve as a production build under production NODE_ENV', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const { default: viteConfig } = await import('../../../vite.config');
    const config = viteConfig({
      command: 'serve',
      mode: 'production',
      isPreview: false,
      isSsrBuild: false,
    });
    expect(config.define?.['import.meta.env.RAFFY_PRODUCTION_BUILD']).toBe(
      'false'
    );
    const { isValidatedSsrFixtureRuntime } =
      await import('@/modules/kernel/infrastructure/config/auth');
    expect(() =>
      isValidatedSsrFixtureRuntime(false, {
        AUTH_SECRET: 'a'.repeat(32),
        HOST: '127.0.0.1',
        NODE_ENV: 'production',
        SSR_FIXTURE_MODE: 'true',
        VITE_BASE_URL: 'http://127.0.0.1:3011',
      })
    ).toThrow('production build');
  });

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
    const {
      createFixtureEnvironment,
      readFixtureEnvironment,
      writeFixtureManifest,
    } = await import('../../../scripts/ssr-fixture-env');
    const buildEnv = await createFixtureEnvironment();
    writeSsrBuild(path);
    await writeFixtureManifest(buildEnv);
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
    mkdirSync(join(path, 'test-results'), { recursive: true });
    rmSync(join(path, 'test-results'), { recursive: true });
    expect(await readFixtureEnvironment()).toEqual(buildEnv);
    writeFileSync(join(path, '.output/server/index.mjs'), 'different build');
    await expect(readFixtureEnvironment()).rejects.toThrow(
      'Invalid SSR fixture manifest'
    );
  });

  it('returns an actionable error for missing or partial build output', async () => {
    const path = temporary();
    vi.spyOn(process, 'cwd').mockReturnValue(path);
    vi.resetModules();
    const { digestBuiltOutput: digest } =
      await import('../../../scripts/ssr-fixture-env');

    await expect(digest()).rejects.toThrow('run pnpm build:e2e:ssr first');
    mkdirSync(join(path, '.output/server'), { recursive: true });
    mkdirSync(join(path, '.output/public'), { recursive: true });
    writeFileSync(join(path, '.output/nitro.json'), '{');
    await expect(digest()).rejects.toThrow('run pnpm build:e2e:ssr first');
    writeFileSync(
      join(path, '.output/nitro.json'),
      '{"serverEntry":"server/index.mjs","publicDir":"public"}'
    );
    await expect(digest()).rejects.toThrow('Missing SSR runtime entry');
    writeFileSync(join(path, '.output/server/index.mjs'), 'server entry');
    await expect(digest()).resolves.toMatch(/^[a-f0-9]{64}$/);
    rmSync(join(path, '.output/public'), { recursive: true });
    await expect(digest()).rejects.toThrow('run pnpm build:e2e:ssr first');
  });

  it('requires the Nitro entry symlink to resolve to a file', async () => {
    const path = temporary();
    vi.spyOn(process, 'cwd').mockReturnValue(path);
    writeSsrBuild(path);
    rmSync(join(path, '.output/server/index.mjs'));
    symlinkSync('missing.mjs', join(path, '.output/server/index.mjs'));
    await expect(digestBuiltOutput()).rejects.toThrow(
      'Missing SSR runtime entry'
    );
    writeFileSync(join(path, '.output/server/target.mjs'), 'entry');
    rmSync(join(path, '.output/server/index.mjs'));
    symlinkSync('target.mjs', join(path, '.output/server/index.mjs'));
    await expect(digestBuiltOutput()).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  it('frames paths and per-file content digests without NUL ambiguity', async () => {
    const first = temporary();
    const second = temporary();
    writeSsrBuild(first);
    writeSsrBuild(second);
    writeFileSync(join(first, '.output/a'), 'x\0b\0file\0y');
    writeFileSync(join(second, '.output/a'), 'x');
    writeFileSync(join(second, '.output/b'), 'y');
    const cwd = vi.spyOn(process, 'cwd');
    cwd.mockReturnValue(first);
    const firstDigest = await digestBuiltOutput();
    cwd.mockReturnValue(second);
    expect(await digestBuiltOutput()).not.toBe(firstDigest);
  });

  it('hashes all deployable output, including dependency trees and symlink targets', async () => {
    const path = temporary();
    vi.spyOn(process, 'cwd').mockReturnValue(path);
    writeSsrBuild(path);
    const initial = await digestBuiltOutput();

    mkdirSync(join(path, '.output/server/node_modules/example'), {
      recursive: true,
    });
    writeFileSync(
      join(path, '.output/server/node_modules/example/index.js'),
      'dependency v1'
    );
    const withDependency = await digestBuiltOutput();
    expect(withDependency).not.toBe(initial);

    writeFileSync(
      join(path, '.output/server/node_modules/example/index.js'),
      'dependency v2'
    );
    expect(await digestBuiltOutput()).not.toBe(withDependency);

    symlinkSync('example', join(path, '.output/server/node_modules/alias'));
    const withSymlink = await digestBuiltOutput();
    rmSync(join(path, '.output/server/node_modules/alias'));
    symlinkSync('different', join(path, '.output/server/node_modules/alias'));
    expect(await digestBuiltOutput()).not.toBe(withSymlink);

    writeFileSync(join(path, '.output/server/_ssr/route.mjs'), 'route v1');
    expect(await digestBuiltOutput()).not.toBe(initial);
    rmSync(join(path, '.output/server/_ssr/route.mjs'));

    writeFileSync(
      join(path, '.output/server/index.mjs'),
      'changed server entry'
    );
    expect(await digestBuiltOutput()).not.toBe(initial);
    writeFileSync(join(path, '.output/server/index.mjs'), 'server entry');
    writeFileSync(
      join(path, '.output/server/_tanstack-start-manifest_fixture.mjs'),
      'export default { changed: true }'
    );
    expect(await digestBuiltOutput()).not.toBe(initial);
  });

  it('accepts a build without optional Nitro internal filenames', async () => {
    const path = temporary();
    vi.spyOn(process, 'cwd').mockReturnValue(path);
    mkdirSync(join(path, '.output/server'), { recursive: true });
    mkdirSync(join(path, '.output/public'), { recursive: true });
    writeFileSync(
      join(path, '.output/nitro.json'),
      '{"serverEntry":"server/index.mjs","publicDir":"public"}'
    );
    writeFileSync(join(path, '.output/server/index.mjs'), 'server entry');

    await expect(digestBuiltOutput()).resolves.toMatch(/^[a-f0-9]{64}$/);
  });

  it('maps missing and malformed fixture manifests to an actionable error', async () => {
    const path = temporary();
    vi.spyOn(process, 'cwd').mockReturnValue(path);
    vi.resetModules();
    const { readFixtureEnvironment } =
      await import('../../../scripts/ssr-fixture-env');

    await expect(readFixtureEnvironment()).rejects.toMatchObject({
      message: 'Invalid SSR fixture manifest; run pnpm build:e2e:ssr first.',
      cause: { code: 'ENOENT' },
    });
    mkdirSync(join(path, '.ssr-fixture'), { recursive: true });
    writeFileSync(join(path, '.ssr-fixture/environment.json'), '{');
    await expect(readFixtureEnvironment()).rejects.toMatchObject({
      message: 'Invalid SSR fixture manifest; run pnpm build:e2e:ssr first.',
      cause: expect.any(SyntaxError),
    });
  });

  it('retains unexpected manifest I/O errors', async () => {
    const path = temporary();
    vi.spyOn(process, 'cwd').mockReturnValue(path);
    vi.resetModules();
    const { readFixtureEnvironment } =
      await import('../../../scripts/ssr-fixture-env');
    mkdirSync(join(path, '.ssr-fixture/environment.json'), {
      recursive: true,
    });

    await expect(readFixtureEnvironment()).rejects.toMatchObject({
      code: 'EISDIR',
    });
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
      rootCore: { version: '1.2.4' },
      reactQuery: { dependencies: { '@tanstack/query-core': '5.2.1' } },
      queryCore: { version: '5.2.1' },
      rootQueryCore: { version: '5.2.1' },
      packageJson: {
        dependencies: {
          '@tanstack/router-core': '1.2.4',
          '@tanstack/query-core': '5.2.1',
        },
      },
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
    expect(() =>
      assertSsrCompatibility({ ...input, rootCore: { version: '1.2.5' } })
    ).toThrow('exact versions');
    expect(() =>
      assertSsrCompatibility({ ...input, rootQueryCore: { version: '5.2.2' } })
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
