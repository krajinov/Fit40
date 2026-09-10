/**
 * Tests for the session-exercise-adjustment domain service (M10): the skip /
 * unskip mutations and their guards, the read-only eligibility projection,
 * the skip-adjusted prescription totals, and the completion-readiness gate.
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
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  resolveOccurrenceAdjustmentEligibility,
  resolveSessionCompletionReadiness,
  resolveSessionPrescriptionTotals,
  skipSessionExercise,
  unskipSessionExercise,
} from '@/domain/services/session-exercise-adjustment';
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

describe('resolveOccurrenceAdjustmentEligibility', () => {
  it('reports a mutable, unskipped occurrence as skippable', () => {
    const log = session().exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceAdjustmentEligibility(session(), log)).toEqual({
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
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
