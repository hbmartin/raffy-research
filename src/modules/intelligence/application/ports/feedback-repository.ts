import type { ApplicationResult } from '@/modules/kernel/application/result';

import type {
  FeedbackEvent,
  FeedbackEventWriteInput,
} from '../../domain/feedback';

export interface FeedbackRepository {
  create(
    input: FeedbackEventWriteInput
  ): Promise<ApplicationResult<FeedbackEvent>>;
}
