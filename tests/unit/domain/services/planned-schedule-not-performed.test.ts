/**
 * M17 Slice 1 — the not-performed fact as a scheduling input.
 *
 * Pins the settled-input contract of `generatePlannedSchedule`:
 * `completedIds ∪ notPerformedIds` is ONE settled set, an empty/absent
 * `notPerformedIds` leaves M15 behaviour byte-identical, and M15's frozen
 * (live in-progress row) semantics are unchanged.
 */

import { describe, expect, it } from 'vitest';

import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import { createPlannedWorkout } from '@/domain/entities/planned-workout';
import type { ScheduledWorkout } from '@/domain/entities/training-program';
import {
  generatePlannedSchedule,
  type GeneratePlannedScheduleError,
  type GeneratePlannedScheduleInput,
} from '@/domain/services/planned-schedule';
import {
  createEnrollmentId,
  createScheduledWorkoutId,
  createWorkoutId,
  type EnrollmentId,
  type ScheduledWorkoutId,
} from '@/domain/types/ids';
import type { Result } from '@/domain/types/result';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';
import {
  createTrainingDays,
  Weekday,
  type TrainingDays,
} from '@/domain/value-objects/training-days';

/** Monday 2026-09-28 anchors every scenario: MWF lands on 09-28/09-30/10-02. */
const MONDAY = '2026-09-28';
const WEDNESDAY = '2026-09-30';
const FRIDAY = '2026-10-02';

const MWF = trainingDays(Weekday.Monday, Weekday.Wednesday, Weekday.Friday);

function date(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function trainingDays(...values: ReadonlyArray<number>): TrainingDays {
  const result = createTrainingDays(values);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enrollmentId(value = 'enr-1'): EnrollmentId {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function occurrence(weekNumber: number, orderInWeek: number): ScheduledWorkout {
  const id = createScheduledWorkoutId(`prog-w${weekNumber}-${orderInWeek}`);
  const workoutId = createWorkoutId(`wo-${orderInWeek}`);
  if (!id.ok) throw new Error(id.error.message);
  if (!workoutId.ok) throw new Error(workoutId.error.message);
  return { id: id.data, workoutId: workoutId.data, order: orderInWeek };
}

function occurrenceId(weekNumber: number, orderInWeek: number): ScheduledWorkoutId {
  return occurrence(weekNumber, orderInWeek).id;
}

function plannedWorkout(
  scheduledWorkoutId: ScheduledWorkoutId,
  plannedDate: string,
): PlannedWorkout {
  const result = createPlannedWorkout({
    enrollmentId: 'enr-1',
    scheduledWorkoutId,
    plannedDate: date(plannedDate),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function generate(
  overrides: Partial<GeneratePlannedScheduleInput> = {},
): Result<ReadonlyArray<PlannedWorkout>, GeneratePlannedScheduleError> {
  const base: GeneratePlannedScheduleInput = {
    enrollmentId: enrollmentId(),
    occurrencesInProgramOrder: [occurrence(1, 1), occurrence(1, 2), occurrence(1, 3)],
    trainingDays: MWF,
    today: date(MONDAY),
    completedIds: [],
    inProgressIds: [],
    currentPlan: [],
  };

  return generatePlannedSchedule({ ...base, ...overrides });
}

/** `occurrenceId@plannedDate` lines, so assertions pin identity AND date. */
function lines(
  result: Result<ReadonlyArray<PlannedWorkout>, GeneratePlannedScheduleError>,
): ReadonlyArray<string> {
  if (!result.ok) {
    throw new Error(`unexpected generation failure: ${result.error.code} ${result.error.message}`);
  }
  return result.data.map((item) => `${item.scheduledWorkoutId}@${item.plannedDate}`);
}

describe('generatePlannedSchedule — not-performed occurrences are settled', () => {
  it('produces the M15 schedule when notPerformedIds is absent', () => {
    expect(lines(generate())).toEqual([
      `prog-w1-1@${MONDAY}`,
      `prog-w1-2@${WEDNESDAY}`,
      `prog-w1-3@${FRIDAY}`,
    ]);
  });

  it('produces the same schedule for an empty and an absent notPerformedIds', () => {
    expect(lines(generate({ notPerformedIds: [] }))).toEqual(lines(generate()));
  });

  it('excludes a not-performed occurrence from the generated rows', () => {
    const result = generate({ notPerformedIds: [occurrenceId(1, 2)] });

    expect(lines(result)).toEqual([`prog-w1-1@${MONDAY}`, `prog-w1-3@${WEDNESDAY}`]);
  });

  it('treats completed ∪ not-performed as one settled set', () => {
    const result = generate({
      completedIds: [occurrenceId(1, 1)],
      notPerformedIds: [occurrenceId(1, 3)],
    });

    expect(lines(result)).toEqual([`prog-w1-2@${MONDAY}`]);
  });

  it('fabricates no row at all when every occurrence is settled', () => {
    const result = generate({
      completedIds: [occurrenceId(1, 2)],
      notPerformedIds: [occurrenceId(1, 1), occurrenceId(1, 3)],
    });

    expect(lines(result)).toEqual([]);
  });

  it('ignores a duplicate fact id instead of shifting the schedule', () => {
    const result = generate({ notPerformedIds: [occurrenceId(1, 1), occurrenceId(1, 1)] });

    expect(lines(result)).toEqual([`prog-w1-2@${MONDAY}`, `prog-w1-3@${WEDNESDAY}`]);
  });

  it('keeps M15 frozen semantics: an in-progress row is carried forward verbatim', () => {
    const result = generate({
      inProgressIds: [occurrenceId(1, 1)],
      currentPlan: [plannedWorkout(occurrenceId(1, 1), '2026-09-01')],
      notPerformedIds: [],
    });

    expect(lines(result)).toEqual([
      'prog-w1-1@2026-09-01',
      `prog-w1-2@${MONDAY}`,
      `prog-w1-3@${WEDNESDAY}`,
    ]);
  });

  it('settled outranks frozen: a recorded occurrence with a live row receives no row', () => {
    const result = generate({
      inProgressIds: [occurrenceId(1, 1)],
      currentPlan: [plannedWorkout(occurrenceId(1, 1), '2026-09-01')],
      notPerformedIds: [occurrenceId(1, 1)],
    });

    // The occurrence vanishes entirely (settled) and its historical date is NOT
    // reserved, so the walk starts at the first eligible weekday. The combined
    // fact (live session + record) is unreachable in a healthy run — recording
    // deletes a zero-set session and a session with logged work refuses
    // recording — so this pins the precedence rule, not a live state.
    expect(lines(result)).toEqual([`prog-w1-2@${MONDAY}`, `prog-w1-3@${WEDNESDAY}`]);
  });
});
