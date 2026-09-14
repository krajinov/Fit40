/**
 * Tests for the session-prescription-totals domain service (M10, PR #13
 * Finding 2 split): the skip-adjusted progress denominator (F5). The
 * completion gate lives on the entity and is tested in
 * `workout-session.test.ts`.
 */

import { describe, expect, it } from 'vitest';

import { createWorkoutSession, type WorkoutSession } from '@/domain/entities/workout-session';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import { resolveSessionPrescriptionTotals } from '@/domain/services/session-prescription-totals';
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
