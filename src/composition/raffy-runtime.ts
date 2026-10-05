import { Result } from '@swan-io/boxed';

import type { MachineIdentity } from '@/modules/auth';
import {
  createMachineCredentials,
  createMachinePermissionChecker,
} from '@/modules/auth/backend';
import { createIntelligenceUseCases } from '@/modules/intelligence';
import {
  createAgentResearch,
  createIngestionRepository,
  createPublicResearchArchive,
  createReportRepository,
  createRubricScoreRepository,
  createScheduledJobRepository,
  createSourceRepository,
  createWorkspaceRepository,
  getLocalAiConfig,
} from '@/modules/intelligence/backend';
import type { Logger } from '@/modules/kernel/application/ports/logger';
import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { Database } from '@/modules/kernel/infrastructure/db/types';
import { cuidIdGenerator } from '@/modules/kernel/infrastructure/id/nanoid';
import { createNewsletterUseCases } from '@/modules/newsletter';
import {
  createContextDiscovery,
  createNewsletterRepository,
} from '@/modules/newsletter/backend';
import { createOperationRepository } from '@/modules/operations/backend';

export function createRaffyRuntime(
  db: Database,
  credential: { id: string; secret: string },
  identity: MachineIdentity
) {
  const logger: Logger = {
    debug: () => {},
    info: (fields) =>
      process.stderr.write(`${JSON.stringify({ event: fields.event })}\n`),
    warn: (fields) =>
      process.stderr.write(`${JSON.stringify({ event: fields.event })}\n`),
    error: (fields) =>
      process.stderr.write(`${JSON.stringify({ event: fields.event })}\n`),
  };
  const clock = { now: () => new Date() },
    idGenerator = cuidIdGenerator;
  const permissionChecker = createMachinePermissionChecker(db, credential);
  const repositories = {
    workspaceRepository: createWorkspaceRepository({ db }),
    sourceRepository: createSourceRepository({ db }),
    reportRepository: createReportRepository({ db }),
    rubricScoreRepository: createRubricScoreRepository({ db }),
    ingestionRepository: createIngestionRepository({ db }),
    scheduledJobRepository: createScheduledJobRepository({ db }),
  };
  const useCases = createIntelligenceUseCases({
    ...repositories,
    permissionChecker,
    clock,
    idGenerator,
    logger,
  });
  const newsletterRepository = createNewsletterRepository(db, (tx, decision) =>
      createAgentResearch(tx).recordJudgment(decision)
    ),
    archive = createPublicResearchArchive(db);
  const newsletter = createNewsletterUseCases({
    provenance: {
      origin: 'assistant',
      channel: 'cli',
      actorId: identity.userId,
      credentialId: identity.credentialId,
    },
    requireDispatchReconciliation: true,
    repository: newsletterRepository,
    archive,
    permissionChecker,
    clock,
    idGenerator,
    localOperatorId: identity.userId,
    operatorContextCeiling: () => getLocalAiConfig().ollamaNumCtx,
    discoverContextBudget: createContextDiscovery({
      ollamaBaseUrl: () => getLocalAiConfig().ollamaBaseUrl,
    }),
  });
  return {
    db,
    credential,
    identity,
    logger,
    clock,
    idGenerator,
    permissionChecker,
    repositories,
    useCases,
    newsletterRepository,
    archive,
    newsletter,
    research: createAgentResearch(db),
    operations: createOperationRepository(db),
    credentials: createMachineCredentials(db),
  };
}
export type RaffyRuntime = ReturnType<typeof createRaffyRuntime>;
export async function checkRaffyAccess(
  runtime: RaffyRuntime,
  capability: 'research' | 'newsletter' | 'pipeline' | 'lab'
): Promise<ApplicationResult<{ type: 'authorized' } | { type: 'forbidden' }>> {
  const auth = await runtime.credentials.authenticate(
    runtime.credential.id,
    runtime.credential.secret
  );
  if (auth.isError()) return Result.Error(auth.getError());
  const value = auth.get();
  if (
    value.type !== 'machine_authenticated' ||
    !value.identity.capabilities.includes(capability) ||
    ((capability === 'pipeline' || capability === 'lab') &&
      value.identity.role !== 'admin')
  )
    return Result.Ok({ type: 'forbidden' });
  return Result.Ok({ type: 'authorized' });
}
