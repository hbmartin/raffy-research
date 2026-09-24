/* oxlint-disable no-process-env */
import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { type ChildProcess, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:http';

import {
  readFixtureEnvironment,
  SSR_COLLECTOR_PORT,
  SSR_DATABASE_PORT,
} from './ssr-fixture-env';

const env = await readFixtureEnvironment();

const database = new PGlite('memory://', { extensions: { pgcrypto } });
const socket = new PGLiteSocketServer({
  db: database,
  host: '127.0.0.1',
  port: SSR_DATABASE_PORT,
  maxConnections: 16,
});
const collector = createServer((request, response) => {
  request.resume();
  const expected =
    request.url === '/v1/traces'
      ? 'trace-fixture'
      : request.url === '/v1/metrics'
        ? 'metric-fixture'
        : undefined;
  response.writeHead(
    expected && request.headers['x-fixture-auth'] !== expected ? 401 : 200,
    { 'Content-Type': 'application/x-protobuf' }
  );
  response.end();
});
let child: ChildProcess | undefined;
let stopping = false;
let stopped: Promise<void> | undefined;

const stop = () => {
  if (stopped) return stopped;
  stopping = true;
  stopped = (async () => {
    if (child && child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill('SIGTERM');
      const forceStop = setTimeout(() => child?.kill('SIGKILL'), 5_000);
      try {
        await closed;
      } finally {
        clearTimeout(forceStop);
      }
    }
    collector.closeAllConnections();
    collector.close();
    await socket.stop();
    await database.close();
  })();
  return stopped;
};

process.once('SIGTERM', () => {
  void stop();
});
process.once('SIGINT', () => {
  void stop();
});

try {
  await database.waitReady;
  await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await socket.start();
  collector.listen(SSR_COLLECTOR_PORT, '127.0.0.1');
  await once(collector, 'listening');
  for (const command of ['e2e:ssr:db:init', 'start']) {
    if (stopping) break;
    // Launch the built server directly so shutdown targets the process that
    // owns database connections, rather than an intermediate package runner.
    child =
      command === 'start'
        ? spawn(process.execPath, ['.output/server/index.mjs'], {
            env,
            stdio: 'inherit',
          })
        : spawn('pnpm', [command], {
            env,
            stdio: 'inherit',
            shell: process.platform === 'win32',
          });
    const [code] = await once(child, 'exit');
    if (code !== 0 && !stopping)
      throw new Error(`pnpm ${command} failed with exit code ${code}`);
  }
} finally {
  await stop();
}
