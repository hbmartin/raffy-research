import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

const gitWorktree = spawnSync('git', ['rev-parse', '--is-inside-work-tree'], {
  stdio: 'ignore',
});

if (gitWorktree.status !== 0) {
  console.log('Skipping Git hook installation: no Git worktree detected.');
  process.exit(0);
}

const lefthook = spawnSync(
  process.execPath,
  [require.resolve('lefthook'), 'install'],
  {
    stdio: 'inherit',
  }
);

if (lefthook.error) {
  throw lefthook.error;
}

process.exit(lefthook.status ?? 1);
