import { spawn } from 'node:child_process';
import { once } from 'node:events';

import { createFixtureEnvironment } from './ssr-fixture-env';

const env = await createFixtureEnvironment();
const child = spawn('pnpm', ['e2e:ssr:bundle'], {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32',
  timeout: 600_000,
});
const [code] = await once(child, 'exit');
if (code !== 0) throw new Error(`SSR production build failed (exit ${code}).`);
