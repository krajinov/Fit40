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
 * The DTO is also authoritative for the run's AUTHORED settlement IDENTITIES:
 * `completedInProgramOrder` and `notPerformedInProgramOrder` carry the same
 * authored identity + labels for the completed and recorded-not-performed
 * occurrences. Presentation therefore never has to infer settlement from
 * counts, and never loses the recorded identities when another composed read
 * (the M15 calendar) degrades — the closure read's snapshot is the fallback
 * authority for truthful card and week-badge state.
 *
 * This module projects facts only: no verdict, count or ordering is decided
 * here.
 */

import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import { listScheduledWorkoutsInOrder } from '@/domain/services/program-progress';
import type { RunClosure, RunClosureFacts } from '@/domain/services/run-closure';

/**
 * One AUTHORED occurrence of the run, with the labels a surface renders — used
 * for every closure identity set (completed, recorded-not-performed, open).
 */
export interface RunClosureOccurrenceDto {
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
  readonly openInProgramOrder: ReadonlyArray<RunClosureOccurrenceDto>;
  /**
   * The COMPLETED authored occurrences (M14 truth), in authored program order.
   * Exposed so presentation can render completed state truthfully without
   * inferring it from counts or from another read's availability.
   */
  readonly completedInProgramOrder: ReadonlyArray<RunClosureOccurrenceDto>;
  /**
   * The authored occurrences RECORDED as not performed (M17 truth), in authored
   * program order — the identity set a surface uses for "Recorded as not
   * performed" cards and settled week badges, even when the M15 calendar read
   * is unavailable.
   */
  readonly notPerformedInProgramOrder: ReadonlyArray<RunClosureOccurrenceDto>;
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

/**
 * Projects the Domain's closure state, the read's verdicts AND the run's
 * authored settlement identities onto the DTO.
 *
 * `facts` are the SAME two sets the closure verdict was resolved from, so the
 * identity lists and the counts can never disagree. Only AUTHORED occurrences
 * appear (a foreign/unrecognized id is excluded, exactly as `resolveRunClosure`
 * excludes it from the counts), each at most once, in authored program order.
 */
export function toRunClosureSummaryDto(
  program: TrainingProgram,
  closure: RunClosure,
  verdicts: RunClosureVerdicts,
  facts: RunClosureFacts,
): RunClosureSummaryDto {
  return {
    programSlug: program.slug,
    totalWorkouts: closure.totalWorkouts,
    completedWorkouts: closure.completedWorkouts,
    notPerformedWorkouts: closure.notPerformedWorkouts,
    openWorkouts: closure.openWorkouts,
    hasOpenWorkout: closure.openWorkouts > 0,
    openInProgramOrder: closure.openInProgramOrder.map((occurrence) =>
      toOccurrenceDto(program, occurrence),
    ),
    completedInProgramOrder: authoredOccurrencesIn(program, facts.completedIds),
    notPerformedInProgramOrder: authoredOccurrencesIn(program, facts.notPerformedIds),
    isConcluded: closure.isConcluded,
    isProgramComplete: verdicts.programComplete,
    restartAvailable: verdicts.restartAvailable,
  };
}

/**
 * The AUTHORED occurrences whose id is in `ids`, in authored program order,
 * each at most once — the same authored-order convention `openInProgramOrder`
 * uses. Ids the program does not define are skipped (they settle nothing and
 * are already reported as unrecognized by the Domain).
 */
function authoredOccurrencesIn(
  program: TrainingProgram,
  ids: ReadonlyArray<string>,
): ReadonlyArray<RunClosureOccurrenceDto> {
  const wanted = new Set<string>(ids);
  return listScheduledWorkoutsInOrder(program)
    .filter((occurrence) => wanted.has(occurrence.id))
    .map((occurrence) => toOccurrenceDto(program, occurrence));
}

/**
 * The authored identity and labels of one occurrence.
 *
 * The occurrence comes from the program itself (every closure identity is
 * authored), so both lookups are structurally present; a miss means the
 * aggregate disagrees with itself, which fails loudly rather than emitting a
 * partial row (the schedule read's `requireOccurrence` convention).
 */
function toOccurrenceDto(
  program: TrainingProgram,
  occurrence: ScheduledWorkout,
): RunClosureOccurrenceDto {
  const week = program.weeks.find((candidate) =>
    candidate.scheduledWorkouts.some((scheduled) => scheduled.id === occurrence.id),
  );
  const workout = program.workouts.find((candidate) => candidate.id === occurrence.workoutId);

  if (week === undefined || workout === undefined) {
    throw new Error(
      `Run closure summary contract violated: occurrence "${occurrence.id}" has no authored week or workout in program "${program.slug}"`,
    );
  }

  return {
    scheduledWorkoutId: occurrence.id,
    weekNumber: week.weekNumber,
    workoutOrder: occurrence.order,
    workoutName: workout.name,
  };
}
