import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'vite';

process.env.VITE_ENV_NAME = 'tests';
process.env.AUTH_SECRET = randomBytes(32).toString('hex');

const children = new Set();
let server;
let closing = false;
const close = async () => {
  if (closing) return;
  closing = true;
  for (const child of children) child.kill('SIGTERM');
  if (server) await server.close();
  process.exit(0);
};

process.once('SIGINT', close);
process.once('SIGTERM', close);

const runSetup = (command) =>
  new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['run', command], {
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
    children.add(child);
    child.once('error', reject);
    child.once('exit', (code) => {
      children.delete(child);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with status ${code}`));
    });
  });

try {
  await Promise.all([
    runSetup('e2e:db:init'),
    runSetup('env'),
    runSetup('gen:build-info'),
  ]);
} catch (error) {
  for (const child of children) child.kill('SIGTERM');
  throw error;
}

server = await createServer();
await server.listen();
server.printUrls();
