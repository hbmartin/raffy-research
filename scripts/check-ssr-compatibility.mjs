import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const require = createRequire(import.meta.url);
const metadata = (name) =>
  JSON.parse(readFileSync(require.resolve(`${name}/package.json`), 'utf8'));

export function assertSsrCompatibility({
  workspace,
  start,
  startClientCore,
  router,
  core,
  rootCore,
  reactQuery,
  queryCore,
  rootQueryCore,
  packageJson,
  sentry,
  sentryCore,
}) {
  if (
    Object.keys(workspace.overrides ?? {}).some((key) =>
      key.includes('@tanstack/router-core')
    )
  ) {
    throw new Error(
      'Remove the router-core override; use the dependency versions required by Start and Router.'
    );
  }
  if (
    start.dependencies['@tanstack/react-router'] !== router.version ||
    start.dependencies['@tanstack/start-client-core'] !==
      startClientCore.version ||
    router.dependencies['@tanstack/router-core'] !== core.version ||
    packageJson.dependencies['@tanstack/router-core'] !== rootCore.version ||
    rootCore.version !== core.version ||
    reactQuery.dependencies['@tanstack/query-core'] !== queryCore.version ||
    packageJson.dependencies['@tanstack/query-core'] !==
      rootQueryCore.version ||
    rootQueryCore.version !== queryCore.version
  ) {
    throw new Error(
      'Start, React Router, and their core packages must resolve to the exact versions declared by their consumers.'
    );
  }
  if (sentry.version !== sentryCore.version)
    throw new Error('Keep Sentry SDK and core on the same release.');
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  assertSsrCompatibility({
    workspace: parse(readFileSync('pnpm-workspace.yaml', 'utf8')),
    start: metadata('@tanstack/react-start'),
    startClientCore: metadata('@tanstack/start-client-core'),
    router: metadata('@tanstack/react-router'),
    core: JSON.parse(
      readFileSync(
        createRequire(
          require.resolve('@tanstack/react-router/package.json')
        ).resolve('@tanstack/router-core/package.json'),
        'utf8'
      )
    ),
    rootCore: metadata('@tanstack/router-core'),
    reactQuery: metadata('@tanstack/react-query'),
    queryCore: JSON.parse(
      readFileSync(
        createRequire(
          require.resolve('@tanstack/react-query/package.json')
        ).resolve('@tanstack/query-core/package.json'),
        'utf8'
      )
    ),
    rootQueryCore: metadata('@tanstack/query-core'),
    packageJson: JSON.parse(readFileSync('package.json', 'utf8')),
    sentry: metadata('@sentry/tanstackstart-react'),
    sentryCore: metadata('@sentry/core'),
  });
  console.log('SSR dependency compatibility passed.');
}
