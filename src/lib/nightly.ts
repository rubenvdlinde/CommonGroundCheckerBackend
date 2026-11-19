/** Nightly checks run at a local hour in this time zone. */
export const NIGHTLY_TIME_ZONE = "Europe/Amsterdam";

/**
 * A nightly check may run this many hours before its interval has passed,
 * so a check that ran at the nightly hour is due again at that hour, and
 * one that ran in the evening still runs that night. A check that ran
 * less than 6 hours before the nightly hour is not repeated that night.
 */
const NIGHTLY_SLACK_HOURS = 18;

const HOUR_MS = 60 * 60 * 1000;

/**
 * Reads `SCHEDULER_NIGHTLY_HOUR`: a whole hour from 0 to 23 in
 * Europe/Amsterdam time, or null when it is unset or invalid.
 */
export function readNightlyHour(env: NodeJS.ProcessEnv = process.env): number | null {
  const raw = env.SCHEDULER_NIGHTLY_HOUR?.trim();
  if (!raw || !/^\d{1,2}$/.test(raw)) return null;
  const hour = Number(raw);
  return hour >= 0 && hour <= 23 ? hour : null;
}

type LocalParts = { year: number; month: number; day: number; hour: number; minute: number };

function localParts(date: Date, timeZone: string): LocalParts {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: string) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
}

/** Milliseconds the time zone is ahead of UTC at this moment. */
function zoneOffsetMs(date: Date, timeZone: string): number {
  const local = localParts(date, timeZone);
  const asUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute);
  return asUtc - Math.floor(date.getTime() / 60000) * 60000;
}

/**
 * The moment a local date and hour occur in the time zone. On the night
 * clocks go forward, an hour that does not exist resolves to the hour after.
 */
function zonedTime(year: number, month: number, day: number, hour: number, timeZone: string): Date {
  const guess = Date.UTC(year, month - 1, day, hour);
  const first = guess - zoneOffsetMs(new Date(guess), timeZone);
  return new Date(guess - zoneOffsetMs(new Date(first), timeZone));
}

/** The first moment at or after `earliest` when the local clock in the time zone shows `hour`:00. */
export function nextLocalHour(earliest: Date, hour: number, timeZone: string = NIGHTLY_TIME_ZONE): Date {
  const local = localParts(earliest, timeZone);
  for (let offset = 0; offset < 3; offset += 1) {
    const candidate = zonedTime(local.year, local.month, local.day + offset, hour, timeZone);
    if (candidate.getTime() >= earliest.getTime()) return candidate;
  }
  return zonedTime(local.year, local.month, local.day + 3, hour, timeZone);
}

/**
 * When a repository checked at `lastCheckedAt` is next due with a nightly
 * hour: the first nightly hour once the interval, less 18 hours of slack,
 * has passed. A daily repository is so checked every night, a weekly one
 * on the night its week is up.
 */
export function nextNightlyCheckAt(
  lastCheckedAt: Date,
  checkIntervalHours: number,
  nightlyHour: number,
  timeZone: string = NIGHTLY_TIME_ZONE
): Date {
  const slack = Math.min(NIGHTLY_SLACK_HOURS, checkIntervalHours * 0.75);
  const earliest = new Date(lastCheckedAt.getTime() + (checkIntervalHours - slack) * HOUR_MS);
  return nextLocalHour(earliest, nightlyHour, timeZone);
}
