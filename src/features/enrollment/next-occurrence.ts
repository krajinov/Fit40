/**
 * M17 — the run's authoritative next occurrence, in authored program order.
 *
 * The M14 `nextWorkout` (the first authored occurrence with no completed
 * session) is COMPLETION-only, so after M17 it can point at an occurrence that
 * is already SETTLED — recorded as not performed — which must never be shown as
 * "Up next" or offered a Start. When the closure read supplied its authored-run
 * truth, the genuinely OPEN occurrence is the FIRST entry of
 * `openInProgramOrder`; that value is Application-resolved and is only SELECTED
 * here, never recomputed. The M14 value is the fallback used only when there is
 * no closure data to trust.
 *
 * A null closure DTO means the additive closure read failed, so the pre-M17
 * behavior is preserved exactly: a degraded read invents no settlement truth and
 * the M14 next workout stands.
 */

import type { RunClosureSummaryDto } from '@/application/dto/run-closure';

export interface NextOccurrenceCoordinates {
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export function resolveRunNextOccurrence(
  nextWorkout: NextOccurrenceCoordinates | null,
  runClosure: RunClosureSummaryDto | null,
): NextOccurrenceCoordinates | null {
  // Degraded read: no closure data — keep M14 truth untouched.
  if (runClosure === null) {
    return nextWorkout;
  }

  // Settled run (complete OR concluded-incomplete): nothing is open, so nothing
  // is up next. The M14 value can point at a recorded occurrence, so it is
  // deliberately ignored here.
  if (runClosure.isProgramComplete || runClosure.isConcluded) {
    return null;
  }

  // Open run: the FIRST authored OPEN occurrence is the one on the clock, not
  // merely the first non-completed one.
  const firstOpen = runClosure.openInProgramOrder[0];
  return firstOpen === undefined
    ? null
    : { weekNumber: firstOpen.weekNumber, workoutOrder: firstOpen.workoutOrder };
}
