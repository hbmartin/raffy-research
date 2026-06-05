import { describe, expect, it } from 'vitest';

import { computeWeeklyPeriod, formatPeriodDate } from '@/modules/intelligence';

describe('computeWeeklyPeriod', () => {
  it('returns the prior completed Monday–Sunday week in the workspace timezone', () => {
    // Monday 2026-06-01 08:00 America/Los_Angeles (15:00 UTC).
    const now = new Date('2026-06-01T15:00:00.000Z');
    const { periodStart, periodEnd } = computeWeeklyPeriod(
      now,
      'America/Los_Angeles'
    );

    expect(formatPeriodDate(periodStart, 'America/Los_Angeles')).toBe(
      '2026-05-25'
    );
    expect(formatPeriodDate(periodEnd, 'America/Los_Angeles')).toBe(
      '2026-05-31'
    );
    expect(periodStart.getTime()).toBeLessThan(periodEnd.getTime());
  });

  it('covers the week before the current week midweek too', () => {
    // Thursday 2026-06-04.
    const now = new Date('2026-06-04T18:00:00.000Z');
    const { periodStart, periodEnd } = computeWeeklyPeriod(now, 'UTC');
    expect(formatPeriodDate(periodStart, 'UTC')).toBe('2026-05-25');
    expect(formatPeriodDate(periodEnd, 'UTC')).toBe('2026-05-31');
  });

  it('honors a non-US timezone for the day boundary', () => {
    const now = new Date('2026-06-01T15:00:00.000Z');
    const { periodStart } = computeWeeklyPeriod(now, 'Asia/Tokyo');
    // Tokyo is already Tuesday; the prior week still starts on a Monday.
    expect(formatPeriodDate(periodStart, 'Asia/Tokyo')).toBe('2026-05-25');
  });
});
