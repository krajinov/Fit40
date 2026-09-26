/**
 * Presentation label helpers for the dashboard screen.
 */

/**
 * Formats the dashboard date eyebrow, e.g. "TUESDAY, SEPTEMBER 1".
 *
 * Uses UTC so the label is deterministic for a given instant regardless of
 * the server's timezone; the page is dynamic so it renders per request.
 */
export function formatDashboardDate(date: Date): string {
  return new Intl.DateTimeFormat('en-US', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
    .format(date)
    .toUpperCase();
}

/**
 * The user's age derived from the profile birth year. Presentation-only.
 */
export function calculateAge(birthYear: number, now: Date): number {
  return now.getUTCFullYear() - birthYear;
}
