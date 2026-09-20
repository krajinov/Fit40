/**
 * Tests for the session-exercise-reorder domain service (M10, PR #13
 * Finding 2 split): adjacent moves (first/middle/last), boundary failures,
 * dense canonical orders, whole-unit travel (sets/skip/substitution ride
 * along), duplicate-id distinctness, and the agreement between the move
 * guards and the eligibility projection. The shared blocking rules are
 * tested in `occurrence-adjustment-rules.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { resolveOccurrenceAdjustmentEligibility } from '@/domain/services/occurrence-adjustment-rules';
import { moveSessionExercise, type MoveDirection } from '@/domain/services/session-exercise-reorder';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import { substituteSessionExercise } from '@/domain/services/session-exercise-substitution';
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

/** A three-occurrence session (ex-001/002/003 at orders 1..3) for move tests. */
function threeSession(): WorkoutSession {
  const r = createWorkoutSession({
    id: 't3', userId: uid('user-1'), enrollmentId: null,
    scheduledWorkoutId: sid('s-1'), workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
      { authoredExerciseId: eid('ex-002'), order: 2, prescription: rep(), restSeconds: 75 },
      { authoredExerciseId: eid('ex-003'), order: 3, prescription: dur(), restSeconds: 90 },
    ],
  });
  if (!r.ok) throw Error();
  return r.data;
}

/** ThreeSession with two logged sets on the middle occurrence (ex-002, order 2). */
function withSetsOnOrder2(): WorkoutSession {
  const first = logSessionSet(threeSession(), { exerciseOrder: 2, type: 'reps', reps: 8, weightKg: 40, rpe: null });
  if (!first.ok) throw Error();
  const second = logSessionSet(first.data, { exerciseOrder: 2, type: 'reps', reps: 10, weightKg: 45, rpe: null });
  if (!second.ok) throw Error();
  return second.data;
}

describe('moveSessionExercise', () => {
  it('physically reorders the array so position agrees with order', () => {
    const before = threeSession();
    const r = moveSessionExercise(before, { exerciseOrder: 2, direction: 'up' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // The returned aggregate itself is canonical — asserted directly with
    // no re-sorting: array position agrees with order
    // (exerciseLogs[index].order === index + 1), and the mover physically
    // precedes its former neighbor.
    expect(r.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    expect(r.data.exerciseLogs.map((e) => [e.order, e.authoredExerciseId])).toEqual([
      [1, 'ex-002'],
      [2, 'ex-001'],
      [3, 'ex-003'],
    ]);

    // The input session is never mutated — the move rearranged a copy, not
    // the source aggregate.
    expect(before.exerciseLogs.map((e) => [e.order, e.authoredExerciseId])).toEqual([
      [1, 'ex-001'],
      [2, 'ex-002'],
      [3, 'ex-003'],
    ]);
  });

  it('moves the whole occurrence — logged sets included — as one unit', () => {
    const r = moveSessionExercise(withSetsOnOrder2(), { exerciseOrder: 2, direction: 'down' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // Canonical: positions agree with orders after the move, and the mover
    // physically sits at index 2 (order 3).
    expect(r.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    expect(r.data.exerciseLogs.map((e) => e.authoredExerciseId)).toEqual([
      'ex-001',
      'ex-003',
      'ex-002',
    ]);
    // The mover carries both of its sets to the new order.
    const moved = r.data.exerciseLogs.find((e) => e.authoredExerciseId === eid('ex-002'));
    expect(moved?.order).toBe(3);
    expect(moved?.sets).toHaveLength(2);
    // The neighbor it swapped with is untouched — sets never reassign.
    const neighbor = r.data.exerciseLogs.find((e) => e.authoredExerciseId === eid('ex-003'));
    expect(neighbor?.order).toBe(2);
    expect(neighbor?.sets).toEqual([]);
  });

  it('carries the skip decision with the occurrence', () => {
    const skipped = skipSessionExercise(threeSession(), { exerciseOrder: 3 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;

    const r = moveSessionExercise(skipped.data, { exerciseOrder: 3, direction: 'up' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    const moved = r.data.exerciseLogs.find((e) => e.order === 2);
    expect(moved?.isSkipped).toBe(true);
    expect(moved?.authoredExerciseId).toBe('ex-003');
  });

  it('moves a substituted occurrence with its performed identity intact', () => {
    const substituted = substituteSessionExercise(threeSession(), {
      exerciseOrder: 2,
      replacementExerciseId: eid('ex-009'),
    });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;

    const r = moveSessionExercise(substituted.data, { exerciseOrder: 2, direction: 'up' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    const moved = r.data.exerciseLogs.find((e) => e.order === 1);
    expect(moved?.authoredExerciseId).toBe('ex-002');
    expect(moved?.performedExerciseId).toBe('ex-009');
  });

  it('leaves the version token and the non-swapped occurrences untouched', () => {
    const s = threeSession();
    const r = moveSessionExercise(s, { exerciseOrder: 1, direction: 'down' });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.version).toBe(s.version);
    expect(r.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2, 3]);
    const untouched = r.data.exerciseLogs.find((e) => e.order === 3);
    expect(untouched?.authoredExerciseId).toBe('ex-003');
    expect(untouched?.restSeconds).toBe(90);
  });


  it('rejects a completed session before the occurrence lookup (guard order)', () => {
    const r = moveSessionExercise(completedSession(), { exerciseOrder: 99, direction: 'up' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('rejects an unknown occurrence order before the boundary check', () => {
    const r = moveSessionExercise(session(), { exerciseOrder: 99, direction: 'up' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('rejects moving the first occurrence up and the last down', () => {
    const up = moveSessionExercise(threeSession(), { exerciseOrder: 1, direction: 'up' });
    expect(up.ok).toBe(false);
    if (up.ok) return;
    expect(up.error.code).toBe('MOVE_OUT_OF_RANGE');

    const down = moveSessionExercise(threeSession(), { exerciseOrder: 3, direction: 'down' });
    expect(down.ok).toBe(false);
    if (down.ok) return;
    expect(down.error.code).toBe('MOVE_OUT_OF_RANGE');
  });

  it('agrees with the eligibility projection on every move guard outcome', () => {
    const cases: ReadonlyArray<{
      readonly session: WorkoutSession;
      readonly order: number;
      readonly direction: MoveDirection;
      readonly expectMove: boolean;
    }> = [
      { session: threeSession(), order: 1, direction: 'up', expectMove: false },
      { session: threeSession(), order: 1, direction: 'down', expectMove: true },
      { session: threeSession(), order: 2, direction: 'up', expectMove: true },
      { session: threeSession(), order: 3, direction: 'down', expectMove: false },
      // Logged sets never block a move — the whole occurrence swaps as one unit.
      { session: withSetsOnOrder2(), order: 2, direction: 'down', expectMove: true },
      // Only completion freezes reordering.
      { session: completedSession(), order: 1, direction: 'down', expectMove: false },
    ];

    for (const { session: s, order, direction, expectMove } of cases) {
      const log = s.exerciseLogs.find((e) => e.order === order);
      if (log === undefined) throw Error();
      const eligibility = resolveOccurrenceAdjustmentEligibility(s, log);
      const movable = direction === 'up' ? eligibility.canMoveUp : eligibility.canMoveDown;
      const move = moveSessionExercise(s, { exerciseOrder: order, direction });

      // The projection and the mutation guard must never disagree.
      expect(move.ok).toBe(movable);
      expect(movable).toBe(expectMove);

      // Every successful move returns a canonical aggregate: array position
      // agrees with order for every occurrence (index + 1).
      if (move.ok) {
        expect(move.data.exerciseLogs.map((e) => e.order)).toEqual(
          Array.from({ length: move.data.exerciseLogs.length }, (_, index) => index + 1),
        );
      }
    }
  });

  it('treats two duplicate-exercise occurrences as distinct occurrences', () => {
    // The same exercise authored twice with identical prescription and rest:
    // the ONLY discriminator before a move is exerciseOrder. A move targets
    // the occurrence at the given order, never "the exercise with that id",
    // and the two occurrences never merge or exchange state.
    const r = createWorkoutSession({
      id: 't-dup', userId: uid('user-1'), enrollmentId: null,
      scheduledWorkoutId: sid('s-1'), workoutId: wid('w-1'),
      startedAt: new Date('2025-01-01T10:00:00Z'),
      exerciseLogs: [
        { authoredExerciseId: eid('ex-same'), order: 1, prescription: rep(), restSeconds: 60 },
        { authoredExerciseId: eid('ex-same'), order: 2, prescription: rep(), restSeconds: 60 },
      ],
    });
    if (!r.ok) throw Error();
    const duplicate = r.data;

    // Only the second duplicate carries a set, so the swap is observable.
    const withSet = logSessionSet(duplicate, { exerciseOrder: 2, type: 'reps', reps: 10, weightKg: null, rpe: null });
    if (!withSet.ok) throw Error();

    const moved = moveSessionExercise(withSet.data, { exerciseOrder: 2, direction: 'up' });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    expect(moved.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2]);
    // The set traveled with ITS occurrence to order 1 — the identical
    // sibling at order 2 stayed empty.
    expect(moved.data.exerciseLogs[0]?.order).toBe(1);
    expect(moved.data.exerciseLogs[0]?.sets).toHaveLength(1);
    expect(moved.data.exerciseLogs[1]?.order).toBe(2);
    expect(moved.data.exerciseLogs[1]?.sets).toEqual([]);
  });
});



  it('two COMPLETELY IDENTICAL duplicate occurrences keep distinct stable keys through a swap (PR #13 Finding 1)', () => {
    // The exact case no composite render key can solve: the same exercise
    // authored twice with identical prescription AND identical rest, both
    // untouched. Every persisted column except exercise_order is equal.
    // The stable occurrenceKey is the only thing distinguishing them, and it
    // must TRAVEL WITH its occurrence through the swap.
    const r = createWorkoutSession({
      id: 't-identical', userId: uid('user-1'), enrollmentId: null,
      scheduledWorkoutId: sid('s-1'), workoutId: wid('w-1'),
      startedAt: new Date('2025-01-01T10:00:00Z'),
      exerciseLogs: [
        { authoredExerciseId: eid('ex-same'), order: 1, prescription: rep(), restSeconds: 60 },
        { authoredExerciseId: eid('ex-same'), order: 2, prescription: rep(), restSeconds: 60 },
      ],
    });
    if (!r.ok) throw Error();

    // Creation default: keys are the creation orders, distinct.
    expect(r.data.exerciseLogs.map((e) => e.occurrenceKey)).toEqual([1, 2]);

    // Swap the two identical duplicates.
    const moved = moveSessionExercise(r.data, { exerciseOrder: 2, direction: 'up' });
    expect(moved.ok).toBe(true);
    if (!moved.ok) return;

    // Orders swapped: dense 1..N canonical.
    expect(moved.data.exerciseLogs.map((e) => e.order)).toEqual([1, 2]);
    // The occurrence that WAS order 2 (key 2) now sits at order 1 — its key
    // traveled with it — and the occurrence that WAS order 1 (key 1) is now
    // at order 2. The keys remain distinct and unchanged in value.
    expect(moved.data.exerciseLogs.map((e) => [e.order, e.occurrenceKey])).toEqual([
      [1, 2],
      [2, 1],
    ]);
    expect(new Set(moved.data.exerciseLogs.map((e) => e.occurrenceKey)).size).toBe(2);
  });
