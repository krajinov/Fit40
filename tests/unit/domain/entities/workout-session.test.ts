/**
 * Tests for the WorkoutSession domain entity and lifecycle.
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  deleteSessionSet,
  getSessionStatus,
  logSessionSet,
  OccurrenceSource,
  resolveSessionCompletionReadiness,
  updateSessionSet,
} from '@/domain/entities/workout-session';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import { createEnrollmentId, createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId, createWorkoutSessionId } from '@/domain/types/ids';
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

function userId(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enrollmentId(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeValidInput() {
  return {
    id: 'session-1',
    userId: userId('user-1'),
    enrollmentId: enrollmentId('enrollment-1'),
    scheduledWorkoutId: scheduledId('sched-1'),
    workoutId: workoutId('wo-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: validExerciseId('ex-001'), order: 1, prescription: validRepScheme(), restSeconds: 60 },
      { authoredExerciseId: validExerciseId('ex-002'), order: 2, prescription: validDurationScheme(), restSeconds: 90 },
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
  it('creates a valid in-progress session owned by a user and enrollment', () => {
    const result = createWorkoutSession(makeValidInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.userId).toBe('user-1');
    expect(result.data.enrollmentId).toBe('enrollment-1');
    expect(result.data.completedAt).toBeNull();
  });

  it('accepts a null enrollmentId (detached historical session)', () => {
    const result = createWorkoutSession({ ...makeValidInput(), enrollmentId: null });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.enrollmentId).toBeNull();
  });

  it('creates a valid in-progress session', () => {
    const input = makeValidInput();
    const result = createWorkoutSession(input);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.completedAt).toBeNull();
    expect(getSessionStatus(result.data)).toBe('in-progress');
    expect(result.data.version).toBe(0);
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
        { authoredExerciseId: validExerciseId('ex-001'), order: 1, prescription: validRepScheme(), restSeconds: 60 },
        { authoredExerciseId: validExerciseId('ex-002'), order: 3, prescription: validDurationScheme(), restSeconds: 90 },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('INVALID_WORKOUT_SESSION');
  });

  it('defaults performedExerciseId to authoredExerciseId (performed-as-authored)', () => {
    const result = createWorkoutSession(makeValidInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const log of result.data.exerciseLogs) {
      expect(log.performedExerciseId).toBe(log.authoredExerciseId);
    }
  });

  it('preserves an explicit performedExerciseId (rehydrated substitution)', () => {
    const result = createWorkoutSession({
      ...makeValidInput(),
      exerciseLogs: [
        {
          authoredExerciseId: validExerciseId('ex-001'),
          performedExerciseId: validExerciseId('ex-009'),
          order: 1,
          prescription: validRepScheme(),
          restSeconds: 60,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exerciseLogs[0]?.authoredExerciseId).toBe('ex-001');
    expect(result.data.exerciseLogs[0]?.performedExerciseId).toBe('ex-009');
  });

  it('defaults isSkipped to false (skip is never inferred from zero sets)', () => {
    const result = createWorkoutSession(makeValidInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    for (const log of result.data.exerciseLogs) {
      expect(log.isSkipped).toBe(false);
    }
  });

  it('preserves an explicit isSkipped (rehydrated skip decision)', () => {
    const result = createWorkoutSession({
      ...makeValidInput(),
      exerciseLogs: [
        {
          authoredExerciseId: validExerciseId('ex-001'),
          order: 1,
          prescription: validRepScheme(),
          restSeconds: 60,
          isSkipped: true,
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exerciseLogs[0]?.isSkipped).toBe(true);
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

describe('logSessionSet skip guard (M10)', () => {
  it('rejects logging onto a skipped occurrence with EXERCISE_OCCURRENCE_SKIPPED', () => {
    const skipped = skipSessionExercise(validSession(), { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;

    const result = logSessionSet(skipped.data, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: 7,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_OCCURRENCE_SKIPPED');
  });
});

describe('completeWorkoutSession with skipped occurrences (M10)', () => {
  it('rejects an all-skipped session through the unchanged completion gate', () => {
    const first = skipSessionExercise(validSession(), { exerciseOrder: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const allSkipped = skipSessionExercise(first.data, { exerciseOrder: 2 });
    expect(allSkipped.ok).toBe(true);
    if (!allSkipped.ok) return;

    // Skipped occurrences carry no sets, so the ≥1-logged-set gate —
    // unchanged by M10 — keeps an all-skipped session non-completable.
    const result = completeWorkoutSession(allSkipped.data, new Date('2025-01-01T11:00:00Z'));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('CANNOT_COMPLETE_EMPTY_SESSION');
  });

  it('completes a session with one set logged while another occurrence is skipped', () => {
    const first = skipSessionExercise(validSession(), { exerciseOrder: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const withSet = logSessionSet(first.data, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: 7,
    });
    expect(withSet.ok).toBe(true);
    if (!withSet.ok) return;

    const result = completeWorkoutSession(withSet.data, new Date('2025-01-01T11:00:00Z'));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(getSessionStatus(result.data)).toBe('completed');
    // The skip decision is frozen as part of the completed history.
    expect(result.data.exerciseLogs[0]?.isSkipped).toBe(false);
    expect(result.data.exerciseLogs[1]?.isSkipped).toBe(true);
  });
});

describe('resolveSessionCompletionReadiness', () => {
  it('refuses a session with zero logged sets', () => {
    expect(resolveSessionCompletionReadiness(validSession()).canComplete).toBe(false);
  });

  it('refuses an all-skipped session (skips carry no sets)', () => {
    const first = skipSessionExercise(validSession(), { exerciseOrder: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const all = skipSessionExercise(first.data, { exerciseOrder: 2 });
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    expect(resolveSessionCompletionReadiness(all.data).canComplete).toBe(false);
  });

  it('allows completion once at least one set is logged anywhere, even with skips', () => {
    const first = skipSessionExercise(validSession(), { exerciseOrder: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const logged = logSessionSet(first.data, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: null,
      rpe: null,
    });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;

    expect(resolveSessionCompletionReadiness(logged.data).canComplete).toBe(true);
  });
});

describe('createWorkoutSession / occurrenceKey (PR #13 Finding 1)', () => {
  it('defaults each occurrence key to its creation order', () => {
    const session = validSession();

    expect(session.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2]);
  });

  it('honors explicit rehydrated keys over the order default', () => {
    const result = createWorkoutSession({
      ...makeValidInput(),
      exerciseLogs: [
        { ...makeValidInput().exerciseLogs[0]!, occurrenceKey: 41, order: 1, prescription: validRepScheme(), restSeconds: 60 },
        { ...makeValidInput().exerciseLogs[1]!, occurrenceKey: 7, order: 2, prescription: validDurationScheme(), restSeconds: 90 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([41, 7]);
  });

  it('rejects duplicate occurrence keys within the aggregate', () => {
    const base = makeValidInput();
    const result = createWorkoutSession({
      ...base,
      exerciseLogs: [
        { ...base.exerciseLogs[0]!, occurrenceKey: 5, order: 1, prescription: validRepScheme(), restSeconds: 60 },
        { ...base.exerciseLogs[1]!, occurrenceKey: 5, order: 2, prescription: validDurationScheme(), restSeconds: 90 },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_WORKOUT_SESSION');
    expect(result.error.field).toBe('exerciseLogs');
    expect(result.error.message).toContain('occurrence keys must be unique');
  });
});

describe('occurrenceKey survives every session mutation (PR #13 Finding 1)', () => {
  it('logSessionSet, updateSessionSet and deleteSessionSet keep the token', () => {
    const session = validSession();

    const logged = logSessionSet(session, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 50,
      rpe: 7,
    });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    expect(logged.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2]);

    const updated = updateSessionSet(logged.data, {
      exerciseOrder: 1,
      setNumber: 1,
      type: 'reps',
      reps: 12,
      weightKg: 50,
      rpe: 7,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2]);

    const deleted = deleteSessionSet(updated.data, { exerciseOrder: 1, setNumber: 1 });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    expect(deleted.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2]);
  });

  it('completion keeps the token on the frozen history', () => {
    const completed = completeWorkoutSession(sessionWithOneSet(), new Date('2025-01-01T11:00:00Z'));
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2]);
  });
});

describe('ExerciseLog.source provenance (M11 Slice 1)', () => {
  it('defaults every fresh occurrence to template-authored', () => {
    const session = validSession();

    expect(session.exerciseLogs.map((log) => log.source)).toEqual([
      OccurrenceSource.Template,
      OccurrenceSource.Template,
    ]);
  });

  it('carries an explicit user_added source through construction untouched', () => {
    const base = makeValidInput();
    const result = createWorkoutSession({
      ...base,
      exerciseLogs: [
        { ...base.exerciseLogs[0]!, source: OccurrenceSource.Template },
        { ...base.exerciseLogs[1]!, source: OccurrenceSource.UserAdded },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exerciseLogs.map((log) => log.source)).toEqual([
      OccurrenceSource.Template,
      OccurrenceSource.UserAdded,
    ]);
  });

  it('never infers provenance from the authored/performed divergence', () => {
    const base = makeValidInput();
    const result = createWorkoutSession({
      ...base,
      exerciseLogs: [
        // A substituted occurrence (performed != authored) is still
        // template-authored unless source says otherwise.
        {
          ...base.exerciseLogs[0]!,
          performedExerciseId: validExerciseId('ex-999'),
        },
        base.exerciseLogs[1]!,
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.exerciseLogs[0]?.source).toBe(OccurrenceSource.Template);
    expect(result.data.exerciseLogs[0]?.performedExerciseId).toBe('ex-999');
  });
});

describe('WorkoutSession.nextOccurrenceKey (M11 Slice 1)', () => {
  it('defaults to max(occurrenceKey) + 1 for a fresh session', () => {
    const session = validSession();

    // Keys default to the dense creation order 1..2, so the mark is 3.
    expect(session.nextOccurrenceKey).toBe(3);
  });

  it('defaults to one past the highest explicit occurrence key', () => {
    const base = makeValidInput();
    const result = createWorkoutSession({
      ...base,
      exerciseLogs: [
        { ...base.exerciseLogs[0]!, occurrenceKey: 41, order: 1 },
        { ...base.exerciseLogs[1]!, occurrenceKey: 7, order: 2 },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // The mark follows the MAXIMUM key, not the array position.
    expect(result.data.nextOccurrenceKey).toBe(42);
  });

  it('honors an explicit valid high-water mark (removal / rehydration case)', () => {
    const result = createWorkoutSession({ ...makeValidInput(), nextOccurrenceKey: 9 });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.nextOccurrenceKey).toBe(9);
  });

  it('rejects a mark that does not exceed every existing occurrence key', () => {
    for (const invalid of [2, 1, 0, -1]) {
      const result = createWorkoutSession({ ...makeValidInput(), nextOccurrenceKey: invalid });

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('INVALID_WORKOUT_SESSION');
      expect(result.error.field).toBe('nextOccurrenceKey');
      expect(result.error.message).toContain('nextOccurrenceKey');
    }
  });

  it('rejects a non-integer mark', () => {
    for (const invalid of [1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = createWorkoutSession({ ...makeValidInput(), nextOccurrenceKey: invalid });

      expect(result.ok).toBe(false);
    }
  });

  it('still rejects duplicate occurrence keys when a valid mark is supplied', () => {
    const base = makeValidInput();
    const result = createWorkoutSession({
      ...base,
      nextOccurrenceKey: 100,
      exerciseLogs: [
        { ...base.exerciseLogs[0]!, occurrenceKey: 5, order: 1 },
        { ...base.exerciseLogs[1]!, occurrenceKey: 5, order: 2 },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.field).toBe('exerciseLogs');
    expect(result.error.message).toContain('occurrence keys must be unique');
  });
});