/**
 * Presentation label helpers for the training-history screen.
 *
 * All formatting is deterministic — fixed UTC timezone and en-US locale — so
 * a given instant or count always renders the same label regardless of the
 * server's timezone. No date library is introduced for this screen.
 */

/** Formats a completion instant as a concise UTC date, e.g. "Feb 15, 2026". */
export function formatHistoryDate(isoTimestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(isoTimestamp));
}

/** Formats a count with locale grouping, e.g. 1240 -> "1,240". */
export function formatHistoryCount(value: number): string {
  return value.toLocaleString('en-US');
}

/** Formats a training-volume total in kilograms, e.g. "1,240 kg". */
export function formatHistoryVolume(volumeKg: number): string {
  return `${Math.round(volumeKg).toLocaleString('en-US')} kg`;
}
