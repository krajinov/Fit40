/**
 * Presentation label helpers for the training-history screens.
 *
 * All formatting is deterministic — fixed UTC timezone and en-US locale — so
 * a given instant or count always renders the same label regardless of the
 * server's timezone. No date library is introduced for these screens.
 *
 * This module also owns the display-only presence rule behind volume badges
 * (`hasEligibleExternalLoad`, docs/training-progress.md §6.3): the History and
 * completed-session views share it so a genuine `0 kg × reps` session badges
 * while bodyweight-only and duration-only sessions do not.
 */

import type { CompletedSessionSetDto } from '@/application/dto/completed-session';
import { formatKg } from '@/features/sessions/progression-labels';

/** Formats a completion instant as a concise UTC date, e.g. "Feb 15, 2026". */
export function formatHistoryDate(isoTimestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(isoTimestamp));
}

/** "Jun 2" — a concise UTC month and day for in-period comparisons. */
export function formatHistoryMonthDay(isoTimestamp: string): string {
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(isoTimestamp));
}

/** Formats a count with locale grouping, e.g. 1240 -> "1,240". */
export function formatHistoryCount(value: number): string {
  return value.toLocaleString('en-US');
}

/**
 * Formats an external-load volume total, e.g. "1,240 kg × reps".
 *
 * The value is load × repetitions (the Domain's `reps × weightKg` sum), so the
 * unit must say so (docs/training-progress.md §6.2) — plain "kg" would read as
 * a mass or a strength figure. Rounding and en-US grouping are unchanged.
 */
export function formatHistoryVolume(volumeKgReps: number): string {
  return `${Math.round(volumeKgReps).toLocaleString('en-US')} kg × reps`;
}

/**
 * Whether a session's logged occurrences include at least one eligible
 * externally loaded rep set — the presence fact behind a volume badge
 * (docs/training-progress.md §6.3).
 *
 * Eligibility mirrors the Domain volume rule for display only: a rep set with
 * `weightKg !== null` (`0 kg` is a real load). A session whose eligible sets
 * sum to exactly zero therefore still renders "0 kg × reps", while
 * bodyweight-only sessions — and duration-only sessions, even when a weight
 * was logged on timed work — render no badge at all. `calculateSessionMetrics`
 * remains the volume authority and is untouched.
 */
export function hasEligibleExternalLoad(
  exerciseLogs: ReadonlyArray<{
    readonly sets: ReadonlyArray<{
      readonly type: 'reps' | 'duration';
      readonly weightKg: number | null;
    }>;
  }>,
): boolean {
  return exerciseLogs.some((log) =>
    log.sets.some((set) => set.type === 'reps' && set.weightKg !== null),
  );
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
 * Formats the wall-clock time a workout took, e.g. "<1 min", "45 min",
 * "1 hr 5 min", "2 hr". Sub-minute sessions render truthfully instead of
 * flooring to "0 min". The input must be computed from the persisted
 * startedAt → completedAt gap — never from logged timed work, which is the
 * sum of work sets, not the workout's duration.
 */
export function formatHistoryElapsed(elapsedSeconds: number): string {
  if (elapsedSeconds < 60) {
    return '<1 min';
  }
  const totalMinutes = Math.floor(elapsedSeconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) {
    return `${minutes} min`;
  }
  return minutes === 0 ? `${hours} hr` : `${hours} hr ${minutes} min`;
}
