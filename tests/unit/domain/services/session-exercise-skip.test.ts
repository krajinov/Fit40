/**
 * Tests for the session-exercise-skip domain service (M10, PR #13 Finding 2
 * split): the skip/unskip lifecycle, the logged-set block, and the
 * no-change outcomes. The shared blocking rules and eligibility projection
 * are tested in `occurrence-adjustment-rules.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { skipSessionExercise, unskipSessionExercise } from '@/domain/services/session-exercise-skip';
import { createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function dur() { const r = createDurationScheme(3, 30); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }

function session(): WorkoutSession {
  const r = createWorkoutSession({
    id: 't', userId: uid('user-1'), enrollmentId: null,
    scheduledWorkoutId: sid('s-1'), workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
      { authoredExerciseId: eid('ex-002'), order: 2, prescription: dur(), restSeconds: 90 },
    ],
  });
  if (!r.ok) throw Error();
  return r.data;
}

function withSetOnOrder1(): WorkoutSession {
  const r = logSessionSet(session(), { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
  if (!r.ok) throw Error();
  return r.data;
}

function completedSession(): WorkoutSession {
  const completed = completeWorkoutSession(withSetOnOrder1(), new Date('2025-01-01T11:00:00Z'));
  if (!completed.ok) throw Error();
  return completed.data;
}

describe('skipSessionExercise', () => {
  it('flips only the persisted skip flag, keeping the occurrence contract', () => {
    const s = session();
    const r = skipSessionExercise(s, { exerciseOrder: 1 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const skipped = r.data.exerciseLogs[0];
    expect(skipped?.isSkipped).toBe(true);
    // The authored/performed identity, prescription, rest and order survive.
    expect(skipped?.authoredExerciseId).toBe('ex-001');
    expect(skipped?.performedExerciseId).toBe('ex-001');
    expect(skipped?.prescription).toEqual(rep());
    expect(skipped?.restSeconds).toBe(60);
    expect(skipped?.order).toBe(1);
    expect(skipped?.sets).toEqual([]);
  });

  it('leaves other occurrences and the version token untouched', () => {
    const s = session();
    const r = skipSessionExercise(s, { exerciseOrder: 1 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.version).toBe(s.version);
    expect(r.data.exerciseLogs[1]?.isSkipped).toBe(false);
  });

  it('rejects an already-skipped occurrence as a no-change', () => {
    const skipped = skipSessionExercise(session(), { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;

    const r = skipSessionExercise(skipped.data, { exerciseOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ADJUSTMENT_NO_CHANGE');
  });

  it('rejects an occurrence containing any logged set', () => {
    const r = skipSessionExercise(withSetOnOrder1(), { exerciseOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');
  });

  it('rejects a completed session', () => {
    const r = skipSessionExercise(completedSession(), { exerciseOrder: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('rejects an unknown occurrence order', () => {
    const r = skipSessionExercise(session(), { exerciseOrder: 99 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });
});

describe('unskipSessionExercise', () => {
  it('reverts a skipped occurrence to not-skipped', () => {
    const skipped = skipSessionExercise(session(), { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;

    const r = unskipSessionExercise(skipped.data, { exerciseOrder: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[0]?.isSkipped).toBe(false);
    // Logging is possible again immediately after the unskip.
    const logged = logSessionSet(r.data, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(logged.ok).toBe(true);
  });

  it('rejects a not-skipped occurrence as a no-change', () => {
    const r = unskipSessionExercise(session(), { exerciseOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ADJUSTMENT_NO_CHANGE');
  });

  it('rejects a completed session', () => {
    const first = skipSessionExercise(session(), { exerciseOrder: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const logged = logSessionSet(first.data, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    const completed = completeWorkoutSession(logged.data, new Date());
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    const r = unskipSessionExercise(completed.data, { exerciseOrder: 2 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('rejects an unknown occurrence order', () => {
    const r = unskipSessionExercise(session(), { exerciseOrder: 99 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });
});
