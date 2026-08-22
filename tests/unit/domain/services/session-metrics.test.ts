import { describe, expect, it } from 'vitest';
import { createWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { calculateSessionMetrics } from '@/domain/services/session-metrics';
import { createExerciseId, createScheduledWorkoutId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme, createDurationScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function dur() { const r = createDurationScheme(3, 30); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }

function makeSession() {
  const r = createWorkoutSession({
    id: 't', scheduledWorkoutId: sid('s-1'), workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { exerciseId: eid('ex-001'), order: 1, prescription: rep() },
      { exerciseId: eid('ex-002'), order: 2, prescription: dur() },
    ],
  });
  if (!r.ok) throw Error();
  return r.data;
}

describe('calculateSessionMetrics', () => {
  it('returns zeros for empty session', () => {
    const m = calculateSessionMetrics(makeSession());
    expect(m.totalSets).toBe(0);
    expect(m.totalReps).toBe(0);
    expect(m.totalDurationSeconds).toBe(0);
    expect(m.volume).toBe(0);
  });

  it('counts total sets across exercises', () => {
    const s = makeSession();
    const r1 = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    if (!r1.ok) throw Error();
    const r2 = logSessionSet(r1.data, { exerciseOrder: 1, type: 'reps', reps: 8, weightKg: null, rpe: null });
    if (!r2.ok) throw Error();
    const r3 = logSessionSet(r2.data, { exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
    if (!r3.ok) throw Error();
    expect(calculateSessionMetrics(r3.data).totalSets).toBe(3);
  });

  it('sums total reps for rep sets only', () => {
    const s = makeSession();
    const r1 = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    if (!r1.ok) throw Error();
    const r2 = logSessionSet(r1.data, { exerciseOrder: 1, type: 'reps', reps: 8, weightKg: null, rpe: null });
    if (!r2.ok) throw Error();
    expect(calculateSessionMetrics(r2.data).totalReps).toBe(18);
  });

  it('sums total duration for duration sets', () => {
    const s = makeSession();
    const r1 = logSessionSet(s, { exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
    if (!r1.ok) throw Error();
    const r2 = logSessionSet(r1.data, { exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
    if (!r2.ok) throw Error();
    expect(calculateSessionMetrics(r2.data).totalDurationSeconds).toBe(60);
  });

  it('calculates volume from weighted reps', () => {
    const s = makeSession();
    const r1 = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 20, rpe: null });
    if (!r1.ok) throw Error();
    expect(calculateSessionMetrics(r1.data).volume).toBe(200);
  });

  it('excludes bodyweight sets from volume', () => {
    const s = makeSession();
    const r1 = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    if (!r1.ok) throw Error();
    expect(calculateSessionMetrics(r1.data).volume).toBe(0);
  });

  it('excludes duration sets from volume', () => {
    const s = makeSession();
    const r1 = logSessionSet(s, { exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: 20, rpe: null });
    if (!r1.ok) throw Error();
    expect(calculateSessionMetrics(r1.data).volume).toBe(0);
  });
});