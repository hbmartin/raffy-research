import type { ApplicationResult } from '@/modules/kernel/application/result';

import type {
  BusinessOutcome,
  Operation,
  PageInput,
} from '../domain/operation';

export interface OperationRepository {
  get(
    userId: string,
    id: string
  ): Promise<
    ApplicationResult<
      { type: 'operation_found'; operation: Operation } | { type: 'not_found' }
    >
  >;
  list(
    userId: string,
    workspaceId: string,
    page: PageInput
  ): Promise<ApplicationResult<BusinessOutcome>>;
  claim(
    credentialId: string
  ): Promise<
    ApplicationResult<
      | { type: 'operation_claimed'; operation: Operation }
      | { type: 'queue_empty' }
    >
  >;
  update(
    operation: Operation,
    values: Partial<
      Pick<Operation, 'checkpoint' | 'stage' | 'status' | 'failure' | 'result'>
    >
  ): Promise<ApplicationResult<{ type: 'updated' } | { type: 'lease_lost' }>>;
  heartbeat(
    operation: Operation
  ): Promise<
    ApplicationResult<
      { type: 'renewed'; cancelRequested: boolean } | { type: 'lease_lost' }
    >
  >;
  cancel(
    userId: string,
    id: string
  ): Promise<ApplicationResult<BusinessOutcome>>;
  event(
    operation: Operation,
    data: BusinessOutcome
  ): Promise<ApplicationResult<BusinessOutcome>>;
  events(
    userId: string,
    id: string,
    page: PageInput
  ): Promise<ApplicationResult<BusinessOutcome>>;
}
