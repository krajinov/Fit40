/**
 * Tests for the session-exercise-adjustment domain service (M10): the skip /
 * unskip mutations and their guards, the adjacent-move reordering (and its
 * canonical aggregate contract: array position always agrees with order),
 * the read-only eligibility projection, the skip-adjusted prescription
 * totals, and the completion-readiness gate.
 *
 * The skip⇔sets mutual exclusion is enforced by the domain alone — these
 * tests prove both rejection directions (skip with sets; log onto skipped)
 * together with the factory default, so no supported path can ever produce
 * the invalid combination (there is deliberately no database CHECK for it).
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  resolveSessionCompletionReadiness,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  moveSessionExercise,
  resolveOccurrenceAdjustmentEligibility,
  resolveSessionPrescriptionTotals,
  skipSessionExercise,
  unskipSessionExercise,
  type MoveDirection,
} from '@/domain/services/session-exercise-adjustment';
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
});

describe('resolveOccurrenceAdjustmentEligibility', () => {
  it('reports a mutable, unskipped occurrence as skippable', () => {
    const log = session().exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceAdjustmentEligibility(session(), log)).toEqual({
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      // Order 1 of 2: one neighbor below, none above — moves stay open.
      canMoveUp: false,
      canMoveDown: true,
    });
  });

  it('reports a skipped occurrence as unskippable only', () => {
    const skipped = skipSessionExercise(session(), { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    const log = skipped.data.exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceAdjustmentEligibility(skipped.data, log)).toEqual({
      isSkipped: true,
      blockedBy: null,
      canSkip: false,
      canUnskip: true,
      // The skip decision never blocks a move (order 1 of 2).
      canMoveUp: false,
      canMoveDown: true,
    });
  });

  it('blocks a logged-set occurrence in both directions', () => {
    const log = withSetOnOrder1().exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceAdjustmentEligibility(withSetOnOrder1(), log)).toEqual({
      isSkipped: false,
      blockedBy: 'logged-sets',
      canSkip: false,
      canUnskip: false,
      // Logged sets block skip/unskip only — the occurrence stays movable.
      canMoveUp: false,
      canMoveDown: true,
    });
  });

  it('freezes both directions on a completed session', () => {
    const completed = completedSession();
    const log = completed.exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceAdjustmentEligibility(completed, log)).toEqual({
      isSkipped: false,
      blockedBy: 'session-completed',
      canSkip: false,
      canUnskip: false,
      // Completion freezes reordering too — both move directions die.
      canMoveUp: false,
      canMoveDown: false,
    });
  });

  it('agrees with the mutation guards on every guard outcome', () => {
    const skippedOther = skipSessionExercise(session(), { exerciseOrder: 2 });
    expect(skippedOther.ok).toBe(true);
    if (!skippedOther.ok) return;

    // Order 1 is unskipped in every case; order 2 is skipped in the last.
    const cases: ReadonlyArray<{
      readonly session: WorkoutSession;
      readonly order: number;
      readonly expectBlocked: string | null;
    }> = [
      { session: session(), order: 1, expectBlocked: null },
      { session: withSetOnOrder1(), order: 1, expectBlocked: 'logged-sets' },
      { session: skippedOther.data, order: 1, expectBlocked: null },
      { session: skippedOther.data, order: 2, expectBlocked: null },
      { session: completedSession(), order: 1, expectBlocked: 'session-completed' },
    ];

    for (const { session: s, order, expectBlocked } of cases) {
      const log = s.exerciseLogs.find((e) => e.order === order);
      if (log === undefined) throw Error();
      const eligibility = resolveOccurrenceAdjustmentEligibility(s, log);

      // The projection and the mutation guards must never disagree: each
      // direction succeeds exactly when its can* flag says so.
      const skip = skipSessionExercise(s, { exerciseOrder: order });
      const unskip = unskipSessionExercise(s, { exerciseOrder: order });
      expect(skip.ok).toBe(eligibility.canSkip);
      expect(unskip.ok).toBe(eligibility.canUnskip);

      if (expectBlocked === null) {
        expect(eligibility.blockedBy).toBeNull();
      } else {
        expect(eligibility.blockedBy).toBe(expectBlocked);
        expect(eligibility.canSkip).toBe(false);
        expect(eligibility.canUnskip).toBe(false);
        // A blocked occurrence fails with the block's matching error code —
        // never a no-change (which would misreport the block as a state race).
        const expectedCode =
          expectBlocked === 'logged-sets' ? 'EXERCISE_HAS_LOGGED_SETS' : 'SESSION_ALREADY_COMPLETED';
        if (!skip.ok) expect(skip.error.code).toBe(expectedCode);
        if (!unskip.ok) expect(unskip.error.code).toBe(expectedCode);
      }
    }
  });
});

describe('resolveSessionPrescriptionTotals', () => {
  it('sums all prescribed sets when nothing is skipped', () => {
    expect(resolveSessionPrescriptionTotals(session())).toEqual({
      prescribedSets: 6,
      skippedOccurrences: 0,
    });
  });

  it('excludes skipped occurrences from the denominator (F5)', () => {
    const skipped = skipSessionExercise(session(), { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;

    expect(resolveSessionPrescriptionTotals(skipped.data)).toEqual({
      prescribedSets: 3,
      skippedOccurrences: 1,
    });
  });

  it('reports zero prescribed sets when every occurrence is skipped', () => {
    const first = skipSessionExercise(session(), { exerciseOrder: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const all = skipSessionExercise(first.data, { exerciseOrder: 2 });
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    expect(resolveSessionPrescriptionTotals(all.data)).toEqual({
      prescribedSets: 0,
      skippedOccurrences: 2,
    });
  });
});

describe('resolveSessionCompletionReadiness', () => {
  it('refuses a session with zero logged sets', () => {
    expect(resolveSessionCompletionReadiness(session()).canComplete).toBe(false);
  });

  it('refuses an all-skipped session (skips carry no sets)', () => {
    const first = skipSessionExercise(session(), { exerciseOrder: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const all = skipSessionExercise(first.data, { exerciseOrder: 2 });
    expect(all.ok).toBe(true);
    if (!all.ok) return;

    expect(resolveSessionCompletionReadiness(all.data).canComplete).toBe(false);
  });

  it('allows completion once at least one set is logged anywhere, even with skips', () => {
    const first = skipSessionExercise(session(), { exerciseOrder: 2 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    const logged = logSessionSet(first.data, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;

    expect(resolveSessionCompletionReadiness(logged.data).canComplete).toBe(true);
  });
});
