import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { expect, it } from 'vitest';

it.each(['normal', 'repeated', 'failure', 'stuck', 'signal-failure'])(
  'cleans up managed children and ports: %s',
  async (mode) => {
    const child = spawn(
      process.execPath,
      ['tests/support/fixtures/supervisor.mjs', mode],
      { stdio: ['ignore', 'pipe', 'pipe'] }
    );
    const exited = once(child, 'exit');
    let output = '';
    child.stdout.on('data', (chunk) => {
      output += chunk;
    });
    child.stderr.on('data', (chunk) => {
      output += chunk;
    });
    try {
      await expect
        .poll(() => output, { timeout: 3_000 })
        .toMatch(/CHILD:\d+:\d+/);
      const started = Date.now();
      if (mode !== 'failure') child.kill('SIGTERM');
      if (mode === 'repeated') {
        child.kill('SIGINT');
        child.kill('SIGTERM');
      }
      const [code, signal] = await exited;
      expect({ code, signal, output }).toMatchObject({
        code: mode === 'failure' ? 1 : mode === 'signal-failure' ? 143 : 0,
        signal: null,
      });
      expect(output.match(/CLEANED/g)).toHaveLength(1);
      expect(Date.now() - started).toBeLessThan(10_000);
      const [, ownedPid, ownedPort] = output.match(/CHILD:(\d+):(\d+)/)!;
      expect(() => process.kill(Number(ownedPid), 0)).toThrow();
      const supervisorPort = output.match(/PORT:(\d+)/)![1];
      for (const port of [ownedPort, supervisorPort]) {
        const probe = createServer();
        await new Promise<void>((resolve, reject) => {
          probe.once('error', reject);
          probe.listen(Number(port), '127.0.0.1', resolve);
        });
        await new Promise<void>((resolve, reject) =>
          probe.close((error) => (error ? reject(error) : resolve()))
        );
      }
    } finally {
      child.kill('SIGKILL');
    }
  },
  15_000
);
