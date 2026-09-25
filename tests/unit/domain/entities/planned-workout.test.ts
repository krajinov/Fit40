/**
 * M15 Slice 1 — PlannedWorkout entity contract: composite identity
 * (enrollmentId, scheduledWorkoutId), construction invariants, and the pure
 * reschedule operation.
 */

import { describe, expect, it } from 'vitest';

import {
  createPlannedWorkout,
  reschedulePlannedWorkout,
  type PlannedWorkout,
} from '@/domain/entities/planned-workout';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';

function date(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function plannedWorkout(input?: {
  readonly enrollmentId?: string;
  readonly scheduledWorkoutId?: string;
  readonly plannedDate?: PlannedDate;
}): PlannedWorkout {
  const result = createPlannedWorkout({
    enrollmentId: input?.enrollmentId ?? 'enr-1',
    scheduledWorkoutId: input?.scheduledWorkoutId ?? 'prog-w1-1',
    plannedDate: input?.plannedDate ?? date('2026-09-28'),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('createPlannedWorkout', () => {
  it('constructs a valid planned workout', () => {
    const result = createPlannedWorkout({
      enrollmentId: 'enr-1',
      scheduledWorkoutId: 'prog-w1-1',
      plannedDate: date('2026-09-28'),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.enrollmentId).toBe('enr-1');
      expect(result.data.scheduledWorkoutId).toBe('prog-w1-1');
      expect(result.data.plannedDate).toBe('2026-09-28');
    }
  });

  it('rejects an empty enrollment id', () => {
    const result = createPlannedWorkout({
      enrollmentId: '',
      scheduledWorkoutId: 'prog-w1-1',
      plannedDate: date('2026-09-28'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PLANNED_WORKOUT');
      expect(result.error.field).toBe('enrollmentId');
    }
  });

  it('rejects an empty scheduled workout id', () => {
    const result = createPlannedWorkout({
      enrollmentId: 'enr-1',
      scheduledWorkoutId: '   ',
      plannedDate: date('2026-09-28'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PLANNED_WORKOUT');
      expect(result.error.field).toBe('scheduledWorkoutId');
    }
  });
});

describe('reschedulePlannedWorkout', () => {
  it('returns a new value with the new date and leaves the original untouched', () => {
    const original = plannedWorkout({ plannedDate: date('2026-09-28') });

    const moved = reschedulePlannedWorkout(original, date('2026-10-02'));

    expect(moved).not.toBe(original);
    expect(moved.plannedDate).toBe('2026-10-02');
    expect(moved.enrollmentId).toBe(original.enrollmentId);
    expect(moved.scheduledWorkoutId).toBe(original.scheduledWorkoutId);
    expect(original.plannedDate).toBe('2026-09-28');
  });

  it('moving to the current date yields an equal value', () => {
    const original = plannedWorkout({ plannedDate: date('2026-09-28') });

    const moved = reschedulePlannedWorkout(original, date('2026-09-28'));

    expect(moved).toEqual(original);
  });
});
