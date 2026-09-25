/**
 * Deterministic schedule generation (M15 calendar intent).
 *
 * Pure: no I/O, no clock, no framework. The caller supplies the request
 * clock's calendar date (`today`), the run's session-derived facts, the
 * existing plan and the weekday selection; this module decides every date.
 *
 * Partition, per authored occurrence (authored program order):
 * - `completed`  → no PlannedWorkout row at all, so the calendar never invents
 *                  intent for work that was actually performed.
 * - `frozen`     → an occurrence with a live in-progress session AND an
 *                  existing row keeps that row verbatim: a workout the user is
 *                  performing right now never silently moves.
 * - `open`       → everything else (never started; manually rescheduled but
 *                  never started; in-progress with no row yet) receives a
 *                  freshly generated date.
 *
 * Occupied dates are exactly the frozen rows' dates. Open rows' previous dates
 * reserve nothing — regeneration is authoritative over manual moves.
 *
 * Candidate dates are the strictly increasing sequence of dates at or after
 * `firstEligibleDate` whose weekday is selected, where `firstEligibleDate` is
 * `today` when today is a selected weekday and the next selected weekday
 * otherwise. Open occurrences are assigned in authored program order, each
 * taking the next candidate that is not occupied; occupied candidates are
 * skipped without consuming a slot. Generated dates are therefore unique,
 * strictly increasing in authored order, and can never collide with a frozen
 * date.
 *
 * Authored order and calendar order may diverge: a frozen row can sit before
 * the generated date of an earlier authored occurrence. That is allowed and
 * deterministic — authored program semantics are never reshuffled.
 *
 * Output ordering is calendar order: plannedDate ascending, then
 * scheduledWorkoutId ascending as a total-order tie-break. That matches the
 * run's persisted read ordering, and no semantics are ever inferred from
 * database ordering.
 *
 * Trusted inputs: `occurrencesInProgramOrder` (the program aggregate
 * guarantees unique ids and sequential orders) and `currentPlan` (at most one
 * row per occurrence, all belonging to `enrollmentId`). A row belonging to
 * another run is rejected rather than carried into this one.
 */

import { err, ok, type Result } from '@/domain/types/result';

import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { ScheduledWorkout } from '@/domain/entities/training-program';
import type { EnrollmentId, ScheduledWorkoutId } from '@/domain/types/ids';
import {
  addDaysToPlannedDate,
  comparePlannedDates,
  plannedDateWeekday,
  type PlannedDate,
  type PlannedDateValidationError,
} from '@/domain/value-objects/planned-date';
import {
  includesWeekday,
  WEEKDAY_VALUES,
  type TrainingDays,
} from '@/domain/value-objects/training-days';

export interface GeneratePlannedScheduleInput {
  /** The run the generated rows belong to. */
  readonly enrollmentId: EnrollmentId;
  /** Every authored occurrence of the program, in authored program order. */
  readonly occurrencesInProgramOrder: ReadonlyArray<ScheduledWorkout>;
  readonly trainingDays: TrainingDays;
  /** The request clock's UTC calendar date. */
  readonly today: PlannedDate;
  /** The run's completed occurrences (session-derived facts). */
  readonly completedIds: ReadonlyArray<ScheduledWorkoutId>;
  /** The run's occurrences with a live in-progress session. */
  readonly inProgressIds: ReadonlyArray<ScheduledWorkoutId>;
  /** The run's existing planned rows, as read before regeneration. */
  readonly currentPlan: ReadonlyArray<PlannedWorkout>;
}

export type GeneratePlannedScheduleError =
  | {
      readonly code: 'PLANNED_WORKOUT_ENROLLMENT_MISMATCH';
      readonly message: string;
    }
  | {
      readonly code: 'PLANNED_DATE_RANGE_EXCEEDED';
      readonly message: string;
    };

function rangeExceeded(error: PlannedDateValidationError): GeneratePlannedScheduleError {
  return { code: 'PLANNED_DATE_RANGE_EXCEEDED', message: error.message };
}

interface OccurrencePartition {
  /** In-progress rows carried forward verbatim. */
  readonly frozen: ReadonlyArray<PlannedWorkout>;
  /** Occurrences that receive freshly generated dates. */
  readonly open: ReadonlyArray<ScheduledWorkout>;
  /** The frozen rows' dates; the only dates generation must avoid. */
  readonly occupiedDates: ReadonlySet<PlannedDate>;
}

function partitionOccurrences(
  input: GeneratePlannedScheduleInput,
): Result<OccurrencePartition, GeneratePlannedScheduleError> {
  const completed = new Set<ScheduledWorkoutId>(input.completedIds);
  const inProgress = new Set<ScheduledWorkoutId>(input.inProgressIds);
  const existingByScheduledWorkout = new Map<ScheduledWorkoutId, PlannedWorkout>();

  for (const plannedWorkout of input.currentPlan) {
    if (plannedWorkout.enrollmentId !== input.enrollmentId) {
      return err({
        code: 'PLANNED_WORKOUT_ENROLLMENT_MISMATCH',
        message: `planned workout for occurrence "${plannedWorkout.scheduledWorkoutId}" belongs to another enrollment`,
      });
    }
    existingByScheduledWorkout.set(plannedWorkout.scheduledWorkoutId, plannedWorkout);
  }

  const frozen: PlannedWorkout[] = [];
  const open: ScheduledWorkout[] = [];
  const occupiedDates = new Set<PlannedDate>();

  for (const occurrence of input.occurrencesInProgramOrder) {
    if (completed.has(occurrence.id)) {
      continue;
    }

    const existing = existingByScheduledWorkout.get(occurrence.id);
    if (inProgress.has(occurrence.id) && existing !== undefined) {
      frozen.push(existing);
      occupiedDates.add(existing.plannedDate);
      continue;
    }

    open.push(occurrence);
  }

  return ok({ frozen, open, occupiedDates });
}

/**
 * Generates the schedule for the run.
 *
 * Returns the frozen rows unchanged plus the generated rows, in calendar
 * order. Deterministic: identical inputs always produce an identical result,
 * independent of the order of `currentPlan`.
 */
export function generatePlannedSchedule(
  input: GeneratePlannedScheduleInput,
): Result<ReadonlyArray<PlannedWorkout>, GeneratePlannedScheduleError> {
  const partition = partitionOccurrences(input);
  if (!partition.ok) {
    return partition;
  }

  const generated = generateOpenRows({
    enrollmentId: input.enrollmentId,
    openOccurrences: partition.data.open,
    trainingDays: input.trainingDays,
    today: input.today,
    occupiedDates: partition.data.occupiedDates,
  });
  if (!generated.ok) {
    return err(rangeExceeded(generated.error));
  }

  return ok(sortByPlannedDate([...partition.data.frozen, ...generated.data]));
}

/**
 * Walks the candidate dates for the open occurrences and builds their rows.
 *
 * An empty open list returns immediately: a run with nothing left to schedule
 * (all completed, or all frozen) never evaluates a candidate date at all.
 */
function generateOpenRows(input: {
  readonly enrollmentId: EnrollmentId;
  readonly openOccurrences: ReadonlyArray<ScheduledWorkout>;
  readonly trainingDays: TrainingDays;
  readonly today: PlannedDate;
  readonly occupiedDates: ReadonlySet<PlannedDate>;
}): Result<ReadonlyArray<PlannedWorkout>, PlannedDateValidationError> {
  const generated: PlannedWorkout[] = [];
  if (input.openOccurrences.length === 0) {
    return ok(generated);
  }

  const firstEligible = firstEligiblePlannedDate(input.today, input.trainingDays);
  if (!firstEligible.ok) {
    return firstEligible;
  }

  let candidate: PlannedDate | null = null;

  for (const occurrence of input.openOccurrences) {
    // The first open occurrence takes the first eligible date; every later one
    // advances to the next selected weekday after the date just assigned, so
    // the walk never moves backwards and never re-uses a date.
    const next: Result<PlannedDate, PlannedDateValidationError> =
      candidate === null
        ? ok(firstEligible.data)
        : nextSelectedWeekday(candidate, input.trainingDays);
    if (!next.ok) {
      return next;
    }
    candidate = next.data;

    // Frozen dates are reserved: skip them without consuming a slot.
    while (input.occupiedDates.has(candidate)) {
      const skipped = nextSelectedWeekday(candidate, input.trainingDays);
      if (!skipped.ok) {
        return skipped;
      }
      candidate = skipped.data;
    }

    generated.push({
      enrollmentId: input.enrollmentId,
      scheduledWorkoutId: occurrence.id,
      plannedDate: candidate,
    });
  }

  return ok(generated);
}

/**
 * The first date a freshly generated workout may take: `today` when today is a
 * selected weekday, otherwise the next selected weekday after today.
 *
 * Exported because it is the schedule's anchor: the same rule decides where a
 * new calendar starts on first configuration and on every regeneration.
 */
export function firstEligiblePlannedDate(
  today: PlannedDate,
  trainingDays: TrainingDays,
): Result<PlannedDate, PlannedDateValidationError> {
  if (includesWeekday(trainingDays, plannedDateWeekday(today))) {
    return ok(today);
  }
  return nextSelectedWeekday(today, trainingDays);
}

/**
 * The first selected weekday strictly after `date`.
 *
 * A non-empty selection always matches within seven days, so the loop always
 * returns; the trailing throw documents that invariant for the type checker
 * (the `requireItem` pattern).
 */
function nextSelectedWeekday(
  date: PlannedDate,
  trainingDays: TrainingDays,
): Result<PlannedDate, PlannedDateValidationError> {
  let candidate = date;

  for (let step = 0; step < WEEKDAY_VALUES.length; step += 1) {
    const advanced = addDaysToPlannedDate(candidate, 1);
    if (!advanced.ok) {
      return advanced;
    }
    candidate = advanced.data;

    if (includesWeekday(trainingDays, plannedDateWeekday(candidate))) {
      return ok(candidate);
    }
  }

  throw new Error('nextSelectedWeekday could not find a selected weekday within seven days');
}

/**
 * Calendar order: plannedDate ascending, then scheduledWorkoutId ascending so
 * the result is a total order even for corrupt input (persistence admits at
 * most one planned workout per date per run, so the tie-break is defensive).
 */
function sortByPlannedDate(
  plannedWorkouts: ReadonlyArray<PlannedWorkout>,
): ReadonlyArray<PlannedWorkout> {
  return [...plannedWorkouts].sort((a, b) => {
    const byDate = comparePlannedDates(a.plannedDate, b.plannedDate);
    if (byDate !== 0) {
      return byDate;
    }
    if (a.scheduledWorkoutId === b.scheduledWorkoutId) {
      return 0;
    }
    return a.scheduledWorkoutId < b.scheduledWorkoutId ? -1 : 1;
  });
}
