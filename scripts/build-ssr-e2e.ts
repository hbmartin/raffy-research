import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { createFixtureSupervisor } from './fixture-supervisor.mjs';
import {
  createFixtureEnvironment,
  invalidateFixtureManifest,
  writeFixtureManifest,
} from './ssr-fixture-env';

const env = await createFixtureEnvironment();
await invalidateFixtureManifest();
const require = createRequire(import.meta.url);
const vite = resolve(
  dirname(require.resolve('vite/package.json')),
  'bin/vite.js'
);
const supervisor = createFixtureSupervisor({ failOnSignal: true });
const timer = setTimeout(() => {
  console.error('SSR production build exceeded ten minutes');
  process.exitCode = 1;
  process.emit('SIGTERM');
}, 600_000);
await supervisor.run(
  async () => {
    await supervisor.runNode(
      ['./run-jiti', './src/platform/env/client.ts'],
      env
    );
    await supervisor.runNode(
      [
        './run-jiti',
        './src/modules/kernel/infrastructure/config/server.ts',
        '--build',
      ],
      env
    );
    await supervisor.runNode(
      [
        './run-jiti',
        './src/app/build-info/infrastructure/generate-build-info.ts',
      ],
      env
    );
    await supervisor.runNode([vite, 'build'], env);
    await writeFixtureManifest(env);
  },
  async () => {
    clearTimeout(timer);
    if (process.exitCode) await invalidateFixtureManifest();
  }
);
