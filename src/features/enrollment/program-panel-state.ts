/**
 * Panel view model for the M17 enrollment panel (M17 Slice 11).
 *
 * Pure and presentational: the three mutually exclusive lifecycle states come
 * straight from Slice 10's `RunClosureSummaryDto` verdicts, which the Domain
 * decided — this module copies `restartAvailable` and the counts, never
 * computes a conclusion, a completion or a gate (no percentage, no date, no
 * calendar).
 *
 * It also resolves the panel's CURRENT WEEK. With authoritative closure truth
 * the current week is the run's FIRST OPEN authored occurrence (the SAME
 * `resolveRunNextOccurrence` selection the up-next surfaces use) — never the
 * completion-only M14 `nextWorkout`, which can point at an occurrence already
 * recorded as not performed. A concluded-but-incomplete run has NO current
 * week, so an old recorded week is never shown as the week in progress; a
 * complete run keeps its existing last-week presentation; and when the closure
 * read failed the exact pre-M17 fallback is preserved.
 *
 * A null DTO (a failed closure read) degrades to the pre-M17 keying: the M14
 * completion surface is chosen exactly when no next workout exists, and no
 * counts are shown, so a degraded read invents nothing.
 */

import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import { resolveRunNextOccurrence } from '@/features/enrollment/next-occurrence';

/** The panel's next-workout input: a resolved preview, degraded, or absent. */
export type PanelNextWorkout =
  | {
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly workoutName: string;
      readonly metaLabel: string;
      readonly sessionState: 'not-started' | 'in-progress' | 'not-performed';
    }
  | 'unavailable'
  | null;

/** The M14 completion-only next workout, used only as the degraded fallback. */
export interface PanelEnrollmentNextWorkout {
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export type EnrolledPanelState =
  /**
   * Settled but incomplete: closed counts, never completion language. The run
   * has no open occurrence, so it has NO current week.
   */
  | {
      readonly kind: 'concluded';
      readonly currentWeekNumber: null;
      readonly completedWorkouts: number;
      readonly notPerformedWorkouts: number;
      readonly restartAvailable: boolean;
    }
  /** M14's surface: every authored occurrence has a completed session. */
  | {
      readonly kind: 'complete';
      readonly currentWeekNumber: number;
      readonly restartAvailable: boolean;
    }
  /** Still running: the up-next card plus the DTO's open counts when known. */
  | {
      readonly kind: 'open';
      readonly currentWeekNumber: number;
      readonly openWorkouts: number | null;
      readonly totalWorkouts: number | null;
      readonly restartAvailable: boolean;
    };

export interface EnrolledPanelStateInput {
  readonly nextWorkout: PanelNextWorkout;
  readonly runClosure: RunClosureSummaryDto | null;
  /**
   * The enrollment's M14 completion-only next workout — the graceful-
   * degradation fallback ONLY. Null when every workout is completed.
   */
  readonly enrollmentNextWorkout: PanelEnrollmentNextWorkout | null;
  /** The authored run length: the last week of a completed run. */
  readonly durationWeeks: number;
}

/**
 * Chooses the panel's lifecycle state AND its current week from the closure
 * DTO.
 *
 * Precedence: a concluded-but-incomplete run wins over everything (it is the
 * state M14 could not express) and has NO current week; then completion (the
 * last authored week); then open, whose current week is the run's authoritative
 * first OPEN occurrence. Restart is never derived here — when the DTO is
 * present its own `restartAvailable` is copied verbatim; when it is absent the
 * fallback reproduces today's behavior exactly (an M14 completion surface
 * offers restart, an open one does not, and the current week is the M14 next
 * workout).
 */
export function resolveEnrolledPanelState(input: EnrolledPanelStateInput): EnrolledPanelState {
  const { nextWorkout, runClosure, enrollmentNextWorkout, durationWeeks } = input;

  // The M14 fallback current week — used ONLY when no authoritative closure
  // truth is available, and byte-for-byte the pre-M17 expression.
  const m14CurrentWeekNumber =
    nextWorkout !== null && nextWorkout !== 'unavailable'
      ? nextWorkout.weekNumber
      : enrollmentNextWorkout === null
        ? durationWeeks
        : enrollmentNextWorkout.weekNumber;

  if (runClosure === null) {
    return nextWorkout === null
      ? { kind: 'complete', currentWeekNumber: m14CurrentWeekNumber, restartAvailable: true }
      : {
          kind: 'open',
          currentWeekNumber: m14CurrentWeekNumber,
          openWorkouts: null,
          totalWorkouts: null,
          restartAvailable: false,
        };
  }

  if (runClosure.isConcluded && !runClosure.isProgramComplete) {
    return {
      kind: 'concluded',
      currentWeekNumber: null,
      completedWorkouts: runClosure.completedWorkouts,
      notPerformedWorkouts: runClosure.notPerformedWorkouts,
      restartAvailable: runClosure.restartAvailable,
    };
  }

  if (runClosure.isProgramComplete) {
    return {
      kind: 'complete',
      currentWeekNumber: durationWeeks,
      restartAvailable: runClosure.restartAvailable,
    };
  }

  // Open run: the current week is the run's authoritative first OPEN authored
  // occurrence — the SAME selection the up-next surfaces use — never the
  // completion-only M14 next workout, which can point at a recorded occurrence.
  const openOccurrence = resolveRunNextOccurrence(enrollmentNextWorkout, runClosure);

  return {
    kind: 'open',
    currentWeekNumber: openOccurrence === null ? m14CurrentWeekNumber : openOccurrence.weekNumber,
    openWorkouts: runClosure.openWorkouts,
    totalWorkouts: runClosure.totalWorkouts,
    restartAvailable: runClosure.restartAvailable,
  };
}
