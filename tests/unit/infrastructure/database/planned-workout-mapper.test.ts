/**
 * M15 Slice 2 — planned-workout mapper contract.
 *
 * The database is trusted structurally, so the mapper's job is to fail loudly
 * on corruption instead of normalizing it, and to keep the calendar date a
 * canonical `YYYY-MM-DD` string in both directions.
 */

import { describe, expect, it } from 'vitest';

import {
  mapPlannedWorkoutToRow,
  mapRowToPlannedWorkout,
} from '@/infrastructure/database/mappers/planned-workout-mapper';

function row(overrides: Partial<{ enrollmentId: string; scheduledWorkoutId: string; plannedDate: string }> = {}) {
  return {
    enrollmentId: 'enr-1',
    scheduledWorkoutId: 'prog-w1-1',
    plannedDate: '2026-09-28',
    ...overrides,
  };
}

describe('mapRowToPlannedWorkout', () => {
  it('reconstructs the domain entity with the date still a string', () => {
    const planned = mapRowToPlannedWorkout(row());

    expect(planned.enrollmentId).toBe('enr-1');
    expect(planned.scheduledWorkoutId).toBe('prog-w1-1');
    expect(planned.plannedDate).toBe('2026-09-28');
    expect(typeof planned.plannedDate).toBe('string');
  });

  it('fails loudly on a malformed date instead of normalizing it', () => {
    expect(() => mapRowToPlannedWorkout(row({ plannedDate: '2026-9-28' }))).toThrow(/Corrupt data/);
  });

  it('fails loudly on an impossible calendar date', () => {
    expect(() => mapRowToPlannedWorkout(row({ plannedDate: '2026-02-30' }))).toThrow(/Corrupt data/);
  });

  it('fails loudly on an empty enrollment id', () => {
    expect(() => mapRowToPlannedWorkout(row({ enrollmentId: '   ' }))).toThrow(/Corrupt data/);
  });

  it('fails loudly on an empty scheduled workout id', () => {
    expect(() => mapRowToPlannedWorkout(row({ scheduledWorkoutId: '' }))).toThrow(/Corrupt data/);
  });
});

describe('mapPlannedWorkoutToRow', () => {
  it('writes the canonical string unchanged', () => {
    const mapped = mapPlannedWorkoutToRow(
      mapRowToPlannedWorkout(row({ plannedDate: '2026-12-31' })),
    );

    expect(mapped).toEqual({
      enrollmentId: 'enr-1',
      scheduledWorkoutId: 'prog-w1-1',
      plannedDate: '2026-12-31',
    });
  });
});
