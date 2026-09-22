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
import {
  addSessionExercise,
  removeSessionExercise,
  resolveOccurrenceRemovalEligibility,
} from '@/domain/services/session-exercise-composition';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import { substituteSessionExercise } from '@/domain/services/session-exercise-substitution';
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

// ─── M11 removal ─────────────────────────────────────────────────────────────

/** A `count`-occurrence template session with ONE appended user-added occurrence. */
function withUserAdded(count = 2, exerciseId = 'ex-100'): WorkoutSession {
  const r = addSessionExercise(session(count), {
    exerciseId: eid(exerciseId),
    prescription: rep(),
    restSeconds: 0,
  });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function skipOrder(target: WorkoutSession, exerciseOrder: number): WorkoutSession {
  const r = skipSessionExercise(target, { exerciseOrder });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function substituteOrder(target: WorkoutSession, exerciseOrder: number, replacement: string): WorkoutSession {
  const r = substituteSessionExercise(target, {
    exerciseOrder,
    replacementExerciseId: eid(replacement),
  });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function logSetOn(target: WorkoutSession, exerciseOrder: number): WorkoutSession {
  const r = logSessionSet(target, {
    exerciseOrder,
    type: 'reps',
    reps: 10,
    weightKg: 20,
    rpe: null,
  });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

describe('removeSessionExercise — happy path', () => {
  it('removes a user-added zero-set occurrence and leaves the survivors dense and canonical', () => {
    // Template orders 1..2, user-added at order 3.
    const before = withUserAdded(2);
    expect(before.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3]);

    const r = removeSessionExercise(before, { exerciseOrder: 3 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs).toHaveLength(2);
    expect(r.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    // Canonical: array position agrees with order.
    r.data.exerciseLogs.forEach((log, index) => expect(log.order).toBe(index + 1));
    expect(r.data.exerciseLogs.some((log) => log.source === OccurrenceSource.UserAdded)).toBe(false);
  });

  it('renumbers a middle removal so trailing orders stay dense', () => {
    // A(order 1, template), B(order 2, user-added), C(order 3, user-added).
    const first = withUserAdded(1); // ex-001 + ex-100
    const second = addSessionExercise(first, {
      exerciseId: eid('ex-200'),
      prescription: rep(),
      restSeconds: 0,
    });
    if (!second.ok) throw Error();
    const before = second.data;
    expect(before.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3]);
    expect(before.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2, 3]);

    const r = removeSessionExercise(before, { exerciseOrder: 2 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // C moved from order 3 to order 2 but KEEPS its occurrenceKey 3.
    expect(r.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    expect(r.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 3]);
    expect(r.data.exerciseLogs.map((log) => log.performedExerciseId)).toEqual(['ex-001', 'ex-200']);
  });

  it('never mutates the source aggregate', () => {
    const before = withUserAdded(2);
    const ordersBefore = before.exerciseLogs.map((log) => log.order);
    const keysBefore = before.exerciseLogs.map((log) => log.occurrenceKey);
    const markBefore = before.nextOccurrenceKey;

    removeSessionExercise(before, { exerciseOrder: 3 });

    expect(before.exerciseLogs.map((log) => log.order)).toEqual(ordersBefore);
    expect(before.exerciseLogs.map((log) => log.occurrenceKey)).toEqual(keysBefore);
    expect(before.nextOccurrenceKey).toBe(markBefore);
  });

  it('leaves nextOccurrenceKey untouched (removed keys are never reusable)', () => {
    const before = withUserAdded(2); // keys 1,2,3; mark 4
    expect(before.nextOccurrenceKey).toBe(4);

    const removed = removeSessionExercise(before, { exerciseOrder: 3 });
    if (!removed.ok) throw Error();

    expect(removed.data.nextOccurrenceKey).toBe(4);

    // The next Add takes the HIGH-WATER key (4), never the removed key (3).
    const reAdded = addSessionExercise(removed.data, {
      exerciseId: eid('ex-101'),
      prescription: rep(),
      restSeconds: 0,
    });
    if (!reAdded.ok) throw Error();
    expect(reAdded.data.exerciseLogs.at(-1)?.occurrenceKey).toBe(4);
    expect(reAdded.data.exerciseLogs.at(-1)?.occurrenceKey).not.toBe(3);
    expect(reAdded.data.nextOccurrenceKey).toBe(5);
  });

  it('removes a SKIPPED user-added occurrence directly, without an unskip', () => {
    const skipped = skipOrder(withUserAdded(1), 2);
    expect(skipped.exerciseLogs[1]?.isSkipped).toBe(true);

    const r = removeSessionExercise(skipped, { exerciseOrder: 2 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs).toHaveLength(1);
  });

  it('removes a SUBSTITUTED user-added occurrence directly, without a restore', () => {
    const substituted = substituteOrder(withUserAdded(1), 2, 'ex-999');
    expect(substituted.exerciseLogs[1]?.performedExerciseId).toBe('ex-999');

    const r = removeSessionExercise(substituted, { exerciseOrder: 2 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs).toHaveLength(1);
  });

  it('handles duplicate ExerciseIds by occurrence, not by exercise identity', () => {
    // ex-001 template, then ex-001 added twice: three identical occurrences.
    const first = withUserAdded(1, 'ex-001');
    const second = addSessionExercise(first, {
      exerciseId: eid('ex-001'),
      prescription: rep(),
      restSeconds: 0,
    });
    if (!second.ok) throw Error();
    const before = second.data;
    expect(before.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2, 3]);

    const r = removeSessionExercise(before, { exerciseOrder: 2 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The FIRST duplicate (key 2) is gone; the survivor keeps key 3.
    expect(r.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 3]);
    expect(r.data.exerciseLogs.map((log) => log.performedExerciseId)).toEqual([
      'ex-001',
      'ex-001',
    ]);
  });
});

describe('removeSessionExercise — guards', () => {
  it('rejects an unknown occurrence order', () => {
    const r = removeSessionExercise(withUserAdded(2), { exerciseOrder: 99 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
    if (r.error.code !== 'EXERCISE_LOG_NOT_FOUND') return;
    expect(r.error.exerciseOrder).toBe(99);
  });

  it('rejects a template-authored occurrence with EXERCISE_NOT_REMOVABLE', () => {
    const r = removeSessionExercise(withUserAdded(2), { exerciseOrder: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_NOT_REMOVABLE');
  });

  it('rejects a user-added occurrence with logged sets', () => {
    const r = removeSessionExercise(logSetOn(withUserAdded(1), 2), { exerciseOrder: 2 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');
    if (r.error.code !== 'EXERCISE_HAS_LOGGED_SETS') return;
    expect(r.error.exerciseOrder).toBe(2);
  });

  it('rejects a completed session before any other rule', () => {
    const withSet = logSetOn(withUserAdded(1), 1);
    const completed = completeWorkoutSession(withSet, new Date('2025-01-01T11:00:00Z'));
    if (!completed.ok) throw Error();

    // Order 2 is a user-added zero-set occurrence: removable while in
    // progress, frozen once the session completes.
    const r = removeSessionExercise(completed.data, { exerciseOrder: 2 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });
});

describe('resolveOccurrenceRemovalEligibility', () => {
  it('agrees with the mutation for every occurrence state', () => {
    const cases: ReadonlyArray<{
      readonly session: WorkoutSession;
      readonly order: number;
    }> = [
      { session: withUserAdded(2), order: 1 }, // template
      { session: withUserAdded(2), order: 3 }, // user-added, zero sets
      { session: logSetOn(withUserAdded(1), 2), order: 2 }, // user-added, logged
      { session: skipOrder(withUserAdded(1), 2), order: 2 }, // user-added, skipped
    ];

    for (const { session: target, order } of cases) {
      const log = target.exerciseLogs.find((entry) => entry.order === order);
      if (log === undefined) throw Error('fixture occurrence missing');
      const eligibility = resolveOccurrenceRemovalEligibility(target, log);
      const mutation = removeSessionExercise(target, { exerciseOrder: order });
      expect(eligibility.canRemove).toBe(mutation.ok);
      if (!eligibility.canRemove) expect(eligibility.blockedBy).not.toBeNull();
      if (eligibility.canRemove) expect(eligibility.blockedBy).toBeNull();
    }
  });

  it('applies the documented block precedence', () => {
    const inProgress = withUserAdded(1);
    const logged = logSetOn(inProgress, 2);

    // session-completed outranks template-authored outranks logged-sets.
    const completedTemplate = completeWorkoutSession(logSetOn(inProgress, 1), new Date('2025-01-01T11:00:00Z'));
    if (!completedTemplate.ok) throw Error();
    const completedTemplateLog = completedTemplate.data.exerciseLogs[0];
    if (completedTemplateLog === undefined) throw Error();
    expect(
      resolveOccurrenceRemovalEligibility(completedTemplate.data, completedTemplateLog).blockedBy,
    ).toBe('session-completed');

    // A template occurrence with logged sets reports provenance, not sets.
    const templateWithSets = logSetOn(inProgress, 1);
    const templateLog = templateWithSets.exerciseLogs[0];
    if (templateLog === undefined) throw Error();
    expect(resolveOccurrenceRemovalEligibility(templateWithSets, templateLog).blockedBy).toBe(
      'template-authored',
    );

    // A user-added occurrence with logged sets reports the set block.
    const loggedLog = logged.exerciseLogs[1];
    if (loggedLog === undefined) throw Error();
    expect(resolveOccurrenceRemovalEligibility(logged, loggedLog).blockedBy).toBe('logged-sets');

    // Removable state.
    const removableLog = inProgress.exerciseLogs[1];
    if (removableLog === undefined) throw Error();
    expect(resolveOccurrenceRemovalEligibility(inProgress, removableLog)).toEqual({
      canRemove: true,
      blockedBy: null,
    });
  });
});
