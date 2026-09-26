/**
 * M15 Slice 1 — deterministic planned-schedule generation contract.
 *
 * Covers the locked partition (completed / frozen / open), occupied-date
 * reservation, the candidate walk, and edge cases A–G, plus determinism,
 * uniqueness of generated dates, output ordering and the enrollment guard.
 */

import { describe, expect, it } from 'vitest';

import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import { createPlannedWorkout } from '@/domain/entities/planned-workout';
import type { ScheduledWorkout } from '@/domain/entities/training-program';
import {
  firstEligiblePlannedDate,
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
  WEEKDAY_VALUES,
  type TrainingDays,
} from '@/domain/value-objects/training-days';

const PROGRAM_SLUG = 'prog';

/** Monday 2026-09-28 anchors every scenario: MWF lands on 09-28/09-30/10-02. */
const MONDAY = '2026-09-28';
const WEDNESDAY = '2026-09-30';
const FRIDAY = '2026-10-02';
const NEXT_MONDAY = '2026-10-05';
const NEXT_WEDNESDAY = '2026-10-07';

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
  const id = createScheduledWorkoutId(`${PROGRAM_SLUG}-w${weekNumber}-${orderInWeek}`);
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
  owner = 'enr-1',
): PlannedWorkout {
  const result = createPlannedWorkout({
    enrollmentId: owner,
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

describe('firstEligiblePlannedDate', () => {
  it('is today when today is a selected weekday', () => {
    const result = firstEligiblePlannedDate(date(MONDAY), MWF);

    expect(result.ok && result.data).toBe(MONDAY);
  });

  it('is the next selected weekday when today is not selected', () => {
    const tuesday = firstEligiblePlannedDate(date('2026-09-29'), MWF);
    const saturday = firstEligiblePlannedDate(date('2026-10-03'), MWF);

    expect(tuesday.ok && tuesday.data).toBe(WEDNESDAY);
    expect(saturday.ok && saturday.data).toBe(NEXT_MONDAY);
  });

  it('is today for any weekday when every day is selected', () => {
    const everyDay = trainingDays(...WEEKDAY_VALUES);

    for (const value of [MONDAY, '2026-09-29', WEDNESDAY, '2026-10-04']) {
      const result = firstEligiblePlannedDate(date(value), everyDay);
      expect(result.ok && result.data).toBe(value);
    }
  });
});

describe('generatePlannedSchedule — candidate walk', () => {
  it('maps authored occurrences onto the selected weekdays in authored order', () => {
    expect(lines(generate())).toEqual([
      `prog-w1-1@${MONDAY}`,
      `prog-w1-2@${WEDNESDAY}`,
      `prog-w1-3@${FRIDAY}`,
    ]);
  });

  it('starts at today when today is a selected weekday', () => {
    const result = generate();
    if (!result.ok) throw new Error(result.error.message);

    expect(result.data[0]?.plannedDate).toBe(MONDAY);
  });

  it('starts at the next selected weekday when today is not selected', () => {
    expect(lines(generate({ today: date('2026-09-29') }))).toEqual([
      `prog-w1-1@${WEDNESDAY}`,
      `prog-w1-2@${FRIDAY}`,
      `prog-w1-3@${NEXT_MONDAY}`,
    ]);
  });

  it('keeps the candidate sequence across a week boundary', () => {
    const result = generate({
      occurrencesInProgramOrder: [
        occurrence(1, 1),
        occurrence(1, 2),
        occurrence(1, 3),
        occurrence(2, 1),
      ],
    });

    expect(lines(result)).toEqual([
      `prog-w1-1@${MONDAY}`,
      `prog-w1-2@${WEDNESDAY}`,
      `prog-w1-3@${FRIDAY}`,
      `prog-w2-1@${NEXT_MONDAY}`,
    ]);
  });

  it('produces no row for a completed occurrence', () => {
    const result = generate({ completedIds: [occurrenceId(1, 1)] });

    expect(lines(result)).toEqual([`prog-w1-2@${MONDAY}`, `prog-w1-3@${WEDNESDAY}`]);
  });

  it('allows a narrower selection than the program cadence', () => {
    const twoDays = trainingDays(Weekday.Tuesday, Weekday.Thursday);

    expect(lines(generate({ trainingDays: twoDays }))).toEqual([
      `prog-w1-1@2026-09-29`,
      `prog-w1-2@2026-10-01`,
      `prog-w1-3@2026-10-06`,
    ]);
  });
});

describe('generatePlannedSchedule — frozen in-progress rows', () => {
  it('(A) keeps a frozen row on its historical date before today, verbatim', () => {
    const existing = plannedWorkout(occurrenceId(1, 1), '2026-09-20');
    const result = generate({
      inProgressIds: [occurrenceId(1, 1)],
      currentPlan: [existing],
    });
    if (!result.ok) throw new Error(result.error.message);

    const frozen = result.data.find((item) => item.scheduledWorkoutId === occurrenceId(1, 1));

    expect(frozen).toBe(existing); // carried through as the same value
    expect(lines(result)).toEqual([
      'prog-w1-1@2026-09-20',
      `prog-w1-2@${MONDAY}`,
      `prog-w1-3@${WEDNESDAY}`,
    ]);
  });

  it('(B) reserves a frozen date that is a newly selected weekday', () => {
    const result = generate({
      inProgressIds: [occurrenceId(1, 2)],
      currentPlan: [plannedWorkout(occurrenceId(1, 2), WEDNESDAY)],
    });

    // Wednesday is spent on the frozen row, so the third open occurrence skips
    // it and lands on Friday instead of colliding.
    expect(lines(result)).toEqual([
      `prog-w1-1@${MONDAY}`,
      `prog-w1-2@${WEDNESDAY}`,
      `prog-w1-3@${FRIDAY}`,
    ]);
  });

  it('(C) keeps a frozen row on a non-selected weekday without affecting the walk', () => {
    const result = generate({
      inProgressIds: [occurrenceId(1, 2)],
      currentPlan: [plannedWorkout(occurrenceId(1, 2), '2026-09-29')],
    });

    expect(lines(result)).toEqual([
      `prog-w1-1@${MONDAY}`,
      'prog-w1-2@2026-09-29',
      `prog-w1-3@${WEDNESDAY}`,
    ]);
  });

  it('(D) leaves frozen dates before the first eligible date alone', () => {
    const result = generate({
      inProgressIds: [occurrenceId(1, 1)],
      currentPlan: [plannedWorkout(occurrenceId(1, 1), '2026-09-21')],
    });

    expect(lines(result)).toEqual([
      'prog-w1-1@2026-09-21',
      `prog-w1-2@${MONDAY}`,
      `prog-w1-3@${WEDNESDAY}`,
    ]);
  });

  it('(E) lets authored order and calendar order diverge around a frozen row', () => {
    const frozen = plannedWorkout(occurrenceId(1, 2), MONDAY);
    const result = generate({
      inProgressIds: [occurrenceId(1, 2)],
      currentPlan: [frozen],
    });

    // Authored order still drives assignment (o1 then o3), so the later
    // authored occurrence o2 appears first on the calendar without reshuffling
    // authored program semantics.
    expect(lines(result)).toEqual([
      `prog-w1-2@${MONDAY}`,
      `prog-w1-1@${WEDNESDAY}`,
      `prog-w1-3@${FRIDAY}`,
    ]);
  });
});

describe('generatePlannedSchedule — open rows and occupied dates', () => {
  it('(F) overwrites a never-started manual reschedule and reserves nothing', () => {
    const result = generate({
      currentPlan: [
        plannedWorkout(occurrenceId(1, 1), NEXT_MONDAY),
        plannedWorkout(occurrenceId(1, 2), NEXT_WEDNESDAY),
      ],
    });

    expect(lines(result)).toEqual([
      `prog-w1-1@${MONDAY}`,
      `prog-w1-2@${WEDNESDAY}`,
      `prog-w1-3@${FRIDAY}`,
    ]);
    if (!result.ok) throw new Error(result.error.message);
    const dates = result.data.map((item) => item.plannedDate);
    expect(dates).not.toContain(NEXT_MONDAY);
    expect(dates).not.toContain(NEXT_WEDNESDAY);
  });

  it('(G) treats an in-progress occurrence without a row as open, never inventing a past date', () => {
    const result = generate({ inProgressIds: [occurrenceId(1, 1)], currentPlan: [] });

    expect(lines(result)).toEqual([
      `prog-w1-1@${MONDAY}`,
      `prog-w1-2@${WEDNESDAY}`,
      `prog-w1-3@${FRIDAY}`,
    ]);
    if (!result.ok) throw new Error(result.error.message);
    for (const item of result.data) {
      expect(item.plannedDate >= MONDAY).toBe(true);
    }
  });

  it('never assigns two rows the same date and never collides with a frozen date', () => {
    const result = generate({
      occurrencesInProgramOrder: [
        occurrence(1, 1),
        occurrence(1, 2),
        occurrence(1, 3),
        occurrence(2, 1),
        occurrence(2, 2),
        occurrence(2, 3),
      ],
      completedIds: [occurrenceId(1, 3)],
      inProgressIds: [occurrenceId(1, 2), occurrenceId(2, 1)],
      currentPlan: [
        plannedWorkout(occurrenceId(1, 2), WEDNESDAY),
        plannedWorkout(occurrenceId(2, 1), NEXT_WEDNESDAY),
      ],
    });
    if (!result.ok) throw new Error(result.error.message);

    const dates = result.data.map((item) => item.plannedDate);
    expect(new Set(dates).size).toBe(dates.length);
    expect(lines(result)).toEqual([
      `prog-w1-1@${MONDAY}`,
      `prog-w1-2@${WEDNESDAY}`,
      `prog-w2-2@${FRIDAY}`,
      `prog-w2-3@${NEXT_MONDAY}`,
      `prog-w2-1@${NEXT_WEDNESDAY}`,
    ]);

    const frozenIds = new Set([occurrenceId(1, 2), occurrenceId(2, 1)]);
    for (const item of result.data) {
      if (!frozenIds.has(item.scheduledWorkoutId)) {
        expect(item.plannedDate).not.toBe(WEDNESDAY);
        expect(item.plannedDate).not.toBe(NEXT_WEDNESDAY);
      }
    }
  });
});

describe('generatePlannedSchedule — terminal and defensive cases', () => {
  it('returns an empty schedule when every occurrence is completed', () => {
    const result = generate({
      completedIds: [occurrenceId(1, 1), occurrenceId(1, 2), occurrenceId(1, 3)],
    });

    expect(lines(result)).toEqual([]);
  });

  it('returns only the frozen rows when nothing is open', () => {
    const result = generate({
      completedIds: [occurrenceId(1, 2), occurrenceId(1, 3)],
      inProgressIds: [occurrenceId(1, 1)],
      currentPlan: [plannedWorkout(occurrenceId(1, 1), '2026-09-20')],
    });

    expect(lines(result)).toEqual(['prog-w1-1@2026-09-20']);
  });

  it('is deterministic and independent of the current plan ordering', () => {
    const plan = [
      plannedWorkout(occurrenceId(1, 2), NEXT_WEDNESDAY),
      plannedWorkout(occurrenceId(1, 1), NEXT_MONDAY),
    ];

    const first = lines(generate({ currentPlan: plan }));
    const second = lines(generate({ currentPlan: plan }));
    const reversed = lines(generate({ currentPlan: [...plan].reverse() }));

    expect(second).toEqual(first);
    expect(reversed).toEqual(first);
  });

  it('orders the result by calendar date and breaks a same-date tie by occurrence id', () => {
    const result = generate({
      inProgressIds: [occurrenceId(1, 1), occurrenceId(1, 2)],
      currentPlan: [
        plannedWorkout(occurrenceId(1, 2), WEDNESDAY),
        plannedWorkout(occurrenceId(1, 1), WEDNESDAY),
      ],
    });

    expect(lines(result)).toEqual([
      `prog-w1-3@${MONDAY}`,
      `prog-w1-1@${WEDNESDAY}`,
      `prog-w1-2@${WEDNESDAY}`,
    ]);
  });

  it('rejects a current plan row that belongs to another run', () => {
    const result = generate({
      currentPlan: [plannedWorkout(occurrenceId(1, 1), MONDAY, 'enr-other')],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLANNED_WORKOUT_ENROLLMENT_MISMATCH');
    }
  });

  it('reports a range failure instead of producing a non-canonical date', () => {
    const result = generate({
      today: date('9999-12-31'),
      trainingDays: trainingDays(...WEEKDAY_VALUES),
      occurrencesInProgramOrder: [occurrence(1, 1), occurrence(1, 2)],
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('PLANNED_DATE_RANGE_EXCEEDED');
    }
  });

  it('never evaluates candidate dates when nothing is left to schedule', () => {
    const result = generate({
      today: date('9999-12-31'),
      trainingDays: trainingDays(...WEEKDAY_VALUES),
      completedIds: [occurrenceId(1, 1), occurrenceId(1, 2), occurrenceId(1, 3)],
    });

    expect(lines(result)).toEqual([]);
  });
});
