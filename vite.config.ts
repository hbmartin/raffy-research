import babel from '@rolldown/plugin-babel';
import { sentryTanstackStart } from '@sentry/tanstackstart-react/vite';
import { devtools } from '@tanstack/devtools-vite';
import { tanstackStart } from '@tanstack/react-start/plugin/vite';
import viteReact, { reactCompilerPreset } from '@vitejs/plugin-react';
import { nitro } from 'nitro/vite';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { defineConfig, loadEnv, type Plugin } from 'vite';

function srcJsonImportPlugin(): Plugin {
  return {
    name: 'start-ui:src-json-import',
    apply: 'serve',
    configureServer(server) {
      const srcDir = path.resolve(server.config.root, 'src');

      server.middlewares.use(async (req, res, next) => {
        if (!req.url) {
          next();
          return;
        }

        const url = new URL(req.url, 'http://localhost');
        const isSrcJsonImport =
          url.pathname.startsWith('/src/') &&
          url.pathname.endsWith('.json') &&
          url.searchParams.has('import');

        if (!isSrcJsonImport) {
          next();
          return;
        }

        let decodedPathname: string;

        try {
          decodedPathname = decodeURIComponent(url.pathname);
        } catch {
          next();
          return;
        }

        const filePath = path.resolve(
          server.config.root,
          `.${decodedPathname}`
        );

        if (!filePath.startsWith(`${srcDir}${path.sep}`)) {
          next();
          return;
        }

        try {
          const source = await readFile(filePath, 'utf8');
          res.setHeader('Content-Type', 'text/javascript');
          res.setHeader('Cache-Control', 'no-cache');
          res.end(
            `const data = JSON.parse(${JSON.stringify(source)});\nexport default data;\n`
          );
        } catch {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  const envDirectory = process.env.SSR_FIXTURE_ENV_DIR ?? process.cwd();
  const env = loadEnv(mode, envDirectory, 'VITE_');
  const privateEnv = loadEnv(mode, envDirectory, '');
  const envName = env.VITE_ENV_NAME?.toLowerCase();
  const isTestRuntime = envName === 'test' || envName === 'tests';
  const canUpload = Boolean(
    privateEnv.SENTRY_ORG &&
    privateEnv.SENTRY_PROJECT &&
    privateEnv.SENTRY_AUTH_TOKEN
  );
  const sentryPlugins =
    env.VITE_SENTRY_DSN && canUpload
      ? sentryTanstackStart({
          org: privateEnv.SENTRY_ORG || undefined,
          project: privateEnv.SENTRY_PROJECT || undefined,
          authToken: privateEnv.SENTRY_AUTH_TOKEN || undefined,
          telemetry: false,
          autoInstrumentMiddleware: false,
          sourcemaps: { disable: !canUpload },
          release: { create: canUpload, finalize: canUpload },
        })
      : [];

  return {
    envDir: envDirectory,
    build: {
      target: 'baseline-widely-available',
    },
    server: {
      port: env.VITE_PORT ? Number(env.VITE_PORT) : 3000,
      strictPort: true,
    },
    resolve: {
      tsconfigPaths: true,
    },
    // The core client entry needs Start's isomorphic/server-function transforms
    // in development; prebundling it would retain server-only Node imports.
    optimizeDeps: { exclude: ['@tanstack/start-client-core'] },
    plugins: [
      ...(isTestRuntime ? [] : devtools()),
      srcJsonImportPlugin(),
      tanstackStart(),
      nitro({ plugins: ['./src/composition/telemetry/bootstrap.ts'] }),
      // react's vite plugin must come after start's vite plugin
      viteReact(),
      babel({ presets: [reactCompilerPreset()] }),
      ...sentryPlugins,
    ],
  };
});
