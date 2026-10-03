/**
 * M17 Slice 1 — NotPerformedOccurrence entity contract: run-scoped composite
 * identity `(enrollmentId, scheduledWorkoutId)`, the recorded instant, and
 * construction invariants.
 */

import { describe, expect, it } from 'vitest';

import {
  createNotPerformedOccurrence,
  type NotPerformedOccurrence,
} from '@/domain/entities/not-performed-occurrence';

const RECORDED_AT = '2026-09-28T18:30:00.000Z';

function occurrence(input?: {
  readonly enrollmentId?: string;
  readonly scheduledWorkoutId?: string;
  readonly recordedAt?: Date;
}): NotPerformedOccurrence {
  const result = createNotPerformedOccurrence({
    enrollmentId: input?.enrollmentId ?? 'enr-1',
    scheduledWorkoutId: input?.scheduledWorkoutId ?? 'prog-w1-1',
    recordedAt: input?.recordedAt ?? new Date(RECORDED_AT),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('createNotPerformedOccurrence', () => {
  it('constructs a valid not-performed occurrence', () => {
    const result = createNotPerformedOccurrence({
      enrollmentId: 'enr-1',
      scheduledWorkoutId: 'prog-w1-1',
      recordedAt: new Date(RECORDED_AT),
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.enrollmentId).toBe('enr-1');
      expect(result.data.scheduledWorkoutId).toBe('prog-w1-1');
      expect(result.data.recordedAt.toISOString()).toBe(RECORDED_AT);
    }
  });

  it('carries no other field: the fact is identity plus the recorded instant', () => {
    expect(Object.keys(occurrence()).sort()).toEqual([
      'enrollmentId',
      'recordedAt',
      'scheduledWorkoutId',
    ]);
  });

  it('preserves the run identity, so the same occurrence in two runs is two facts', () => {
    const first = occurrence({ enrollmentId: 'enr-1' });
    const rejoined = occurrence({ enrollmentId: 'enr-2' });

    expect(first.enrollmentId).toBe('enr-1');
    expect(rejoined.enrollmentId).toBe('enr-2');
    expect(first.scheduledWorkoutId).toBe(rejoined.scheduledWorkoutId);
    expect(first).not.toEqual(rejoined);
  });

  it('preserves the authored occurrence identity', () => {
    const first = occurrence({ scheduledWorkoutId: 'prog-w1-1' });
    const second = occurrence({ scheduledWorkoutId: 'prog-w2-4' });

    expect(first.scheduledWorkoutId).toBe('prog-w1-1');
    expect(second.scheduledWorkoutId).toBe('prog-w2-4');
  });

  it('preserves the recorded instant exactly, including sub-second precision', () => {
    const recorded = new Date('2026-09-28T18:30:00.123Z');

    expect(occurrence({ recordedAt: recorded }).recordedAt.toISOString()).toBe(
      '2026-09-28T18:30:00.123Z',
    );
  });

  it('rejects an empty enrollment id', () => {
    const result = createNotPerformedOccurrence({
      enrollmentId: '   ',
      scheduledWorkoutId: 'prog-w1-1',
      recordedAt: new Date(RECORDED_AT),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_NOT_PERFORMED_OCCURRENCE');
      expect(result.error.field).toBe('enrollmentId');
    }
  });

  it('rejects an empty scheduled workout id', () => {
    const result = createNotPerformedOccurrence({
      enrollmentId: 'enr-1',
      scheduledWorkoutId: '',
      recordedAt: new Date(RECORDED_AT),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_NOT_PERFORMED_OCCURRENCE');
      expect(result.error.field).toBe('scheduledWorkoutId');
    }
  });

  it('rejects a missing recorded instant', () => {
    const result = createNotPerformedOccurrence({
      enrollmentId: 'enr-1',
      scheduledWorkoutId: 'prog-w1-1',
      recordedAt: undefined as unknown as Date,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_NOT_PERFORMED_OCCURRENCE');
      expect(result.error.field).toBe('recordedAt');
    }
  });

  it('rejects an invalid recorded instant', () => {
    const result = createNotPerformedOccurrence({
      enrollmentId: 'enr-1',
      scheduledWorkoutId: 'prog-w1-1',
      recordedAt: new Date('not-an-instant'),
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_NOT_PERFORMED_OCCURRENCE');
      expect(result.error.field).toBe('recordedAt');
    }
  });
});
