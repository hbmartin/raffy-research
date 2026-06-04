export type ReportPeriodWindow = {
  periodStart: Date;
  periodEnd: Date;
};

type DateParts = {
  day: number;
  hour: number;
  minute: number;
  month: number;
  second: number;
  year: number;
};

const partsFormatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterForTimezone(timezone: string) {
  const cached = partsFormatterCache.get(timezone);
  if (cached) return cached;

  const formatter = new Intl.DateTimeFormat('en-US', {
    calendar: 'iso8601',
    day: '2-digit',
    hour: '2-digit',
    hour12: false,
    minute: '2-digit',
    month: '2-digit',
    second: '2-digit',
    timeZone: timezone,
    year: 'numeric',
  });
  partsFormatterCache.set(timezone, formatter);
  return formatter;
}

function zonedParts(date: Date, timezone: string): DateParts {
  const parts = formatterForTimezone(timezone).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => {
    const part = parts.find((candidate) => candidate.type === type);
    return part ? Number(part.value) : 0;
  };

  return {
    day: value('day'),
    hour: value('hour') % 24,
    minute: value('minute'),
    month: value('month'),
    second: value('second'),
    year: value('year'),
  };
}

function timezoneOffsetMs(date: Date, timezone: string) {
  const parts = zonedParts(date, timezone);
  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );
  return asUtc - date.getTime();
}

function zonedStartOfDayUtc(input: {
  day: number;
  month: number;
  timezone: string;
  year: number;
}) {
  const utcGuess = Date.UTC(input.year, input.month - 1, input.day);
  const firstOffset = timezoneOffsetMs(new Date(utcGuess), input.timezone);
  const firstResult = new Date(utcGuess - firstOffset);
  const secondOffset = timezoneOffsetMs(firstResult, input.timezone);
  return new Date(utcGuess - secondOffset);
}

function addUtcDays(date: Date, days: number) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function calculateCompletedWeekWindow(input: {
  now: Date;
  timezone: string;
}): ReportPeriodWindow {
  const local = zonedParts(input.now, input.timezone);
  const localDateAsUtc = new Date(
    Date.UTC(local.year, local.month - 1, local.day)
  );
  const daysSinceMonday = (localDateAsUtc.getUTCDay() + 6) % 7;
  const currentMondayDate = addUtcDays(localDateAsUtc, -daysSinceMonday);
  const previousMondayDate = addUtcDays(currentMondayDate, -7);

  const periodEnd = zonedStartOfDayUtc({
    day: currentMondayDate.getUTCDate(),
    month: currentMondayDate.getUTCMonth() + 1,
    timezone: input.timezone,
    year: currentMondayDate.getUTCFullYear(),
  });
  const periodStart = zonedStartOfDayUtc({
    day: previousMondayDate.getUTCDate(),
    month: previousMondayDate.getUTCMonth() + 1,
    timezone: input.timezone,
    year: previousMondayDate.getUTCFullYear(),
  });

  return { periodStart, periodEnd };
}
