/**
 * Presentation label helpers for the training-history screens.
 *
 * All formatting is deterministic — fixed UTC timezone and en-US locale — so
 * a given instant or count always renders the same label regardless of the
 * server's timezone. No date library is introduced for these screens.
 */

import type { CompletedSessionSetDto } from '@/application/dto/completed-session';
import { formatKg } from '@/features/sessions/workout-target-views';

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

function withRpeSuffix(label: string, rpe: number | null): string {
  return rpe === null ? label : `${label} @ RPE ${rpe}`;
}

/**
 * Formats one logged set truthfully:
 * - loaded reps: "50 kg × 10" — including "0 kg × 10" for a logged 0 kg
 * - bodyweight reps (no external load): "10 reps"
 * - timed work: "45 sec", or "10 kg × 45 sec" under load
 * An " @ RPE 7" suffix is appended only when the set captured an RPE.
 */
export function formatSessionSetLine(set: CompletedSessionSetDto): string {
  if (set.type === 'reps') {
    return withRpeSuffix(
      set.weightKg === null
        ? `${set.reps} reps`
        : `${formatKg(set.weightKg)} × ${set.reps}`,
      set.rpe,
    );
  }
  return withRpeSuffix(
    set.weightKg === null
      ? `${set.durationSeconds} sec`
      : `${formatKg(set.weightKg)} × ${set.durationSeconds} sec`,
    set.rpe,
  );
}

/**
 * Formats the wall-clock time a workout took, e.g. "45 min", "1 hr 5 min",
 * "2 hr". The input must be computed from the persisted startedAt →
 * completedAt gap — never from logged timed work, which is the sum of work
 * sets, not the workout's duration.
 */
export function formatHistoryElapsed(elapsedSeconds: number): string {
  const totalMinutes = Math.floor(elapsedSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}
