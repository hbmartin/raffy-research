import type { Clock, Logger } from '@/modules/kernel';

import type { IngestionRepository } from '../../ports/ingestion-repository';
import type {
  CredentialResolver,
  ProviderRegistry,
} from '../../ports/provider-adapter';
import type { SourceRepository } from '../../ports/source-repository';
import type { WorkspaceRepository } from '../../ports/workspace-repository';

export type IngestionDeps = {
  workspaceRepository: WorkspaceRepository;
  sourceRepository: SourceRepository;
  ingestionRepository: IngestionRepository;
  registry: ProviderRegistry;
  credentialResolver: CredentialResolver;
  clock: Clock;
  logger: Logger;
};
