/**
 * Shared presentation utilities for canonical calendar dates (M15).
 *
 * A `YYYY-MM-DD` planned date is calendar truth — no time, no zone — so its
 * label is built from its COMPONENTS, never by parsing the string into a
 * `Date` instant (which is exactly the timezone-sensitive conversion M15's
 * domain deliberately avoids). Extracted here (Slice 6) so the dashboard and
 * program-detail schedule surfaces share one month table and one rule.
 */

/** Short en-US month names, indexed by calendar month (1-based). */
const MONTH_SHORT = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

/**
 * Formats a canonical planned date for display, e.g. `2026-09-23` → `Sep 23`.
 *
 * Deterministic in every server timezone: the value is read as three calendar
 * numbers (month index + day, leading zeros dropped) with no `Date` object
 * involved at all. A value that is not canonical `YYYY-MM-DD` is returned
 * unchanged rather than rendered as a fabricated or invalid label.
 */
export function formatPlannedDateLabel(plannedDate: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(plannedDate);
  const monthIndex = match?.[2];
  const dayText = match?.[3];
  if (monthIndex === undefined || dayText === undefined) {
    return plannedDate;
  }

  const month = MONTH_SHORT[Number(monthIndex) - 1];
  if (month === undefined) {
    return plannedDate;
  }

  return `${month} ${Number(dayText)}`;
}