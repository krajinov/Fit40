/**
 * Panel lifecycle view model for the M17 enrollment panel (M17 Slice 11).
 *
 * Pure and presentational: the three mutually exclusive states come straight
 * from Slice 10's `RunClosureSummaryDto` verdicts, which the Domain decided —
 * this module copies `restartAvailable` and the counts, never computes a
 * conclusion, a completion or a gate (no percentage, no date, no calendar).
 *
 * A null DTO (a failed closure read) degrades to the pre-M17 keying: the M14
 * completion surface is chosen exactly when no next workout exists, and no
 * counts are shown, so a degraded read invents nothing.
 */

import type { RunClosureSummaryDto } from '@/application/dto/run-closure';

/** The panel's next-workout input: a resolved preview, degraded, or absent. */
export type PanelNextWorkout =
  | {
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly workoutName: string;
      readonly metaLabel: string;
      readonly sessionState: 'not-started' | 'in-progress';
    }
  | 'unavailable'
  | null;

export type EnrolledPanelState =
  /** Settled but incomplete: closed counts, never completion language. */
  | {
      readonly kind: 'concluded';
      readonly completedWorkouts: number;
      readonly notPerformedWorkouts: number;
      readonly restartAvailable: boolean;
    }
  /** M14's surface: every authored occurrence has a completed session. */
  | { readonly kind: 'complete'; readonly restartAvailable: boolean }
  /** Still running: the up-next card plus the DTO's open counts when known. */
  | {
      readonly kind: 'open';
      readonly openWorkouts: number | null;
      readonly totalWorkouts: number | null;
      readonly restartAvailable: boolean;
    };

/**
 * Chooses the panel's lifecycle state from the closure DTO.
 *
 * Precedence: a concluded-but-incomplete run wins over everything (it is the
 * state M14 could not express), then completion, then open. Restart is never
 * derived here — when the DTO is present its own `restartAvailable` is copied
 * verbatim; when it is absent the fallback reproduces today's behavior exactly
 * (an M14 completion surface offers restart, an open one does not).
 */
export function resolveEnrolledPanelState(input: {
  readonly nextWorkout: PanelNextWorkout;
  readonly runClosure: RunClosureSummaryDto | null;
}): EnrolledPanelState {
  const { runClosure } = input;

  if (runClosure === null) {
    return input.nextWorkout === null
      ? { kind: 'complete', restartAvailable: true }
      : { kind: 'open', openWorkouts: null, totalWorkouts: null, restartAvailable: false };
  }

  if (runClosure.isConcluded && !runClosure.isProgramComplete) {
    return {
      kind: 'concluded',
      completedWorkouts: runClosure.completedWorkouts,
      notPerformedWorkouts: runClosure.notPerformedWorkouts,
      restartAvailable: runClosure.restartAvailable,
    };
  }

  if (runClosure.isProgramComplete) {
    return { kind: 'complete', restartAvailable: runClosure.restartAvailable };
  }

  return {
    kind: 'open',
    openWorkouts: runClosure.openWorkouts,
    totalWorkouts: runClosure.totalWorkouts,
    restartAvailable: runClosure.restartAvailable,
  };
}
