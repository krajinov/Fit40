/**
 * M11 Slice 5 stabilization: progress and completion semantics with user-added
 * occurrences.
 *
 * These lock that M11 composition changes NOTHING about the existing rules:
 * a non-skipped occurrence's prescribed sets feed the progress denominator and
 * its logged sets feed the numerator; a skipped occurrence leaves the
 * denominator; and completion still requires at least one logged set anywhere
 * (`resolveSessionCompletionReadiness` is untouched).
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
  addSessionExercise,
  removeSessionExercise,
} from '@/domain/services/session-exercise-composition';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import { calculateSessionMetrics } from '@/domain/services/session-metrics';
import { resolveSessionPrescriptionTotals } from '@/domain/services/session-prescription-totals';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep(sets = 3) { const r = createRepScheme(sets, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }

/** One template occurrence (ex-001, order 1) prescribed three sets. */
function templateSession(): WorkoutSession {
  const r = createWorkoutSession({
    id: 't-progress',
    userId: uid('user-1'),
    enrollmentId: null,
    scheduledWorkoutId: sid('s-1'),
    workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(3), restSeconds: 60 },
    ],
  });
  if (!r.ok) throw Error();
  return r.data;
}

function add(target: WorkoutSession, exerciseId: string, sets = 3): WorkoutSession {
  const r = addSessionExercise(target, {
    exerciseId: eid(exerciseId),
    prescription: rep(sets),
    restSeconds: 0,
  });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function remove(target: WorkoutSession, exerciseOrder: number): WorkoutSession {
  const r = removeSessionExercise(target, { exerciseOrder });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function skip(target: WorkoutSession, exerciseOrder: number): WorkoutSession {
  const r = skipSessionExercise(target, { exerciseOrder });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

function logSet(target: WorkoutSession, exerciseOrder: number, reps = 10): WorkoutSession {
  const r = logSessionSet(target, {
    exerciseOrder,
    type: 'reps',
    reps,
    weightKg: 20,
    rpe: null,
  });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

describe('M11 composition / progress denominator (mixed cases)', () => {
  it('A. a non-skipped user-added occurrence adds its prescribed sets to the denominator', () => {
    const session = add(templateSession(), 'ex-100');

    const totals = resolveSessionPrescriptionTotals(session);

    expect(totals.prescribedSets).toBe(6);
    expect(totals.skippedOccurrences).toBe(0);
  });

  it('A. both the template and the user-added logged sets count in the numerator', () => {
    const session = logSet(logSet(add(templateSession(), 'ex-100'), 1, 10), 2, 12);

    const metrics = calculateSessionMetrics(session);

    expect(metrics.totalSets).toBe(2);
    expect(metrics.totalReps).toBe(22);
  });

  it('B. a SKIPPED user-added occurrence leaves the denominator', () => {
    const session = skip(add(templateSession(), 'ex-100'), 2);

    const totals = resolveSessionPrescriptionTotals(session);

    // Only the template occurrence's three sets remain.
    expect(totals.prescribedSets).toBe(3);
    expect(totals.skippedOccurrences).toBe(1);
  });

  it('C. a user-added occurrence with logged work satisfies completion on its own', () => {
    const session = logSet(add(templateSession(), 'ex-100'), 2, 12);

    expect(resolveSessionCompletionReadiness(session).canComplete).toBe(true);
    expect(calculateSessionMetrics(session).totalSets).toBe(1);
  });

  it('a zero-set non-skipped occurrence stays in the denominator but not the numerator', () => {
    const session = add(templateSession(), 'ex-100');

    expect(resolveSessionPrescriptionTotals(session).prescribedSets).toBe(6);
    expect(calculateSessionMetrics(session).totalSets).toBe(0);
    expect(resolveSessionCompletionReadiness(session).canComplete).toBe(false);
  });

  it('D. removing a zero-set user-added occurrence returns the totals to the remaining composition', () => {
    const withAdded = add(templateSession(), 'ex-100');
    expect(resolveSessionPrescriptionTotals(withAdded).prescribedSets).toBe(6);

    const afterRemoval = remove(withAdded, 2);

    expect(resolveSessionPrescriptionTotals(afterRemoval).prescribedSets).toBe(3);
    expect(afterRemoval.exerciseLogs).toHaveLength(1);

    // A subsequent add restores a two-occurrence composition.
    const reAdded = add(afterRemoval, 'ex-101');
    expect(resolveSessionPrescriptionTotals(reAdded).prescribedSets).toBe(6);
    expect(reAdded.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
  });

  it('E. an all-skipped session has an empty denominator and stays non-completable', () => {
    const session = skip(skip(add(templateSession(), 'ex-100'), 1), 2);

    const totals = resolveSessionPrescriptionTotals(session);
    expect(totals.prescribedSets).toBe(0);
    expect(totals.skippedOccurrences).toBe(2);
    expect(calculateSessionMetrics(session).totalSets).toBe(0);
    expect(resolveSessionCompletionReadiness(session).canComplete).toBe(false);

    const completed = completeWorkoutSession(session, new Date('2025-01-01T11:00:00Z'));
    expect(completed.ok).toBe(false);
    if (completed.ok) return;
    expect(completed.error.code).toBe('CANNOT_COMPLETE_EMPTY_SESSION');
  });

  it('E. a zero-work session (nothing logged, nothing skipped) also stays non-completable', () => {
    const session = add(templateSession(), 'ex-100');

    expect(resolveSessionCompletionReadiness(session).canComplete).toBe(false);
    const completed = completeWorkoutSession(session, new Date('2025-01-01T11:00:00Z'));
    expect(completed.ok).toBe(false);
  });

  it('M10 semantics are untouched: one logged set still completes a session with skips', () => {
    const session = logSet(skip(add(templateSession(), 'ex-100'), 2), 1, 10);

    expect(resolveSessionCompletionReadiness(session).canComplete).toBe(true);
    expect(resolveSessionPrescriptionTotals(session).skippedOccurrences).toBe(1);
    const completed = completeWorkoutSession(session, new Date('2025-01-01T11:00:00Z'));
    expect(completed.ok).toBe(true);
  });
});
