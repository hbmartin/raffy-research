/**
 * Weekly coverage window calculation.
 *
 * The report runs Monday morning and covers the most recently completed
 * Monday–Sunday week, interpreted in the workspace timezone. Boundaries are
 * returned as UTC instants (start = Monday 00:00:00.000 local, end = the
 * following Sunday 23:59:59.999 local).
 *
 * Pure: no external dependencies, so it is trivially unit-testable.
 */

export type CoveragePeriod = {
  periodStart: Date;
  periodEnd: Date;
};

type ZonedDate = { year: number; month: number; day: number };

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function getZonedParts(instant: Date, timeZone: string) {
  let formatter = partsFormatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    partsFormatterCache.set(timeZone, formatter);
  }

  const parts = formatter.formatToParts(instant);
  const lookup = (type: string) =>
    Number(parts.find((part) => part.type === type)?.value ?? '0');
  return {
    year: lookup('year'),
    month: lookup('month'),
    day: lookup('day'),
    hour: lookup('hour'),
    minute: lookup('minute'),
    second: lookup('second'),
  };
}

/** Milliseconds local wall-clock time in `timeZone` is ahead of UTC at `instant`. */
function getTimeZoneOffsetMs(instant: Date, timeZone: string): number {
  const z = getZonedParts(instant, timeZone);
  const asUtc = Date.UTC(
    z.year,
    z.month - 1,
    z.day,
    z.hour,
    z.minute,
    z.second
  );
  // Intl parts have no milliseconds; compare at second granularity so the
  // sub-second component of `instant` does not leak into the offset.
  const instantSeconds = instant.getTime() - instant.getUTCMilliseconds();
  return asUtc - instantSeconds;
}

/** Convert a local wall-clock time in `timeZone` to a UTC instant. */
function zonedWallToUtc(
  wall: ZonedDate & {
    hour: number;
    minute: number;
    second: number;
    ms: number;
  },
  timeZone: string
): Date {
  const utcGuess = Date.UTC(
    wall.year,
    wall.month - 1,
    wall.day,
    wall.hour,
    wall.minute,
    wall.second,
    wall.ms
  );
  const offset = getTimeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - offset);
}

function addCivilDays(date: ZonedDate, days: number): ZonedDate {
  const shifted = new Date(Date.UTC(date.year, date.month - 1, date.day));
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
  };
}

/** Day of week for a civil date, 1 = Monday … 7 = Sunday. */
function civilWeekday(date: ZonedDate): number {
  const jsDay = new Date(
    Date.UTC(date.year, date.month - 1, date.day)
  ).getUTCDay();
  return jsDay === 0 ? 7 : jsDay;
}

/**
 * The most recently completed Monday–Sunday week relative to `now` in
 * `timeZone`. When invoked on a Monday this returns the week that just ended.
 */
export function computeWeeklyPeriod(
  now: Date,
  timeZone: string
): CoveragePeriod {
  const zonedNow = getZonedParts(now, timeZone);
  const today: ZonedDate = {
    year: zonedNow.year,
    month: zonedNow.month,
    day: zonedNow.day,
  };

  const weekday = civilWeekday(today);
  const thisWeekMonday = addCivilDays(today, -(weekday - 1));
  const previousMonday = addCivilDays(thisWeekMonday, -7);
  const previousSunday = addCivilDays(previousMonday, 6);

  const periodStart = zonedWallToUtc(
    { ...previousMonday, hour: 0, minute: 0, second: 0, ms: 0 },
    timeZone
  );
  const periodEnd = zonedWallToUtc(
    { ...previousSunday, hour: 23, minute: 59, second: 59, ms: 999 },
    timeZone
  );

  return { periodStart, periodEnd };
}

export function formatPeriodDate(date: Date, timeZone: string): string {
  const z = getZonedParts(date, timeZone);
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${z.year}-${pad(z.month)}-${pad(z.day)}`;
}
