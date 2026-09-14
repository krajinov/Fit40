/**
 * Unit tests for the M10 Slice 2 application-DTO projections: the persisted
 * skip decision and the Domain-owned eligibility/totals derivations crossing
 * the application boundary.
 *
 * The mappers under test (`toWorkoutSessionDto`,
 * `toTrainingHistorySessionDto`, `toCompletedSessionDto`) must never
 * re-derive skip blocking or prescription totals on their own — they project
 * the Domain services' answers (`resolveOccurrenceAdjustmentEligibility`,
 * `resolveSessionPrescriptionTotals`). These tests lock that contract: each
 * DTO field is asserted against the domain function's own output on the same
 * aggregate, so a future re-derivation drift in Application is caught.
 *
 * Domain mutation/eligibility rules themselves are covered by the Slice 1
 * domain tests (occurrence-adjustment-rules / session-exercise-skip /
 * here.
 */

import { describe, expect, it } from 'vitest';

import { toWorkoutSessionDto } from '@/application/dto/workout-session';
import { toTrainingHistorySessionDto } from '@/application/dto/training-history';
import { toCompletedSessionDto } from '@/application/dto/completed-session';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { resolveOccurrenceAdjustmentEligibility } from '@/domain/services/occurrence-adjustment-rules';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import { resolveSessionPrescriptionTotals } from '@/domain/services/session-prescription-totals';
import type { TrainingHistoryEntry } from '@/application/ports/training-history-repository';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }


/** Two-occurrence session (orders 1 and 2), each prescribed 3 sets. */
function baseSession(): WorkoutSession {
  const r = createWorkoutSession({
    id: 'session-dto-1',
    userId: uid('user-1'),
    enrollmentId: null,
    scheduledWorkoutId: sid('sw-1'),
    workoutId: wid('w-1'),
    startedAt: new Date('2026-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 90 },
      { authoredExerciseId: eid('ex-002'), order: 2, prescription: rep(), restSeconds: 60 },
    ],
  });
  if (!r.ok) throw Error();
  return r.data;
}

function skipOrder(session: WorkoutSession, order: number): WorkoutSession {
  const r = skipSessionExercise(session, { exerciseOrder: order });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

/** Completes the session after logging one 10-rep set on order 1. */
function completedWithSetOnOrder1(session: WorkoutSession): WorkoutSession {
  const withSet = logSessionSet(session, {
    exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 50, rpe: null,
  });
  if (!withSet.ok) throw Error(withSet.error.message);
  const completed = completeWorkoutSession(withSet.data, new Date('2026-01-01T11:00:00Z'));
  if (!completed.ok) throw Error(completed.error.message);
  return completed.data;
}

describe('toWorkoutSessionDto — skip projection (M10 Slice 2)', () => {
  it('carries isSkipped on every occurrence DTO straight from the aggregate', () => {
    const dto = toWorkoutSessionDto(skipOrder(baseSession(), 2));
    expect(dto.exerciseLogs.map((log) => log.isSkipped)).toEqual([false, true]);
  });

  it('projects the Domain-owned adjustment eligibility per occurrence', () => {
    const session = skipOrder(baseSession(), 2);
    const dto = toWorkoutSessionDto(session);

    // Lock the contract: each DTO projection equals the domain function's
    // own answer for the same occurrence — never a re-derivation.
    for (const log of session.exerciseLogs) {
      const projected = dto.exerciseLogs.find((entry) => entry.order === log.order);
      if (projected === undefined) throw Error('missing DTO occurrence');
      expect(projected.adjustmentEligibility).toEqual(
        resolveOccurrenceAdjustmentEligibility(session, log),
      );
    }

    expect(dto.exerciseLogs[1]?.adjustmentEligibility).toEqual({
      isSkipped: true,
      blockedBy: null,
      canSkip: false,
      canUnskip: true,
      // Order 2 of 2: movable up only.
      canMoveUp: true,
      canMoveDown: false,
    });
  });


  it('freezes the eligibility of every occurrence once the session completes', () => {
    const dto = toWorkoutSessionDto(completedWithSetOnOrder1(baseSession()));
    expect(dto.exerciseLogs[0]?.adjustmentEligibility).toEqual({
      isSkipped: false,
      blockedBy: 'session-completed',
      canSkip: false,
      canUnskip: false,
      // Completion freezes reordering too — both move directions die.
      canMoveUp: false,
      canMoveDown: false,
    });
  });

  it('exposes Domain-owned skip-adjusted prescription totals', () => {
    const session = skipOrder(baseSession(), 2);
    const dto = toWorkoutSessionDto(session);
    const totals = resolveSessionPrescriptionTotals(session);

    // Same contract: the DTO totals ARE the domain totals, never a re-sum.
    expect(dto.prescribedSets).toBe(totals.prescribedSets);
    expect(dto.skippedExerciseCount).toBe(totals.skippedOccurrences);
    expect(dto.prescribedSets).toBe(3); // order 2's 3 sets excluded (F5)
    expect(dto.skippedExerciseCount).toBe(1);
  });

  it('keeps metrics describing actual logged work only', () => {
    const session = skipOrder(baseSession(), 2);
    const withSet = logSessionSet(session, {
      exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 50, rpe: null,
    });
    if (!withSet.ok) throw Error(withSet.error.message);
    const dto = toWorkoutSessionDto(withSet.data);

    // Metrics count only the one logged set; skipping never adds work.
    expect(dto.metrics.totalSets).toBe(1);
    expect(dto.prescribedSets).toBe(3);
  });
});

describe('toTrainingHistorySessionDto — completed-session isSkipped (M10 Slice 2)', () => {
  it('carries isSkipped through the history read model', () => {
    const completed = completedWithSetOnOrder1(skipOrder(baseSession(), 2));

    const entry: TrainingHistoryEntry = {
      session: { ...completed, completedAt: new Date('2026-01-01T11:00:00Z') },
      programName: 'Fit40 Beginner Strength',
      workoutName: 'Full Body A',
    };
    const dto = toTrainingHistorySessionDto(entry);

    expect(dto.exerciseLogs.map((log) => log.isSkipped)).toEqual([false, true]);
    // Frozen at completion: a completed session blocks every skip decision.
    expect(dto.exerciseLogs[1]?.adjustmentEligibility).toEqual({
      isSkipped: true,
      blockedBy: 'session-completed',
      canSkip: false,
      canUnskip: false,
      // Frozen at completion, history included: both move directions die.
      canMoveUp: false,
      canMoveDown: false,
    });
  });
});

describe('toCompletedSessionDto — detail entries carry the skip fact (M10 Slice 2)', () => {
  it('carries isSkipped on every completed-session entry', () => {
    const completed = completedWithSetOnOrder1(skipOrder(baseSession(), 2));

    const dto = toCompletedSessionDto(
      {
        session: { ...completed, completedAt: new Date('2026-01-01T11:00:00Z') },
        programName: 'Fit40 Beginner Strength',
        workoutName: 'Full Body A',
      },
      new Map(),
    );

    expect(dto.entries.map((entry) => entry.isSkipped)).toEqual([false, true]);
  });
});

describe('toWorkoutSessionDto — move projection (M10 Slice 5)', () => {
  it('exposes one movable direction per boundary occurrence', () => {
    const dto = toWorkoutSessionDto(baseSession());

    expect(dto.exerciseLogs[0]?.adjustmentEligibility).toEqual({
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      canMoveUp: false,
      canMoveDown: true,
    });
    expect(dto.exerciseLogs[1]?.adjustmentEligibility).toEqual({
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      canMoveUp: true,
      canMoveDown: false,
    });
  });

  it('keeps a logged-set occurrence movable — only completion freezes moves', () => {
    const withSet = logSessionSet(baseSession(), {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 50,
      rpe: null,
    });
    if (!withSet.ok) throw Error(withSet.error.message);
    const dto = toWorkoutSessionDto(withSet.data);

    // Logged sets block the skip decision only; the occurrence keeps its
    // move direction — the whole occurrence swaps with its sets.
    expect(dto.exerciseLogs[0]?.adjustmentEligibility).toEqual({
      isSkipped: false,
      blockedBy: 'logged-sets',
      canSkip: false,
      canUnskip: false,
      canMoveUp: false,
      canMoveDown: true,
    });
  });
});
