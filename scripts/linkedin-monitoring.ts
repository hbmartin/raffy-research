import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  LINKEDIN_MONITORING_USAGE,
  parseLinkedinMonitoringArgs,
  runLinkedinMonitoringCli,
} from '@/app/linkedin-monitoring/cli';
import { composeLinkedinMonitoring } from '@/composition/linkedin-monitoring';
import { createDbClient } from '@/modules/kernel/infrastructure/db/client';

async function main() {
  const args = parseLinkedinMonitoringArgs(process.argv.slice(2));
  if (args.type === 'help') {
    console.log(
      JSON.stringify(
        {
          schemaVersion: 1,
          usage: LINKEDIN_MONITORING_USAGE,
          exitCodes: {
            success: 0,
            infrastructureFailure: 1,
            inputOrReviewRequired: 2,
          },
        },
        null,
        2
      )
    );
    return;
  }
  if (args.type !== 'arguments_valid') {
    console.log(
      JSON.stringify({
        schemaVersion: 1,
        error: { code: 'INVALID_ARGUMENTS', message: args.message },
      })
    );
    process.exitCode = 2;
    return;
  }
  const db = createDbClient();
  try {
    const response = await runLinkedinMonitoringCli(
      args,
      composeLinkedinMonitoring(db),
      {
        readInput: async (file) =>
          JSON.parse(await readFile(path.resolve(file), 'utf8')) as unknown,
        createAudit: async () => {
          const directory = path.resolve(
            'test-results/task-verification',
            new Date().toISOString().replaceAll(':', '-'),
            'linkedin-monitoring'
          );
          await mkdir(directory, { recursive: true });
          const auditPath = path.join(directory, `${args.command}.json`);
          // Reserve a writable artifact before an operation can commit changes.
          await writeFile(
            auditPath,
            JSON.stringify({
              schemaVersion: 1,
              command: args.command,
              workspaceId: args.workspaceId,
              status: 'started',
            }),
            { flag: 'wx', mode: 0o600 }
          );
          return {
            path: auditPath,
            write: (value) =>
              writeFile(auditPath, JSON.stringify(value, null, 2), {
                mode: 0o600,
              }),
          };
        },
      }
    );
    console.log(JSON.stringify(response.summary, null, 2));
    process.exitCode = response.exitCode;
  } finally {
    await db.$close();
  }
}

void main().catch(() => {
  // Boundary exceptions can include URLs/credentials; never serialize them.
  console.log(
    JSON.stringify({
      schemaVersion: 1,
      error: {
        code: 'CLI_IO_OR_CONFIGURATION_ERROR',
        message:
          'Unable to load arguments, input, database configuration, or audit artifact. Check the input file and operator environment. If an add/sync was attempted, run context and verify before retrying sync.',
      },
    })
  );
  process.exitCode = 1;
});
