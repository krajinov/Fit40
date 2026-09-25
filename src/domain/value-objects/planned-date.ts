/**
 * PlannedDate value object (M15 calendar intent).
 *
 * A PlannedDate is a calendar date only: no time, no timezone. M15 schedules
 * training on human dates ("Monday, September 28"), never on instants, so the
 * canonical representation is a zero-padded `YYYY-MM-DD` string:
 *
 * - timezone-independent: a PlannedDate never carries a zone, so a local-time
 *   conversion can never silently shift it;
 * - comparable and sortable by plain string comparison, because canonical ISO
 *   calendar dates are lexicographically chronological;
 * - serialization-stable: the domain value is exactly the persisted form.
 *
 * Calendar arithmetic is deliberately explicit UTC (the `training-week.ts`
 * convention): `Date` is used only as an epoch-millisecond carrier through
 * `setUTCFullYear` / `getUTC*`, so the server's, database's, or viewer's
 * timezone can never influence a result. Fit40 has no user-timezone
 * preference (M13 disclosed the UTC calendar week), so "today" is always the
 * UTC calendar day of a caller-supplied instant.
 *
 * This module imports nothing but the domain Result contract and the weekday
 * vocabulary.
 */

import { err, ok, type Result } from '@/domain/types/result';

import { WEEKDAY_VALUES, type Weekday } from '@/domain/value-objects/training-days';

export type PlannedDate = string & { readonly __brand: 'PlannedDate' };

export interface PlannedDateValidationError {
  readonly code: 'INVALID_PLANNED_DATE';
  readonly message: string;
}

function invalid(message: string): PlannedDateValidationError {
  return { code: 'INVALID_PLANNED_DATE', message };
}

/** Milliseconds in one UTC day; epoch arithmetic is timezone-independent. */
const MS_PER_DAY = 86_400_000;

/** Canonical form: four year digits, two month digits, two day digits. */
const PLANNED_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

interface PlannedDateParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

/**
 * Parses the canonical shape only; real-calendar validity is a separate
 * concern (`isRealCalendarDate`). Returns null for anything that is not
 * exactly `YYYY-MM-DD`.
 */
function parsePlannedDateParts(value: string): PlannedDateParts | null {
  const match = PLANNED_DATE_PATTERN.exec(value);
  if (match === null) {
    return null;
  }

  const [, yearText, monthText, dayText] = match;
  if (yearText === undefined || monthText === undefined || dayText === undefined) {
    return null;
  }

  return {
    year: Number.parseInt(yearText, 10),
    month: Number.parseInt(monthText, 10),
    day: Number.parseInt(dayText, 10),
  };
}

/**
 * UTC epoch milliseconds at the start of a calendar day.
 *
 * `setUTCFullYear` is used instead of `Date.UTC(year, …)`: the latter maps
 * years 0-99 onto 1900-1999 (JavaScript's two-digit-year rule), which would
 * silently rewrite a legitimate `00xx` date.
 */
function utcDayStartMs(parts: PlannedDateParts): number {
  const instant = new Date(0);
  instant.setUTCFullYear(parts.year, parts.month - 1, parts.day);
  instant.setUTCHours(0, 0, 0, 0);
  return instant.getTime();
}

/** Canonical `YYYY-MM-DD` rendering, or null when it cannot be rendered. */
function formatUtcDate(dayStartMs: number): string | null {
  const instant = new Date(dayStartMs);
  const year = instant.getUTCFullYear();
  if (!Number.isInteger(year) || year < 0 || year > 9999) {
    return null;
  }

  const month = instant.getUTCMonth() + 1;
  const day = instant.getUTCDate();
  const paddedYear = String(year).padStart(4, '0');
  const paddedMonth = String(month).padStart(2, '0');
  const paddedDay = String(day).padStart(2, '0');
  return `${paddedYear}-${paddedMonth}-${paddedDay}`;
}

/**
 * True when the components describe a real calendar day: the UTC round-trip
 * must reproduce them, which rejects impossible dates such as `2026-02-30`
 * and handles leap years (including the 1900/2000 century rules) exactly.
 */
function isRealCalendarDate(parts: PlannedDateParts): boolean {
  if (parts.month < 1 || parts.month > 12 || parts.day < 1 || parts.day > 31) {
    return false;
  }

  const instant = new Date(utcDayStartMs(parts));
  return (
    instant.getUTCFullYear() === parts.year &&
    instant.getUTCMonth() + 1 === parts.month &&
    instant.getUTCDate() === parts.day
  );
}

/**
 * Creates a validated PlannedDate from its canonical `YYYY-MM-DD` form.
 *
 * Rejects both malformed shapes (`2026-9-28`, `20260928`, timestamps) and
 * impossible calendar dates (`2026-02-30`, `2025-02-29`).
 */
export function createPlannedDate(value: string): Result<PlannedDate, PlannedDateValidationError> {
  const parts = parsePlannedDateParts(value);
  if (parts === null) {
    return err(invalid('PlannedDate must be a calendar date in YYYY-MM-DD form'));
  }

  if (!isRealCalendarDate(parts)) {
    return err(invalid(`"${value}" is not a real calendar date`));
  }

  // Safe: the value was just validated as canonical; the brand is a
  // compile-time-only marker and the runtime value stays a plain string.
  return ok(value as PlannedDate);
}

/**
 * The UTC calendar date of a trusted instant.
 *
 * The instant is trusted input from the application layer (the request clock,
 * captured once per request). An invalid `Date`, or an instant outside the
 * four-digit year range, is a contract violation rather than a business
 * outcome, so it throws — matching how the repository treats other trusted
 * boundaries.
 */
export function plannedDateFromInstant(instant: Date): PlannedDate {
  if (Number.isNaN(instant.getTime())) {
    throw new Error('plannedDateFromInstant requires a valid Date instant');
  }

  const rendered = formatUtcDate(
    utcDayStartMs({
      year: instant.getUTCFullYear(),
      month: instant.getUTCMonth() + 1,
      day: instant.getUTCDate(),
    }),
  );
  if (rendered === null) {
    throw new Error(
      'plannedDateFromInstant received an instant outside the supported calendar range',
    );
  }

  const result = createPlannedDate(rendered);
  if (!result.ok) {
    throw new Error(`plannedDateFromInstant produced a non-canonical date: ${result.error.message}`);
  }

  return result.data;
}

/** Plain-value comparison of two canonical dates: `-1`, `0`, or `1`. */
export function comparePlannedDates(a: PlannedDate, b: PlannedDate): number {
  if (a === b) {
    return 0;
  }
  return a < b ? -1 : 1;
}

/** True when both values denote the same calendar day. */
export function plannedDatesEqual(a: PlannedDate, b: PlannedDate): boolean {
  return a === b;
}

/** True when `a` denotes an earlier calendar day than `b`. */
export function isPlannedDateBefore(a: PlannedDate, b: PlannedDate): boolean {
  return a < b;
}

/** True when `a` denotes a later calendar day than `b`. */
export function isPlannedDateAfter(a: PlannedDate, b: PlannedDate): boolean {
  return a > b;
}

/**
 * The calendar date `days` days after `date`; negative values move backwards.
 *
 * Fails only when the result leaves the supported four-digit year range, or
 * when `days` is not an integer. Both are practically unreachable for real
 * training schedules, but a non-canonical value is never produced silently.
 */
export function addDaysToPlannedDate(
  date: PlannedDate,
  days: number,
): Result<PlannedDate, PlannedDateValidationError> {
  if (!Number.isInteger(days)) {
    return err(invalid('days must be an integer'));
  }

  const parts = parsePlannedDateParts(date);
  if (parts === null) {
    return err(invalid(`"${date}" is not a canonical PlannedDate`));
  }

  const rendered = formatUtcDate(utcDayStartMs(parts) + days * MS_PER_DAY);
  if (rendered === null) {
    return err(invalid(`adding ${days} day(s) to ${date} leaves the supported calendar range`));
  }

  return createPlannedDate(rendered);
}

/**
 * The ISO-8601 weekday of a PlannedDate: Monday = 1 … Sunday = 7.
 *
 * A non-canonical input is a contract violation (the type is branded), so it
 * throws rather than returning a Result.
 */
export function plannedDateWeekday(date: PlannedDate): Weekday {
  const parts = parsePlannedDateParts(date);
  if (parts === null) {
    throw new Error(`plannedDateWeekday received a non-canonical PlannedDate "${date}"`);
  }

  // 0 = Sunday … 6 = Saturday; shift to 0 = Monday … 6 = Sunday.
  const utcDay = new Date(utcDayStartMs(parts)).getUTCDay();
  const daysSinceMonday = (utcDay + 6) % 7;

  const weekday = WEEKDAY_VALUES[daysSinceMonday];
  if (weekday === undefined) {
    // Unreachable: daysSinceMonday is always 0..6.
    throw new Error('plannedDateWeekday could not resolve a weekday');
  }
  return weekday;
}

/**
 * Monday of the UTC calendar week containing `date` — the same Monday-start
 * week the weekly insights use.
 */
export function startOfPlannedWeek(
  date: PlannedDate,
): Result<PlannedDate, PlannedDateValidationError> {
  return addDaysToPlannedDate(date, -(plannedDateWeekday(date) - 1));
}
