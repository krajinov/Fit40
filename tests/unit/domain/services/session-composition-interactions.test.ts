/**
 * M11 Slice 5 stabilization: provenance, occurrenceKey and the
 * nextOccurrenceKey high-water mark must survive every M9/M10 occurrence
 * mutation untouched.
 *
 * `source` and `occurrenceKey` are attributes OF the occurrence and travel with
 * it; `nextOccurrenceKey` is session state that only Add advances. The
 * business locator (`exerciseOrder`) stays the only mutable address.
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
import { moveSessionExercise } from '@/domain/services/session-exercise-reorder';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import {
  restoreSessionExercise,
  substituteSessionExercise,
} from '@/domain/services/session-exercise-substitution';
import { unskipSessionExercise } from '@/domain/services/session-exercise-skip';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }

/**
 * Template occurrences ex-001 (order 1) and ex-002 (order 2), then ONE
 * user-added occurrence (ex-100 at order 3, occurrenceKey 3, mark 4).
 */
function sessionWithUserAdded(): WorkoutSession {
  const created = createWorkoutSession({
    id: 't-interactions',
    userId: uid('user-1'),
    enrollmentId: null,
    scheduledWorkoutId: sid('s-1'),
    workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
      { authoredExerciseId: eid('ex-002'), order: 2, prescription: rep(), restSeconds: 60 },
    ],
  });
  if (!created.ok) throw Error();
  const added = addSessionExercise(created.data, {
    exerciseId: eid('ex-100'),
    prescription: rep(),
    restSeconds: 0,
  });
  if (!added.ok) throw Error(added.error.message);
  return added.data;
}

/** The occurrence carrying `exerciseOrder` in the returned aggregate. */
function at(session: WorkoutSession, exerciseOrder: number) {
  const log = session.exerciseLogs.find((entry) => entry.order === exerciseOrder);
  if (log === undefined) throw Error(`missing occurrence at order ${exerciseOrder}`);
  return log;
}

const USER_ADDED = { order: 3, key: 3, mark: 4 } as const;

describe('M11 provenance / identity across M9 substitution and restore', () => {
  it('keeps source, occurrenceKey and the high-water mark through substitute then restore', () => {
    const before = sessionWithUserAdded();

    const substituted = substituteSessionExercise(before, {
      exerciseOrder: 3,
      replacementExerciseId: eid('ex-999'),
    });
    if (!substituted.ok) throw Error(substituted.error.message);

    const afterSub = at(substituted.data, 3);
    // The authored identity is the exercise the USER added; substitution only
    // rewrites the performed identity.
    expect(afterSub.authoredExerciseId).toBe('ex-100');
    expect(afterSub.performedExerciseId).toBe('ex-999');
    expect(afterSub.source).toBe(OccurrenceSource.UserAdded);
    expect(afterSub.occurrenceKey).toBe(USER_ADDED.key);
    expect(substituted.data.nextOccurrenceKey).toBe(USER_ADDED.mark);

    const restored = restoreSessionExercise(substituted.data, { exerciseOrder: 3 });
    if (!restored.ok) throw Error(restored.error.message);

    const afterRestore = at(restored.data, 3);
    expect(afterRestore.performedExerciseId).toBe('ex-100');
    expect(afterRestore.authoredExerciseId).toBe('ex-100');
    expect(afterRestore.source).toBe(OccurrenceSource.UserAdded);
    expect(afterRestore.occurrenceKey).toBe(USER_ADDED.key);
    expect(restored.data.nextOccurrenceKey).toBe(USER_ADDED.mark);
  });

  it('keeps the ORIGINALLY added exercise as authored through a chained substitution', () => {
    const first = substituteSessionExercise(sessionWithUserAdded(), {
      exerciseOrder: 3,
      replacementExerciseId: eid('ex-998'),
    });
    if (!first.ok) throw Error(first.error.message);
    const second = substituteSessionExercise(first.data, {
      exerciseOrder: 3,
      replacementExerciseId: eid('ex-999'),
    });
    if (!second.ok) throw Error(second.error.message);

    const chained = at(second.data, 3);
    expect(chained.authoredExerciseId).toBe('ex-100');
    expect(chained.performedExerciseId).toBe('ex-999');
    expect(chained.source).toBe(OccurrenceSource.UserAdded);

    const restored = restoreSessionExercise(second.data, { exerciseOrder: 3 });
    if (!restored.ok) throw Error(restored.error.message);
    // Restore returns to the exercise the user ADDED — never to a substitute.
    expect(at(restored.data, 3).performedExerciseId).toBe('ex-100');
  });

  it('substituting one user-added occurrence of a duplicated exercise leaves the other untouched', () => {
    const twice = addSessionExercise(sessionWithUserAdded(), {
      exerciseId: eid('ex-100'),
      prescription: rep(),
      restSeconds: 0,
    });
    if (!twice.ok) throw Error(twice.error.message);
    // Two identical user-added occurrences: orders 3 and 4, keys 3 and 4.
    expect(twice.data.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2, 3, 4]);

    const swapped = substituteSessionExercise(twice.data, {
      exerciseOrder: 3,
      replacementExerciseId: eid('ex-999'),
    });
    if (!swapped.ok) throw Error(swapped.error.message);

    expect(at(swapped.data, 3).performedExerciseId).toBe('ex-999');
    expect(at(swapped.data, 3).occurrenceKey).toBe(3);
    expect(at(swapped.data, 4).performedExerciseId).toBe('ex-100');
    expect(at(swapped.data, 4).occurrenceKey).toBe(4);
    expect(swapped.data.nextOccurrenceKey).toBe(5);
  });
});

describe('M11 provenance / identity across M10 reorder, skip and unskip', () => {
  it('carries source and occurrenceKey with the occurrence through a move', () => {
    const moved = moveSessionExercise(sessionWithUserAdded(), {
      exerciseOrder: 3,
      direction: 'up',
    });
    if (!moved.ok) throw Error(moved.error.message);

    // The user-added occurrence physically moved to order 2, keeping its token
    // and provenance; the template occurrence it swapped with kept its own.
    const movedLog = at(moved.data, 2);
    expect(movedLog.performedExerciseId).toBe('ex-100');
    expect(movedLog.source).toBe(OccurrenceSource.UserAdded);
    expect(movedLog.occurrenceKey).toBe(USER_ADDED.key);

    const displaced = at(moved.data, 3);
    expect(displaced.performedExerciseId).toBe('ex-002');
    expect(displaced.occurrenceKey).toBe(2);
    // Reordering never touches the high-water mark.
    expect(moved.data.nextOccurrenceKey).toBe(USER_ADDED.mark);
  });

  it('keeps source, occurrenceKey and the high-water mark through skip then unskip', () => {
    const skipped = skipSessionExercise(sessionWithUserAdded(), { exerciseOrder: 3 });
    if (!skipped.ok) throw Error(skipped.error.message);

    const skippedLog = at(skipped.data, 3);
    expect(skippedLog.isSkipped).toBe(true);
    expect(skippedLog.source).toBe(OccurrenceSource.UserAdded);
    expect(skippedLog.occurrenceKey).toBe(USER_ADDED.key);
    expect(skipped.data.nextOccurrenceKey).toBe(USER_ADDED.mark);

    const unskipped = unskipSessionExercise(skipped.data, { exerciseOrder: 3 });
    if (!unskipped.ok) throw Error(unskipped.error.message);

    const unskippedLog = at(unskipped.data, 3);
    expect(unskippedLog.isSkipped).toBe(false);
    expect(unskippedLog.source).toBe(OccurrenceSource.UserAdded);
    expect(unskippedLog.occurrenceKey).toBe(USER_ADDED.key);
    expect(unskipped.data.nextOccurrenceKey).toBe(USER_ADDED.mark);
  });

  it('keeps provenance frozen on a completed session', () => {
    const logged = logSessionSet(sessionWithUserAdded(), {
      exerciseOrder: 3,
      type: 'reps',
      reps: 12,
      weightKg: 10,
      rpe: null,
    });
    if (!logged.ok) throw Error(logged.error.message);
    const completed = completeWorkoutSession(logged.data, new Date('2025-01-01T11:00:00Z'));
    if (!completed.ok) throw Error(completed.error.message);

    const frozen = at(completed.data, 3);
    expect(frozen.source).toBe(OccurrenceSource.UserAdded);
    expect(frozen.occurrenceKey).toBe(USER_ADDED.key);
    expect(frozen.sets).toHaveLength(1);
    expect(completed.data.nextOccurrenceKey).toBe(USER_ADDED.mark);
  });
});
