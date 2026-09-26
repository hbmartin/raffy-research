import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { runGit } from './lib/git-utils.mjs';

export const CLI_DEPLOY_MESSAGE =
  'This Vercel build has no git checkout, so it was uploaded with `vercel deploy`. ' +
  "raffy-research deploys only through Vercel's GitHub integration: push a branch " +
  'for a preview, merge to main for production. See AGENTS.md → Deployment.';

// Vercel's GitHub integration builds from a clone. The Vercel CLI uploads the
// working directory without `.git` (and with any local `.env`, build output, and
// uncommitted edits), so a Vercel build without a checkout is a CLI deploy.
export function assertGitDeploySource({ isVercel, commitSha }) {
  if (!isVercel) {
    return null;
  }

  if (!commitSha) {
    throw new Error(CLI_DEPLOY_MESSAGE);
  }

  return commitSha;
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const commitSha = assertGitDeploySource({
    isVercel: process.env.VERCEL === '1',
    commitSha: runGit(['rev-parse', 'HEAD']),
  });

  if (commitSha) {
    console.log(`Deploy source: git checkout ${commitSha}`);
  }
}
