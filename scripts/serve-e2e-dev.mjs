import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import { PGLiteSocketServer } from '@electric-sql/pglite-socket';
import { randomBytes } from 'node:crypto';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';

import { createFixtureSupervisor } from './fixture-supervisor.mjs';

process.env.VITE_ENV_NAME = 'tests';
process.env.AUTH_SECRET = randomBytes(32).toString('hex');
process.env.NODE_ENV = 'development';
process.env.DATABASE_URL =
  'postgresql://postgres:postgres@127.0.0.1:54329/postgres';
process.env.DATABASE_MIGRATION_URL = process.env.DATABASE_URL;
process.env.DATABASE_DRIVER = 'node-pg';
process.env.DATABASE_MIGRATION_DRIVER = 'node-pg';
const supervisor = createFixtureSupervisor();
const require = createRequire(import.meta.url);
const vite = resolve(
  dirname(require.resolve('vite/package.json')),
  'bin/vite.js'
);
const database = new PGlite('memory://', { extensions: { pgcrypto } });
const socket = new PGLiteSocketServer({
  db: database,
  host: '127.0.0.1',
  port: 54329,
  maxConnections: 16,
});
const run = (path) => supervisor.runNode(['./run-jiti', path]);
await supervisor.run(
  async () => {
    await database.waitReady;
    supervisor.checkpoint();
    await database.exec('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
    supervisor.checkpoint();
    await socket.start();
    await Promise.all([
      (async () => {
        await run('./src/modules/kernel/infrastructure/db/migrate-cli.ts');
        await run('./drizzle/seed/index.ts');
      })(),
      run('./src/platform/env/client.ts'),
      run('./src/modules/kernel/infrastructure/config/server.ts'),
      run('./src/app/build-info/infrastructure/generate-build-info.ts'),
    ]);
    supervisor.checkpoint();
    await supervisor.runNode([vite, '--host', '127.0.0.1']);
  },
  async () => {
    try {
      await socket.stop();
    } finally {
      await database.close();
    }
  }
);
