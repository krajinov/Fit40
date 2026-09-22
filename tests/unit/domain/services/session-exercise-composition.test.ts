/**
 * Tests for the session-exercise-composition domain service (M11 Slice 2):
 * `addSessionExercise` appends one user-added occurrence to an in-progress
 * session. Covers the append position, provenance, identity, the monotonic
 * occurrence-key high-water mark, duplicate-exercise support, verbatim
 * prescription/rest persistence, the empty set list, and the completed-session
 * block. Removal is a later slice and is not covered here.
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  OccurrenceSource,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { addSessionExercise } from '@/domain/services/session-exercise-composition';
import { createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function repTarget(sets: number, target: number) { const r = createRepScheme(sets, target, target); if (!r.ok) throw Error(); return r.data; }
function dur(sets: number, seconds: number) { const r = createDurationScheme(sets, seconds); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }

/** A session with `count` template occurrences (ex-001..), orders 1..count. */
function session(count = 1): WorkoutSession {
  const r = createWorkoutSession({
    id: `t-${count}`,
    userId: uid('user-1'),
    enrollmentId: null,
    scheduledWorkoutId: sid('s-1'),
    workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: Array.from({ length: count }, (_, index) => ({
      authoredExerciseId: eid(`ex-00${index + 1}`),
      order: index + 1,
      prescription: rep(),
      restSeconds: 60,
    })),
  });
  if (!r.ok) throw Error();
  return r.data;
}

/**
 * A two-occurrence session whose occurrence keys are NOT the creation order
 * and whose high-water mark is above both, so a new key must come from the
 * mark rather than from the order or the maximum surviving key.
 */
function sessionWithShiftedKeys(): WorkoutSession {
  const r = createWorkoutSession({
    id: 't-keys',
    userId: uid('user-1'),
    enrollmentId: null,
    scheduledWorkoutId: sid('s-1'),
    workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60, occurrenceKey: 7 },
      { authoredExerciseId: eid('ex-002'), order: 2, prescription: rep(), restSeconds: 90, occurrenceKey: 3 },
    ],
    nextOccurrenceKey: 8,
  });
  if (!r.ok) throw Error();
  return r.data;
}

function completedSession(): WorkoutSession {
  const logged = logSessionSet(session(1), {
    exerciseOrder: 1,
    type: 'reps',
    reps: 10,
    weightKg: 20,
    rpe: null,
  });
  if (!logged.ok) throw Error();
  const completed = completeWorkoutSession(logged.data, new Date('2025-01-01T11:00:00Z'));
  if (!completed.ok) throw Error();
  return completed.data;
}

describe('addSessionExercise — append', () => {
  it('appends one occurrence at canonical order N + 1 of a single-occurrence session', () => {
    const before = session(1);
    const r = addSessionExercise(before, { exerciseId: eid('ex-100'), prescription: rep(), restSeconds: 0 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs).toHaveLength(2);
    expect(r.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    // Canonical: array position agrees with order.
    r.data.exerciseLogs.forEach((log, index) => expect(log.order).toBe(index + 1));
  });

  it('appends at N + 1 of a multi-occurrence session without disturbing the others', () => {
    const before = session(3);
    const r = addSessionExercise(before, { exerciseId: eid('ex-200'), prescription: rep(), restSeconds: 0 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3, 4]);
    // Every pre-existing occurrence survives untouched, in order.
    expect(r.data.exerciseLogs.slice(0, 3).map((log) => log.authoredExerciseId)).toEqual([
      'ex-001',
      'ex-002',
      'ex-003',
    ]);
    expect(r.data.exerciseLogs[3]?.authoredExerciseId).toBe('ex-200');
  });

  it('does not mutate the source aggregate', () => {
    const before = session(1);
    const logsBefore = before.exerciseLogs.length;
    const markBefore = before.nextOccurrenceKey;

    addSessionExercise(before, { exerciseId: eid('ex-100'), prescription: rep(), restSeconds: 0 });

    expect(before.exerciseLogs).toHaveLength(logsBefore);
    expect(before.nextOccurrenceKey).toBe(markBefore);
  });
});

describe('addSessionExercise — occurrence shape', () => {
  it('marks the occurrence user-added, performed-as-authored and not skipped', () => {
    const r = addSessionExercise(session(1), {
      exerciseId: eid('ex-100'),
      prescription: rep(),
      restSeconds: 0,
    });
    if (!r.ok) throw Error();

    const added = r.data.exerciseLogs[1];
    expect(added?.source).toBe(OccurrenceSource.UserAdded);
    expect(added?.authoredExerciseId).toBe('ex-100');
    expect(added?.performedExerciseId).toBe('ex-100');
    expect(added?.isSkipped).toBe(false);
    expect(added?.sets).toEqual([]);
  });

  it('persists the explicit prescription verbatim', () => {
    const prescription = repTarget(4, 6);
    const r = addSessionExercise(session(1), {
      exerciseId: eid('ex-100'),
      prescription,
      restSeconds: 0,
    });
    if (!r.ok) throw Error();

    expect(r.data.exerciseLogs[1]?.prescription).toEqual({ type: 'reps', sets: 4, minReps: 6, maxReps: 6 });
  });

  it('persists a duration prescription verbatim', () => {
    const prescription = dur(2, 45);
    const r = addSessionExercise(session(1), {
      exerciseId: eid('ex-100'),
      prescription,
      restSeconds: 0,
    });
    if (!r.ok) throw Error();

    expect(r.data.exerciseLogs[1]?.prescription).toEqual({ type: 'duration', sets: 2, seconds: 45 });
  });

  it('persists the supplied rest snapshot', () => {
    const r = addSessionExercise(session(1), {
      exerciseId: eid('ex-100'),
      prescription: rep(),
      restSeconds: 0,
    });
    if (!r.ok) throw Error();

    expect(r.data.exerciseLogs[1]?.restSeconds).toBe(0);
  });
});

describe('addSessionExercise — occurrence key high-water mark', () => {
  it('takes the fresh occurrence key from nextOccurrenceKey and advances the mark once', () => {
    const before = session(1); // keys [1], mark 2
    expect(before.nextOccurrenceKey).toBe(2);

    const r = addSessionExercise(before, { exerciseId: eid('ex-100'), prescription: rep(), restSeconds: 0 });
    if (!r.ok) throw Error();

    expect(r.data.exerciseLogs[1]?.occurrenceKey).toBe(2);
    expect(r.data.nextOccurrenceKey).toBe(3);
  });

  it('uses the mark rather than the order or the maximum surviving key', () => {
    const before = sessionWithShiftedKeys(); // keys [7, 3], mark 8
    const r = addSessionExercise(before, { exerciseId: eid('ex-100'), prescription: rep(), restSeconds: 0 });
    if (!r.ok) throw Error();

    expect(r.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([7, 3, 8]);
    expect(r.data.nextOccurrenceKey).toBe(9);
  });

  it('leaves every existing occurrence key unchanged', () => {
    const before = sessionWithShiftedKeys();
    const r = addSessionExercise(before, { exerciseId: eid('ex-100'), prescription: rep(), restSeconds: 0 });
    if (!r.ok) throw Error();

    expect(r.data.exerciseLogs.slice(0, 2).map((log) => log.occurrenceKey)).toEqual([7, 3]);
  });

  it('assigns distinct keys to successive adds', () => {
    const first = addSessionExercise(session(1), { exerciseId: eid('ex-100'), prescription: rep(), restSeconds: 0 });
    if (!first.ok) throw Error();
    const second = addSessionExercise(first.data, { exerciseId: eid('ex-101'), prescription: rep(), restSeconds: 0 });
    if (!second.ok) throw Error();

    const keys = second.data.exerciseLogs.map((log) => log.occurrenceKey);
    expect(keys).toEqual([1, 2, 3]);
    expect(new Set(keys).size).toBe(keys.length);
    expect(second.data.nextOccurrenceKey).toBe(4);
  });
});

describe('addSessionExercise — duplicate exercises', () => {
  it('allows adding an exercise already present in the session as a distinct occurrence', () => {
    const before = session(1); // ex-001 at order 1
    const r = addSessionExercise(before, { exerciseId: eid('ex-001'), prescription: rep(), restSeconds: 0 });
    if (!r.ok) throw Error();

    expect(r.data.exerciseLogs).toHaveLength(2);
    expect(r.data.exerciseLogs.map((log) => log.performedExerciseId)).toEqual(['ex-001', 'ex-001']);
    expect(r.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    // Distinct occurrence identity and distinct render tokens.
    expect(r.data.exerciseLogs[0]?.occurrenceKey).not.toBe(r.data.exerciseLogs[1]?.occurrenceKey);
  });

  it('allows adding the same exercise twice in a row', () => {
    const first = addSessionExercise(session(1), { exerciseId: eid('ex-100'), prescription: rep(), restSeconds: 0 });
    if (!first.ok) throw Error();
    const second = addSessionExercise(first.data, { exerciseId: eid('ex-100'), prescription: rep(), restSeconds: 0 });
    if (!second.ok) throw Error();

    expect(second.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3]);
    expect(second.data.exerciseLogs.map((log) => log.performedExerciseId)).toEqual([
      'ex-001',
      'ex-100',
      'ex-100',
    ]);
  });
});

describe('addSessionExercise — completed session', () => {
  it('rejects a completed session with SESSION_ALREADY_COMPLETED', () => {
    const r = addSessionExercise(completedSession(), {
      exerciseId: eid('ex-100'),
      prescription: rep(),
      restSeconds: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });
});
