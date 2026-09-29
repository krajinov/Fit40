/**
 * Run-closure DTO (M17 Slice 10).
 *
 * The factual shape of one CURRENT run's closure, for presentation. It carries
 * TWO verdicts on purpose and never merges them:
 * - `isProgramComplete` keeps M14's meaning — every authored occurrence has a
 *   completed session — and never counts a not-performed record;
 * - `isConcluded` is M17's meaning — every authored occurrence is settled by a
 *   completed session OR a not-performed record — so a run can be concluded
 *   while incomplete.
 * `restartAvailable` is the Domain's restartability rule already applied to
 * those two by the read, so no component re-derives a gate.
 *
 * The counts are the Domain's `resolveRunClosure` over the AUTHORED program:
 * never a percentage, never `planned_workouts` rows, never M16's horizon.
 * `openInProgramOrder` carries the authored identity and labels of the
 * still-open occurrences in authored program order, so presentation never
 * re-orders or re-resolves them.
 *
 * This module projects facts only: no verdict, count or ordering is decided
 * here.
 */

import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import type { RunClosure } from '@/domain/services/run-closure';

/** One still-open authored occurrence, with the labels a surface renders. */
export interface RunClosureOpenWorkoutDto {
  /** Authored occurrence identity — a stable render key. */
  readonly scheduledWorkoutId: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly workoutName: string;
}

/** The current run's closure, plus the two verdicts presentation must not re-derive. */
export interface RunClosureSummaryDto {
  readonly programSlug: string;
  /** Authored occurrences of the program — the closure denominator. */
  readonly totalWorkouts: number;
  readonly completedWorkouts: number;
  readonly notPerformedWorkouts: number;
  readonly openWorkouts: number;
  readonly hasOpenWorkout: boolean;
  /** The open occurrences in authored program order (Domain-resolved). */
  readonly openInProgramOrder: ReadonlyArray<RunClosureOpenWorkoutDto>;
  /** M17: every authored occurrence settled by a completed session or a record. */
  readonly isConcluded: boolean;
  /** M14: every authored occurrence has a completed session. Unchanged. */
  readonly isProgramComplete: boolean;
  /** The Domain's restartability rule over the two verdicts above. */
  readonly restartAvailable: boolean;
}

/** The two values the read derives through Domain authority, not here. */
export interface RunClosureVerdicts {
  readonly programComplete: boolean;
  readonly restartAvailable: boolean;
}

/** Projects the Domain's closure state and the read's verdicts onto the DTO. */
export function toRunClosureSummaryDto(
  program: TrainingProgram,
  closure: RunClosure,
  verdicts: RunClosureVerdicts,
): RunClosureSummaryDto {
  return {
    programSlug: program.slug,
    totalWorkouts: closure.totalWorkouts,
    completedWorkouts: closure.completedWorkouts,
    notPerformedWorkouts: closure.notPerformedWorkouts,
    openWorkouts: closure.openWorkouts,
    hasOpenWorkout: closure.openWorkouts > 0,
    openInProgramOrder: closure.openInProgramOrder.map((occurrence) =>
      toOpenWorkoutDto(program, occurrence),
    ),
    isConcluded: closure.isConcluded,
    isProgramComplete: verdicts.programComplete,
    restartAvailable: verdicts.restartAvailable,
  };
}

/**
 * The authored identity and labels of one open occurrence.
 *
 * The occurrence comes from the program itself (`resolveRunClosure` iterates
 * the authored schedule), so both lookups are structurally present; a miss
 * means the aggregate disagrees with itself, which fails loudly rather than
 * emitting a partial row (the schedule read's `requireOccurrence` convention).
 */
function toOpenWorkoutDto(
  program: TrainingProgram,
  occurrence: ScheduledWorkout,
): RunClosureOpenWorkoutDto {
  const week = program.weeks.find((candidate) =>
    candidate.scheduledWorkouts.some((scheduled) => scheduled.id === occurrence.id),
  );
  const workout = program.workouts.find((candidate) => candidate.id === occurrence.workoutId);

  if (week === undefined || workout === undefined) {
    throw new Error(
      `Run closure summary contract violated: open occurrence "${occurrence.id}" has no authored week or workout in program "${program.slug}"`,
    );
  }

  return {
    scheduledWorkoutId: occurrence.id,
    weekNumber: week.weekNumber,
    workoutOrder: occurrence.order,
    workoutName: workout.name,
  };
}
