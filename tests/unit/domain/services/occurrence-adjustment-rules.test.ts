/**
 * Tests for the occurrence-adjustment RULES kernel (M10, PR #13 Finding 2
 * split): the shared loader, the eligibility projection, and its agreement
 * with the mutation guards. The projection and the blocking rule live in
 * `occurrence-adjustment-rules.ts`; the mutations themselves are tested in
 * `session-exercise-skip.test.ts` and `session-exercise-reorder.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  loadInProgressOccurrence,
  resolveOccurrenceAdjustmentEligibility,
} from '@/domain/services/occurrence-adjustment-rules';
import { skipSessionExercise, unskipSessionExercise } from '@/domain/services/session-exercise-skip';
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

describe('loadInProgressOccurrence', () => {
  it('loads an in-progress occurrence by order', () => {
    const r = loadInProgressOccurrence(session(), 2);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.order).toBe(2);
    expect(r.data.authoredExerciseId).toBe('ex-002');
  });

  it('rejects a completed session', () => {
    const r = loadInProgressOccurrence(completedSession(), 1);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('rejects an unknown occurrence order', () => {
    const r = loadInProgressOccurrence(session(), 99);

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
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

  it('never blocks a substituted occurrence (substitution is an independent state)', () => {
    const substituted = substituteSessionExercise(session(), {
      exerciseOrder: 1,
      replacementExerciseId: eid('ex-009'),
    });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const log = substituted.data.exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceAdjustmentEligibility(substituted.data, log).blockedBy).toBeNull();
  });
});

