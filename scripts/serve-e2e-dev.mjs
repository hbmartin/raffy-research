import { spawnSync } from 'node:child_process';
import { createServer } from 'vite';

process.env.VITE_ENV_NAME = 'tests';

for (const command of ['e2e:db:init', 'env', 'gen:build-info']) {
  const result = spawnSync('pnpm', ['run', command], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

const server = await createServer();
await server.listen();
server.printUrls();

let closing = false;
const close = () => {
  if (closing) return;
  closing = true;
  void server.close().finally(() => process.exit(0));
};

process.once('SIGINT', close);
process.once('SIGTERM', close);
