import type { Result } from '@swan-io/boxed';

import type { AppError } from '@/modules/kernel/domain/errors/app-error';
import type { JsonObject } from '@/modules/kernel/domain/json';

import type { LinkedinProfileSelection } from '../../domain/linkedin-monitoring';

export type LinkedinWatchlistSnapshot = {
  workspace: {
    id: string;
    name: string;
    companyName: string;
    companyDescription: string;
    subcategory: string;
    icp: string | null;
    gtmFocus: string | null;
    positioning: string | null;
  };
  keywords: string[];
  competitors: { name: string; domain: string | null; state: string }[];
  accounts: {
    id: string;
    platform: string | null;
    username: string | null;
    profileUrl: string | null;
    active: boolean;
    metadata: JsonObject;
  }[];
  provider?: {
    id: string;
    enabled: boolean;
    credentialsRef: string | null;
    config: JsonObject;
  };
};
export type LinkedinSnapshotOutcome =
  | { type: 'watchlist_found'; snapshot: LinkedinWatchlistSnapshot }
  | { type: 'workspace_not_found' };

export interface LinkedinWatchlistWriter {
  selectProfiles(
    profiles: LinkedinProfileSelection[],
    selectedAt: string
  ): Promise<Result<{ type: 'profiles_saved' }, AppError>>;
  saveProviderConfig(
    config: JsonObject
  ): Promise<Result<{ type: 'config_saved' }, AppError>>;
}
export interface LinkedinWatchlistRepository {
  read(workspaceId: string): Promise<Result<LinkedinSnapshotOutcome, AppError>>;
  /** The callback runs under a workspace row lock. Errors roll back all writes. */
  withWorkspaceLock<T>(
    workspaceId: string,
    work: (
      snapshot: LinkedinWatchlistSnapshot,
      writer: LinkedinWatchlistWriter
    ) => Promise<Result<T, AppError>>
  ): Promise<Result<T | { type: 'workspace_not_found' }, AppError>>;
}
export type LinkedinTaskReference = {
  taskId: string;
  scheduleId?: string;
  credentialsRef: string | null;
};
export type LinkedinTaskState = {
  targets: string[];
  schedule?: { enabled: boolean; cronExpression?: string; timezone?: string };
};
export interface LinkedinProviderTask {
  inspect(
    reference: LinkedinTaskReference
  ): Promise<
    Result<
      | { type: 'task_inspected'; state: LinkedinTaskState }
      | { type: 'provider_configuration_invalid'; reason: string },
      AppError
    >
  >;
  updateTargets(
    reference: LinkedinTaskReference,
    targets: string[]
  ): Promise<Result<{ type: 'targets_updated' }, AppError>>;
}
