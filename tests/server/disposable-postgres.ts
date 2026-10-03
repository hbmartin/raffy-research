import { execFile } from 'node:child_process';
import { access, mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';

const execute = promisify(execFile);

/** A private cluster supports actual concurrent transactions; no developer data is used. */
export async function disposablePostgres(
  migrationSql: string,
  options?: { port?: number; username?: string; database?: string }
) {
  let binaries: string | undefined;
  for (const candidate of [
    process.env.TEST_POSTGRES_BIN,
    '/opt/homebrew/opt/postgresql@18/bin',
    '/opt/homebrew/opt/postgresql@17/bin',
    '/usr/lib/postgresql/17/bin',
    '/usr/lib/postgresql/16/bin',
  ]) {
    if (!candidate) continue;
    try {
      await access(path.join(candidate, 'initdb'));
      binaries = candidate;
      break;
    } catch {
      /* optional native runtime */
    }
  }
  if (!binaries) return undefined;
  const root = await mkdtemp(path.join(tmpdir(), 'raffy-postgres-test-'));
  const data = path.join(root, 'data');
  const port =
    options?.port ??
    (await new Promise<number>((resolve, reject) => {
      const server = createServer();
      server.on('error', reject);
      server.listen(0, '127.0.0.1', () => {
        const address = server.address();
        if (!address || typeof address === 'string')
          return reject(new Error('Missing test port'));
        server.close(() => resolve(address.port));
      });
    }));
  let started = false;
  const close = async () => {
    if (started)
      await execute(path.join(binaries!, 'pg_ctl'), [
        '-D',
        data,
        '-m',
        'immediate',
        '-w',
        'stop',
      ]);
    await rm(root, { recursive: true, force: true });
  };
  try {
    await execute(path.join(binaries, 'initdb'), [
      '-D',
      data,
      '--auth=trust',
      `--username=${options?.username ?? 'fixture'}`,
      '--encoding=UTF8',
      '--locale=C',
    ]);
    await execute(path.join(binaries, 'pg_ctl'), [
      '-D',
      data,
      '-l',
      path.join(root, 'server.log'),
      '-o',
      `-h 127.0.0.1 -p ${port} -k ${root} -c timezone=America/Los_Angeles`,
      '-w',
      'start',
    ]);
    started = true;
    const user = encodeURIComponent(options?.username ?? 'fixture');
    const url = `postgresql://${user}@127.0.0.1:${port}/postgres`;
    const pool = new Pool({ connectionString: url });
    try {
      await pool.query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
      if (migrationSql) await pool.query(migrationSql);
      if (options?.database && options.database !== 'postgres')
        await pool.query(
          `create database "${options.database.replaceAll('"', '""')}"`
        );
    } finally {
      await pool.end();
    }
    return {
      url: `postgresql://${user}@127.0.0.1:${port}/${encodeURIComponent(options?.database ?? 'postgres')}`,
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
}
