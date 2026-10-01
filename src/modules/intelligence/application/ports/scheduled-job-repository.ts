import type { ApplicationResult } from '@/modules/kernel/application/result';
import type { WorkspaceId } from '@/modules/kernel/domain/ids';

import type {
  ScheduledJobKind,
  ScheduledJobRun,
  ScheduledJobWorkspaceRun,
  WorkspaceJobHistory,
} from '../../domain/scheduled-job';

export interface ScheduledJobRepository {
  start(input: {
    id: string;
    kind: ScheduledJobKind;
    startedAt: Date;
  }): Promise<ApplicationResult<{ type: 'run_started' }>>;
  finish(
    input: Omit<ScheduledJobRun, 'kind' | 'startedAt'>
  ): Promise<ApplicationResult<{ type: 'run_finished' }>>;
  upsertWorkspace(
    input: ScheduledJobWorkspaceRun
  ): Promise<ApplicationResult<{ type: 'workspace_recorded' }>>;
  listForWorkspace(input: {
    workspaceId: WorkspaceId;
    limit: number;
  }): Promise<ApplicationResult<WorkspaceJobHistory[]>>;
}
