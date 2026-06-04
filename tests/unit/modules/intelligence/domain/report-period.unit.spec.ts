import { describe, expect, it } from 'vitest';

import { calculateCompletedWeekWindow } from '@/modules/intelligence/domain/report-period';

describe('calculateCompletedWeekWindow', () => {
  it('returns the completed local Monday-to-Monday window for a UTC cron run', () => {
    const window = calculateCompletedWeekWindow({
      now: new Date('2026-06-08T15:00:00.000Z'),
      timezone: 'America/Los_Angeles',
    });

    expect(window.periodStart.toISOString()).toBe('2026-06-01T07:00:00.000Z');
    expect(window.periodEnd.toISOString()).toBe('2026-06-08T07:00:00.000Z');
  });

  it('uses each workspace timezone instead of the cron timezone', () => {
    const window = calculateCompletedWeekWindow({
      now: new Date('2026-06-08T15:00:00.000Z'),
      timezone: 'Asia/Tokyo',
    });

    expect(window.periodStart.toISOString()).toBe('2026-05-31T15:00:00.000Z');
    expect(window.periodEnd.toISOString()).toBe('2026-06-07T15:00:00.000Z');
  });
});
