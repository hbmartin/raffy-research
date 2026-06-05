import { describe, expect, it } from 'vitest';

import {
  FEEDBACK_EVENT_TYPES,
  feedbackMutatesState,
  isFeedbackEventType,
} from '@/modules/intelligence';

describe('feedback policy', () => {
  it('only add_competitor_to_watchlist mutates state', () => {
    for (const eventType of FEEDBACK_EVENT_TYPES) {
      expect(feedbackMutatesState(eventType)).toBe(
        eventType === 'add_competitor_to_watchlist'
      );
    }
  });

  it('recognizes valid feedback event types', () => {
    expect(isFeedbackEventType('useful')).toBe(true);
    expect(isFeedbackEventType('flag_bad_synthesis')).toBe(true);
    expect(isFeedbackEventType('not_a_type')).toBe(false);
  });
});
