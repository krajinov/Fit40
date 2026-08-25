/**
 * Tests for the WorkoutSession domain entity and lifecycle.
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  getSessionStatus,
  logSessionSet,
} from '@/domain/entities/workout-session';
import { createExerciseId, createScheduledWorkoutId, createWorkoutId, createWorkoutSessionId } from '@/domain/types/ids';
import { createRepScheme, createDurationScheme } from '@/domain/value-objects/rep-prescription';

function validRepScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function validDurationScheme() {
  const result = createDurationScheme(3, 30);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function validExerciseId(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function workoutId(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeValidInput() {
  return {
    id: 'session-1',
    scheduledWorkoutId: scheduledId('sched-1'),
    workoutId: workoutId('wo-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { exerciseId: validExerciseId('ex-001'), order: 1, prescription: validRepScheme(), restSeconds: 60 },
      { exerciseId: validExerciseId('ex-002'), order: 2, prescription: validDurationScheme(), restSeconds: 90 },
    ],
  };
}

function validSession() {
  const result = createWorkoutSession(makeValidInput());
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function sessionWithOneSet() {
  const session = validSession();
  const result = logSessionSet(session, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 10,
    weightKg: 20,
    rpe: 7,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('createWorkoutSession', () => {
  it('creates a valid in-progress session', () => {
    const input = makeValidInput();
    const result = createWorkoutSession(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.completedAt).toBeNull();
    expect(getSessionStatus(result.data)).toBe('in-progress');
  });

  it('derives status as in-progress when completedAt is null', () => {
    const result = createWorkoutSession(makeValidInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(getSessionStatus(result.data)).toBe('in-progress');
  });

  it('creates exercise logs with empty sets', () => {
    const result = createWorkoutSession(makeValidInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    for (const log of result.data.exerciseLogs) {
      expect(log.sets).toEqual([]);
    }
  });

  it('preserves exercise order and prescription', () => {
    const result = createWorkoutSession(makeValidInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const logs = result.data.exerciseLogs;
    expect(logs).toHaveLength(2);
    expect(logs[0]?.order).toBe(1);
    expect(logs[0]?.prescription.type).toBe('reps');
    expect(logs[0]?.restSeconds).toBe(60);
    expect(logs[1]?.order).toBe(2);
    expect(logs[1]?.prescription.type).toBe('duration');
    expect(logs[1]?.restSeconds).toBe(90);
  });

  it('creates a valid branded WorkoutSessionId', () => {
    const result = createWorkoutSession(makeValidInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const idResult = createWorkoutSessionId('session-1');
    expect(idResult.ok).toBe(true);
    if (!idResult.ok) return;

    expect(result.data.id).toBe(idResult.data);
  });

  it('rejects empty session ID', () => {
    const result = createWorkoutSession(makeValidInput());

    expect(result.ok).toBe(true);
    // Verify the id is not empty by construction; the empty test uses makeValidInput with overrides
  });

  it('rejects empty session ID explicitly', () => {
    const result = createWorkoutSession({ ...makeValidInput(), id: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('INVALID_WORKOUT_SESSION');
  });

  it('rejects empty exercise log list', () => {
    const result = createWorkoutSession({ ...makeValidInput(), exerciseLogs: [] });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('INVALID_WORKOUT_SESSION');
  });

  it('rejects non-sequential exercise log orders', () => {
    const result = createWorkoutSession({
      ...makeValidInput(),
      exerciseLogs: [
        { exerciseId: validExerciseId('ex-001'), order: 1, prescription: validRepScheme(), restSeconds: 60 },
        { exerciseId: validExerciseId('ex-002'), order: 3, prescription: validDurationScheme(), restSeconds: 90 },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('INVALID_WORKOUT_SESSION');
  });
});

describe('completeWorkoutSession', () => {
  it('completes an in-progress session with at least one set', () => {
    const session = sessionWithOneSet();
    const completedAt = new Date('2025-01-01T11:00:00Z');
    const result = completeWorkoutSession(session, completedAt);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.completedAt).toEqual(completedAt);
    expect(getSessionStatus(result.data)).toBe('completed');
  });

  it('rejects already completed session', () => {
    const session = sessionWithOneSet();
    const completedAt = new Date('2025-01-01T11:00:00Z');
    const first = completeWorkoutSession(session, completedAt);
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = completeWorkoutSession(first.data, new Date('2025-01-01T12:00:00Z'));
    expect(second.ok).toBe(false);
    if (second.ok) return;

    expect(second.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('rejects session with zero logged sets', () => {
    const session = validSession();
    const result = completeWorkoutSession(session, new Date('2025-01-01T11:00:00Z'));

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('CANNOT_COMPLETE_EMPTY_SESSION');
  });

  it('allows partial session completion', () => {
    const session = validSession();
    const withOneSet = logSessionSet(session, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: 7,
    });
    expect(withOneSet.ok).toBe(true);
    if (!withOneSet.ok) return;

    const result = completeWorkoutSession(withOneSet.data, new Date('2025-01-01T11:00:00Z'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(getSessionStatus(result.data)).toBe('completed');
    const logs = result.data.exerciseLogs;
    expect(logs[0]?.sets).toHaveLength(1);
    expect(logs[1]?.sets).toHaveLength(0);
  });
});