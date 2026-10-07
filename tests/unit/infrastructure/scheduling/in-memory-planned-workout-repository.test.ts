/**
 * M15 Slice 2 — InMemoryPlannedWorkoutRepository contract.
 *
 * Mirrors the Drizzle adapter's observable single-threaded semantics:
 * deterministic ordering, whole-set replacement, the port's invariant errors
 * before any mutation, `false` for a missing row, and PlannedDateConflictError
 * for an occupied date. Enrollment-existence outcomes are deliberately not
 * modelled (see the class documentation): PostgreSQL is their authority.
 */

import { describe, expect, it } from 'vitest';

import {
  PlannedDateConflictError,
  PlannedWorkoutEnrollmentMismatchError,
  PlannedWorkoutSetConflictError,
} from '@/application/ports/planned-workout-repository';
import { createPlannedWorkout, type PlannedWorkout } from '@/domain/entities/planned-workout';
import {
  createEnrollmentId,
  createScheduledWorkoutId,
  type EnrollmentId,
  type ScheduledWorkoutId,
} from '@/domain/types/ids';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';
import { InMemoryPlannedWorkoutRepository } from '@/infrastructure/scheduling/in-memory-planned-workout-repository';

const OWNER_RUN = enrollmentId('enr-1');
const OTHER_RUN = enrollmentId('enr-2');

function enrollmentId(value: string): EnrollmentId {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledWorkoutId(value: string): ScheduledWorkoutId {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function plannedDate(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function plannedWorkout(
  enrollmentId: string,
  scheduledWorkoutId: string,
  plannedDateValue: string,
): PlannedWorkout {
  const result = createPlannedWorkout({
    enrollmentId,
    scheduledWorkoutId,
    plannedDate: plannedDate(plannedDateValue),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function line(row: PlannedWorkout): string {
  return `${row.scheduledWorkoutId}@${row.plannedDate}`;
}

const W1_1 = plannedWorkout(OWNER_RUN, 'prog-w1-1', '2026-09-28');
const W1_2 = plannedWorkout(OWNER_RUN, 'prog-w1-2', '2026-09-30');
const W2_1 = plannedWorkout(OWNER_RUN, 'prog-w2-1', '2026-10-05');

/** Deliberately supplied out of calendar order. */
const SET = [W2_1, W1_2, W1_1];

/** The same set in the adapter's deterministic read order. */
const SET_LINES = ['prog-w1-1@2026-09-28', 'prog-w1-2@2026-09-30', 'prog-w2-1@2026-10-05'];

describe('InMemoryPlannedWorkoutRepository — reads', () => {
  it('returns an empty list for a run with no planning', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();

    expect(await repo.listByEnrollment(OWNER_RUN)).toEqual([]);
  });

  it('reads back the stored set in deterministic calendar order', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);

    expect((await repo.listByEnrollment(OWNER_RUN)).map(line)).toEqual(SET_LINES);
  });

  it('never exposes stored state to callers', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);

    const listed = await repo.listByEnrollment(OWNER_RUN);
    const first = listed[0];
    if (first === undefined) throw new Error('expected a stored row');
    (first as { plannedDate: string }).plannedDate = '1999-01-01';

    expect((await repo.listByEnrollment(OWNER_RUN))[0]?.plannedDate).toBe('2026-09-28');
  });

  it('keeps runs isolated', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);

    expect(await repo.listByEnrollment(OTHER_RUN)).toEqual([]);
  });
});

describe('InMemoryPlannedWorkoutRepository — replaceAllForEnrollment', () => {
  it('replaces the entire set', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);

    const replaced = await repo.replaceAllForEnrollment(OWNER_RUN, [
      plannedWorkout(OWNER_RUN, 'prog-w1-3', '2026-10-02'),
    ]);

    expect(replaced).toBe(true);
    expect((await repo.listByEnrollment(OWNER_RUN)).map(line)).toEqual(['prog-w1-3@2026-10-02']);
  });

  it('accepts an empty set and clears the run', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);

    expect(await repo.replaceAllForEnrollment(OWNER_RUN, [])).toBe(true);
    expect(await repo.listByEnrollment(OWNER_RUN)).toEqual([]);
  });

  it('rejects a cross-enrollment row before mutating anything', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);
    const foreign = plannedWorkout(OTHER_RUN, 'prog-w1-1', '2026-11-01');

    await expect(repo.replaceAllForEnrollment(OWNER_RUN, [foreign])).rejects.toBeInstanceOf(
      PlannedWorkoutEnrollmentMismatchError,
    );

    expect((await repo.listByEnrollment(OWNER_RUN)).map(line)).toEqual(SET_LINES);
  });

  it('rejects a duplicated occurrence before mutating anything', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    const duplicated = [
      plannedWorkout(OWNER_RUN, 'prog-w1-1', '2026-09-28'),
      plannedWorkout(OWNER_RUN, 'prog-w1-1', '2026-09-30'),
    ];

    await expect(repo.replaceAllForEnrollment(OWNER_RUN, duplicated)).rejects.toBeInstanceOf(
      PlannedWorkoutSetConflictError,
    );
    expect(await repo.listByEnrollment(OWNER_RUN)).toEqual([]);
  });

  it('rejects two occurrences on one date before mutating anything', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    const conflicting = [
      plannedWorkout(OWNER_RUN, 'prog-w1-1', '2026-09-28'),
      plannedWorkout(OWNER_RUN, 'prog-w1-2', '2026-09-28'),
    ];

    await expect(repo.replaceAllForEnrollment(OWNER_RUN, conflicting)).rejects.toBeInstanceOf(
      PlannedWorkoutSetConflictError,
    );
    expect(await repo.listByEnrollment(OWNER_RUN)).toEqual([]);
  });

  it('does not model enrollment existence (documented boundary)', async () => {
    // The fake cannot observe program_enrollments, so a vanished run is not
    // detected here; PostgreSQL integration tests are the authority for the
    // `false` lifecycle outcome.
    const repo = new InMemoryPlannedWorkoutRepository();

    expect(await repo.replaceAllForEnrollment(OWNER_RUN, SET)).toBe(true);
  });
});

describe('InMemoryPlannedWorkoutRepository — reschedule', () => {
  it('moves one row immutably and leaves the rest untouched', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);
    const snapshotBefore = (await repo.listByEnrollment(OWNER_RUN)).map(line);

    const moved = await repo.reschedule(
      OWNER_RUN,
      W1_1.scheduledWorkoutId,
      plannedDate('2026-10-07'),
    );

    expect(moved).toBe(true);
    expect((await repo.listByEnrollment(OWNER_RUN)).map(line)).toEqual([
      'prog-w1-2@2026-09-30',
      'prog-w2-1@2026-10-05',
      'prog-w1-1@2026-10-07',
    ]);
    // The snapshot the caller already held is untouched (cloned isolation).
    expect(snapshotBefore).toEqual(SET_LINES);
  });

  it('throws PlannedDateConflictError for an occupied date', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);
    const w1_1 = W1_1.scheduledWorkoutId;

    await expect(repo.reschedule(OWNER_RUN, w1_1, plannedDate('2026-09-30'))).rejects.toBeInstanceOf(
      PlannedDateConflictError,
    );

    expect((await repo.listByEnrollment(OWNER_RUN)).map(line)).toEqual(SET_LINES);
  });

  it('returns false for a row this run does not plan, without writing', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();
    await repo.replaceAllForEnrollment(OWNER_RUN, SET);

    expect(await repo.reschedule(OWNER_RUN, scheduledWorkoutId('prog-w9-9'), plannedDate('2026-10-09'))).toBe(
      false,
    );
    expect((await repo.listByEnrollment(OWNER_RUN)).map(line)).toEqual(SET_LINES);
  });

  it('returns false for a run with no planning', async () => {
    const repo = new InMemoryPlannedWorkoutRepository();

    expect(await repo.reschedule(OTHER_RUN, scheduledWorkoutId('prog-w1-1'), plannedDate('2026-10-09'))).toBe(
      false,
    );
  });
});
