import { describe, expect, it } from 'vitest';

import {
  createWorkoutSession,
  logSessionSet,
  updateSessionSet,
  deleteSessionSet,
  completeWorkoutSession,
} from '@/domain/entities/workout-session';
import { createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme, createDurationScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function dur() { const r = createDurationScheme(3, 30); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }

function session() {
  const r = createWorkoutSession({
    id: 't', userId: uid('user-1'), enrollmentId: null,
    scheduledWorkoutId: sid('s-1'), workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
      { exerciseId: eid('ex-002'), order: 2, prescription: dur(), restSeconds: 60 },
    ],
  });
  if (!r.ok) throw Error();
  return r.data;
}

describe('logSessionSet', () => {
  it('logs a rep set', () => {
    const r = logSessionSet(session(), { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 20, rpe: 7 });
    expect(r.ok).toBe(true);
  });

  it('appends set numbers sequentially', () => {
    const s = session();
    const r1 = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    const r2 = logSessionSet(r1.data, { exerciseOrder: 1, type: 'reps', reps: 8, weightKg: null, rpe: null });
    expect(r2.ok).toBe(true);
    if (!r2.ok) return;
    expect(r2.data.exerciseLogs[0]?.sets).toHaveLength(2);
    expect(r2.data.exerciseLogs[0]?.sets[0]?.setNumber).toBe(1);
    expect(r2.data.exerciseLogs[0]?.sets[1]?.setNumber).toBe(2);
  });

  it('logs a duration set', () => {
    const r = logSessionSet(session(), { exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.exerciseLogs[1]?.sets[0]?.type === 'duration') {
      expect(r.data.exerciseLogs[1].sets[0].durationSeconds).toBe(30);
    }
  });

  it('rejects unknown exercise order', () => {
    const r = logSessionSet(session(), { exerciseOrder: 99, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('rejects wrong set type', () => {
    const r = logSessionSet(session(), { exerciseOrder: 2, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_SET_TYPE');
  });

  it('rejects zero reps', () => {
    const r = logSessionSet(session(), { exerciseOrder: 1, type: 'reps', reps: 0, weightKg: null, rpe: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_SET_DATA');
  });

  it('rejects negative weight', () => {
    const r = logSessionSet(session(), { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: -1, rpe: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_SET_DATA');
  });

  it('rejects RPE below 1', () => {
    const r = logSessionSet(session(), { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_SET_DATA');
  });

  it('rejects RPE above 10', () => {
    const r = logSessionSet(session(), { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: 11 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('INVALID_SET_DATA');
  });

  it('does not mutate the original session', () => {
    const s = session();
    logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(s.exerciseLogs[0]?.sets).toHaveLength(0);
  });

  it('rejects logging into completed session', () => {
    const s = session();
    const r = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = completeWorkoutSession(r.data, new Date());
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const m = logSessionSet(c.data, { exerciseOrder: 1, type: 'reps', reps: 5, weightKg: null, rpe: null });
    expect(m.ok).toBe(false);
    if (m.ok) return;
    expect(m.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('preserves the version token across domain mutations', () => {
    const s = session();
    expect(s.version).toBe(0);

    const logged = logSessionSet(s, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: null,
      rpe: null,
    });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    expect(logged.data.version).toBe(0);

    const updated = updateSessionSet(logged.data, {
      exerciseOrder: 1,
      setNumber: 1,
      type: 'reps',
      reps: 12,
      weightKg: null,
      rpe: null,
    });
    expect(updated.ok).toBe(true);
    if (!updated.ok) return;
    expect(updated.data.version).toBe(0);

    const completed = completeWorkoutSession(updated.data, new Date());
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.data.version).toBe(0);
  });
});

describe('updateSessionSet', () => {
  it('updates an existing set', () => {
    const s = session();
    const r = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 20, rpe: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = updateSessionSet(r.data, { exerciseOrder: 1, setNumber: 1, type: 'reps', reps: 12, weightKg: 22.5, rpe: 8 });
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    if (u.data.exerciseLogs[0]?.sets[0]?.type === 'reps') {
      expect(u.data.exerciseLogs[0].sets[0].reps).toBe(12);
      expect(u.data.exerciseLogs[0].sets[0].weightKg).toBe(22.5);
      expect(u.data.exerciseLogs[0].sets[0].rpe).toBe(8);
    }
  });

  it('preserves set number after update', () => {
    const s = session();
    const r = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = updateSessionSet(r.data, { exerciseOrder: 1, setNumber: 1, type: 'reps', reps: 12, weightKg: null, rpe: null });
    expect(u.ok).toBe(true);
    if (!u.ok) return;
    expect(u.data.exerciseLogs[0]?.sets[0]?.setNumber).toBe(1);
  });
});

describe('deleteSessionSet', () => {
  it('deletes a set and renumbers remaining sets', () => {
    const s = session();
    const s1 = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(s1.ok).toBe(true);
    if (!s1.ok) return;
    const s2 = logSessionSet(s1.data, { exerciseOrder: 1, type: 'reps', reps: 8, weightKg: null, rpe: null });
    expect(s2.ok).toBe(true);
    if (!s2.ok) return;
    const d = deleteSessionSet(s2.data, { exerciseOrder: 1, setNumber: 1 });
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.data.exerciseLogs[0]?.sets).toHaveLength(1);
    expect(d.data.exerciseLogs[0]?.sets[0]?.setNumber).toBe(1);
  });

  it('rejects deleting from completed session', () => {
    const s = session();
    const r = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const c = completeWorkoutSession(r.data, new Date());
    expect(c.ok).toBe(true);
    if (!c.ok) return;
    const d = deleteSessionSet(c.data, { exerciseOrder: 1, setNumber: 1 });
    expect(d.ok).toBe(false);
    if (d.ok) return;
    expect(d.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });
});