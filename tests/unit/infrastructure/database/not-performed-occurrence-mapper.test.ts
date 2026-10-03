/**
 * M17 Slice 3 — not-performed-occurrence mapper contract.
 *
 * The database is trusted structurally, so the mapper's job is to fail loudly on
 * corruption instead of normalizing it. `not_performed_workouts` is NOT NULL on
 * every column and keyed by the composite primary key, so the corruption cases
 * here (empty ids, an invalid instant) can only arrive by bypassing the schema —
 * which is exactly why they must throw rather than be repaired.
 */

import { describe, expect, it } from 'vitest';

import { mapRowToNotPerformedOccurrence } from '@/infrastructure/database/mappers/not-performed-occurrence-mapper';

function row(
  overrides: Partial<{
    enrollmentId: string;
    scheduledWorkoutId: string;
    recordedAt: Date;
  }> = {},
) {
  return {
    enrollmentId: 'enr-1',
    scheduledWorkoutId: 'prog-w1-1',
    recordedAt: new Date('2026-09-28T18:30:00.000Z'),
    ...overrides,
  };
}

describe('mapRowToNotPerformedOccurrence', () => {
  it('reconstructs the domain fact with its recorded instant', () => {
    const fact = mapRowToNotPerformedOccurrence(row());

    expect(fact.enrollmentId).toBe('enr-1');
    expect(fact.scheduledWorkoutId).toBe('prog-w1-1');
    expect(fact.recordedAt.toISOString()).toBe('2026-09-28T18:30:00.000Z');
  });

  it('carries exactly the three fact fields', () => {
    expect(Object.keys(mapRowToNotPerformedOccurrence(row())).sort()).toEqual([
      'enrollmentId',
      'recordedAt',
      'scheduledWorkoutId',
    ]);
  });

  it('fails loudly on an empty enrollment id', () => {
    expect(() => mapRowToNotPerformedOccurrence(row({ enrollmentId: '   ' }))).toThrow(
      /Corrupt data/,
    );
  });

  it('fails loudly on an empty scheduled workout id', () => {
    expect(() => mapRowToNotPerformedOccurrence(row({ scheduledWorkoutId: '' }))).toThrow(
      /Corrupt data/,
    );
  });

  it('fails loudly on an invalid recorded instant', () => {
    expect(() => mapRowToNotPerformedOccurrence(row({ recordedAt: new Date('not-an-instant') }))).toThrow(
      /Corrupt data/,
    );
  });
});