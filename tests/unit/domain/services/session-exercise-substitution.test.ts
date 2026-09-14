/**
 * Tests for the session-exercise-substitution domain service: identity swap
 * semantics, the prescription-snapshot invariant, and the blocked-when-logged
 * lifecycle rule for both substitute and restore.
 */

import { describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  restoreSessionExercise,
  resolveOccurrenceSubstitutionEligibility,
  resolveOccurrenceSubstitutionState,
  substituteSessionExercise,
} from '@/domain/services/session-exercise-substitution';
import {
  skipSessionExercise,
  unskipSessionExercise,
} from '@/domain/services/session-exercise-skip';
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

describe('substituteSessionExercise', () => {
  it('swaps only the performed identity, keeping the authored occurrence contract', () => {
    const s = session();
    const r = substituteSessionExercise(s, { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const swapped = r.data.exerciseLogs[0];
    expect(swapped?.performedExerciseId).toBe('ex-009');
    // The authored identity, prescription and rest snapshot survive the swap.
    expect(swapped?.authoredExerciseId).toBe('ex-001');
    expect(swapped?.prescription).toEqual(rep());
    expect(swapped?.restSeconds).toBe(60);
  });

  it('leaves other occurrences, sets and the version token untouched', () => {
    const s = session();
    const r = substituteSessionExercise(s, { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.version).toBe(s.version);
    expect(r.data.exerciseLogs[1]).toEqual(s.exerciseLogs[1]);
    expect(r.data.exerciseLogs[0]?.sets).toEqual([]);
  });

  it('allows substituting again (chaining), always against the authored identity', () => {
    const first = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    const second = substituteSessionExercise(first.data, { exerciseOrder: 1, replacementExerciseId: eid('ex-010') });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.exerciseLogs[0]?.performedExerciseId).toBe('ex-010');
    expect(second.data.exerciseLogs[0]?.authoredExerciseId).toBe('ex-001');
  });

  it('rejects a completed session', () => {
    const logged = withSetOnOrder1();
    const completed = completeWorkoutSession(logged, new Date());
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    const r = substituteSessionExercise(completed.data, { exerciseOrder: 2, replacementExerciseId: eid('ex-009') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('rejects an unknown occurrence order', () => {
    const r = substituteSessionExercise(session(), { exerciseOrder: 99, replacementExerciseId: eid('ex-009') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('rejects substitution once the occurrence has any logged set', () => {
    const r = substituteSessionExercise(withSetOnOrder1(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');
  });

  it('rejects substituting the already-performed exercise', () => {
    const r = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-001') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SUBSTITUTION_NO_CHANGE');
  });

  it('rejects a skipped occurrence: the user must unskip first (M10 F4)', () => {
    const skipped = skipSessionExercise(session(), { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;

    const r = substituteSessionExercise(skipped.data, { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_OCCURRENCE_SKIPPED');
  });

  it('allows skipping a substituted occurrence; the performed identity survives', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;

    const r = skipSessionExercise(substituted.data, { exerciseOrder: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[0]?.isSkipped).toBe(true);
    expect(r.data.exerciseLogs[0]?.performedExerciseId).toBe('ex-009');
    expect(r.data.exerciseLogs[0]?.authoredExerciseId).toBe('ex-001');
  });
});

describe('restoreSessionExercise', () => {
  it('reverts a substituted occurrence to performed-as-authored', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;

    const r = restoreSessionExercise(substituted.data, { exerciseOrder: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
    expect(r.data.exerciseLogs[0]?.authoredExerciseId).toBe('ex-001');
  });

  it('rejects restore of a performed-as-authored occurrence', () => {
    const r = restoreSessionExercise(session(), { exerciseOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SUBSTITUTION_NO_CHANGE');
  });

  it('rejects restore once the occurrence has any logged set', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const logged = logSessionSet(substituted.data, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;

    const r = restoreSessionExercise(logged.data, { exerciseOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');
  });

  it('rejects restore on a completed session', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const logged = logSessionSet(substituted.data, { exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    const completed = completeWorkoutSession(logged.data, new Date());
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;

    const r = restoreSessionExercise(completed.data, { exerciseOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('rejects restore of an unknown occurrence order', () => {
    const r = restoreSessionExercise(session(), { exerciseOrder: 99 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('rejects restore of a skipped occurrence: the user must unskip first (M10 F4)', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const skipped = skipSessionExercise(substituted.data, { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;

    const r = restoreSessionExercise(skipped.data, { exerciseOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_OCCURRENCE_SKIPPED');
  });

  it('re-enables restore after an unskip', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const skipped = skipSessionExercise(substituted.data, { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    const unskipped = unskipSessionExercise(skipped.data, { exerciseOrder: 1 });
    expect(unskipped.ok).toBe(true);
    if (!unskipped.ok) return;

    const r = restoreSessionExercise(unskipped.data, { exerciseOrder: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
  });
});

describe('resolveOccurrenceSubstitutionState', () => {
  it('reports not-substituted for a performed-as-authored occurrence', () => {
    const s = session();
    const log = s.exerciseLogs[0];
    expect(log).toBeDefined();
    if (log === undefined) return;
    const state = resolveOccurrenceSubstitutionState(log);
    expect(state).toEqual({
      authoredExerciseId: eid('ex-001'),
      performedExerciseId: eid('ex-001'),
      isSubstituted: false,
    });
  });

  it('reports substituted once the performed identity diverges', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const log = substituted.data.exerciseLogs[0];
    expect(log).toBeDefined();
    if (log === undefined) return;

    const state = resolveOccurrenceSubstitutionState(log);
    expect(state.isSubstituted).toBe(true);
    expect(state.authoredExerciseId).toBe('ex-001');
    expect(state.performedExerciseId).toBe('ex-009');
  });
});

describe('resolveOccurrenceSubstitutionEligibility', () => {
  it('reports a mutable, unsubstituted occurrence as unblocked with restore unavailable', () => {
    const log = session().exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceSubstitutionEligibility(session(), log)).toEqual({
      isSubstituted: false,
      blockedBy: null,
      canRestore: false,
    });
  });

  it('reports a substituted, mutable occurrence as restorable', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const log = substituted.data.exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceSubstitutionEligibility(substituted.data, log)).toEqual({
      isSubstituted: true,
      blockedBy: null,
      canRestore: true,
    });
  });

  it('blocks on logged sets even when the occurrence is substituted', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const logged = logSessionSet(substituted.data, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    const log = logged.data.exerciseLogs[0];
    if (log === undefined) return;

    const eligibility = resolveOccurrenceSubstitutionEligibility(logged.data, log);
    expect(eligibility.isSubstituted).toBe(true);
    expect(eligibility.blockedBy).toBe('logged-sets');
    // Restore is unavailable the moment ANY logged set exists.
    expect(eligibility.canRestore).toBe(false);
  });

  it('blocks on a completed session, outranking logged sets', () => {
    const substituted = substituteSessionExercise(session(), { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    // Sets on order 1 AND completion: the completed-session block wins,
    // mirroring the mutation guards' SESSION_ALREADY_COMPLETED precedence.
    const logged = logSessionSet(substituted.data, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    const completed = completeWorkoutSession(logged.data, new Date());
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    const log = completed.data.exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceSubstitutionEligibility(completed.data, log)).toEqual({
      isSubstituted: true,
      blockedBy: 'session-completed',
      canRestore: false,
    });
  });

  it('blocks a skipped occurrence as skipped, and completion outranks it (M10 F4)', () => {
    const skipped = skipSessionExercise(session(), { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    const log = skipped.data.exerciseLogs[0];
    if (log === undefined) return;

    expect(resolveOccurrenceSubstitutionEligibility(skipped.data, log)).toEqual({
      isSubstituted: false,
      blockedBy: 'skipped',
      canRestore: false,
    });

    // Once completed, the completed-session block outranks the skip block,
    // mirroring the mutation guards' SESSION_ALREADY_COMPLETED precedence.
    const withSetOnOther = logSessionSet(skipped.data, { exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
    expect(withSetOnOther.ok).toBe(true);
    if (!withSetOnOther.ok) return;
    const completed = completeWorkoutSession(withSetOnOther.data, new Date());
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    const completedLog = completed.data.exerciseLogs[0];
    if (completedLog === undefined) return;

    expect(resolveOccurrenceSubstitutionEligibility(completed.data, completedLog)).toEqual({
      isSubstituted: false,
      blockedBy: 'session-completed',
      canRestore: false,
    });
  });

  it('agrees with the mutation guards on every guard outcome', () => {
    // The projection and the mutation guards must never disagree: mutable ⇒
    // substitution succeeds; blocked ⇒ substitution fails with the matching
    // error code, and restore fails with that same block code (the guards run
    // before restore's own no-change precondition).
    const completedSession = (() => {
      const withSet = logSessionSet(session(), { exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
      if (!withSet.ok) throw Error();
      const completed = completeWorkoutSession(withSet.data, new Date());
      if (!completed.ok) throw Error();
      return completed.data;
    })();

    const cases = [
      { session: session(), expectBlocked: null as string | null },
      { session: withSetOnOrder1(), expectBlocked: 'logged-sets' },
      { session: completedSession, expectBlocked: 'session-completed' },
    ];

    for (const { session: s, expectBlocked } of cases) {
      const log = s.exerciseLogs[0];
      if (log === undefined) throw Error();
      const eligibility = resolveOccurrenceSubstitutionEligibility(s, log);

      const result = substituteSessionExercise(s, { exerciseOrder: 1, replacementExerciseId: eid('ex-009') });
      if (expectBlocked === null) {
        expect(result.ok).toBe(true);
        expect(eligibility.blockedBy).toBeNull();

        // After the successful swap the occurrence is mutable AND
        // substituted: restorable, and restore indeed succeeds.
        if (!result.ok) throw Error();
        const swappedLog = result.data.exerciseLogs[0];
        if (swappedLog === undefined) throw Error();
        const swappedEligibility = resolveOccurrenceSubstitutionEligibility(result.data, swappedLog);
        expect(swappedEligibility.blockedBy).toBeNull();
        expect(swappedEligibility.canRestore).toBe(true);
        expect(restoreSessionExercise(result.data, { exerciseOrder: 1 }).ok).toBe(true);
      } else {
        expect(result.ok).toBe(false);
        expect(eligibility.blockedBy).toBe(expectBlocked);
        expect(eligibility.canRestore).toBe(false);
        let expectedCode = '';
        if (!result.ok) {
          expectedCode = result.error.code;
          expect(result.error.code).toBe(
            expectBlocked === 'logged-sets' ? 'EXERCISE_HAS_LOGGED_SETS' : 'SESSION_ALREADY_COMPLETED',
          );
        }

        const restore = restoreSessionExercise(s, { exerciseOrder: 1 });
        expect(restore.ok).toBe(false);
        if (!restore.ok) {
          expect(restore.error.code).toBe(expectedCode);
        }
      }
    }
  });
});

