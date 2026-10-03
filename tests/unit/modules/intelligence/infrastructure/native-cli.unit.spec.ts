import { access, chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { generateNativeCliText } from '@/modules/intelligence/infrastructure/local-ai/native-cli';

const required =
  '--ignore-user-config --ignore-rules --ephemeral --strict-config --output-last-message --disable --tools --safe-mode --restricted --strict-mcp-config --setting-sources --no-session-persistence --permission-prompts';
const roots: string[] = [];
async function fixture(body: string) {
  const root = await mkdtemp(path.join(tmpdir(), 'raffy-cli-fixture-'));
  roots.push(root);
  const executable = path.join(root, 'model');
  await writeFile(executable, `#!${process.execPath}\n${body}`);
  await chmod(executable, 0o700);
  return executable;
}
afterEach(async () => {
  vi.unstubAllEnvs();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))
  );
});
describe('Native subscription CLI text adapter', () => {
  it.each(['codex-cli', 'claude-code'] as const)(
    'isolates %s inputs and preserves native authentication without copying tokens',
    async (provider) => {
      vi.stubEnv('DATABASE_URL', 'application-database-canary');
      vi.stubEnv('OPENAI_API_KEY', 'application-key-canary');
      vi.stubEnv('NODE_OPTIONS', '--trace-warnings');
      const executable = await fixture(`
      const fs = require('node:fs'), path = require('node:path');
      const args = process.argv.slice(2);
      if (args.includes('--help')) { process.stdout.write(${JSON.stringify(required)}); process.exit(0); }
      let prompt = ''; process.stdin.on('data', data => prompt += data);
      process.stdin.on('end', () => {
        const report = JSON.stringify({ args, cwd: process.cwd(), env: process.env, prompt, canary: fs.existsSync(path.join(process.cwd(), 'repository-canary.txt')) });
        const index = args.indexOf('--output-last-message');
        if (index >= 0) { fs.writeFileSync(args[index + 1], report); process.stdout.write(JSON.stringify({type:'item.completed',item:{type:'agent_message'}})); }
        else process.stdout.write(JSON.stringify({ type: 'result', is_error: false, result: report }));
      });`);
      const report = JSON.parse(
        await generateNativeCliText({
          provider,
          model: 'custom-name',
          prompt: 'Untrusted text: $(touch canary)',
          executable,
        })
      ) as {
        args: string[];
        cwd: string;
        env: NodeJS.ProcessEnv;
        prompt: string;
        canary: boolean;
      };
      expect(report.cwd).not.toBe(process.cwd());
      expect(report.canary).toBe(false);
      expect(report.env.HOME).toBe(process.env.HOME);
      expect(report.env.DATABASE_URL).toBeUndefined();
      expect(report.env.OPENAI_API_KEY).toBeUndefined();
      expect(report.env.NODE_OPTIONS).toBeUndefined();
      expect(report.prompt).toBe('Untrusted text: $(touch canary)');
      expect(report.args).toContain('custom-name');
      if (provider === 'codex-cli')
        expect(report.args).toEqual(
          expect.arrayContaining([
            '--ignore-rules',
            '--ephemeral',
            '--sandbox',
            'read-only',
            'mcp_servers={}',
            'shell_tool',
            'apps',
            'plugins',
            'hooks',
            'memories',
            'agents.enabled=false',
          ])
        );
      else
        expect(report.args).toEqual(
          expect.arrayContaining([
            '--tools',
            '',
            '--strict-mcp-config',
            '--safe-mode',
            '--restricted',
            '--setting-sources',
            '--no-session-persistence',
          ])
        );
      await expect(access(report.cwd)).rejects.toThrow();
    }
  );
  it('rejects a CLI missing required controls before generating text', async () => {
    const executable = await fixture(
      "process.stdout.write('--model --print');"
    );
    await expect(
      generateNativeCliText({
        provider: 'codex-cli',
        model: 'custom',
        prompt: 'text',
        executable,
      })
    ).rejects.toMatchObject({ code: 'LOCAL_AI_UNSUPPORTED_CLI' });
  });
  it('kills an interrupted process and sanitizes native diagnostic failures', async () => {
    const executable = await fixture(
      `if (process.argv.includes('--help')) process.stdout.write(${JSON.stringify(required)}); else setTimeout(() => process.exit(0), 10000);`
    );
    const controller = new AbortController();
    const pending = generateNativeCliText({
      provider: 'claude-code',
      model: 'custom',
      prompt: 'text',
      executable,
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(new Error('Lease lost')), 100);
    await expect(pending).rejects.toThrow('Lease lost');
    const failing = await fixture(
      `if (process.argv.includes('--help')) process.stdout.write(${JSON.stringify(required)}); else { process.stderr.write('native-auth-canary'); process.exit(1); }`
    );
    await expect(
      generateNativeCliText({
        provider: 'claude-code',
        model: 'custom',
        prompt: 'text',
        executable: failing,
      })
    ).rejects.toMatchObject({
      code: 'LOCAL_AI_CLI_FAILED',
      message: 'Native CLI exited with status 1',
    });
  });
});
