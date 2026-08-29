import { describe, expect, it } from 'vitest';
import { createWorkoutSession, completeWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { getCompletedScheduledWorkoutIds } from '@/domain/services/session-progress';
import { createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }

function makeSession(idSuffix: string) {
  const r = createWorkoutSession({
    id: `s-${idSuffix}`, userId: uid('user-1'), enrollmentId: null,
    scheduledWorkoutId: sid(`sw-${idSuffix}`), workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }],
  });
  if (!r.ok) throw Error();
  return r.data;
}

function sessionWithSet(idSuffix: string) {
  const s = makeSession(idSuffix);
  const r = logSessionSet(s, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
  if (!r.ok) throw Error();
  return r.data;
}

describe('getCompletedScheduledWorkoutIds', () => {
  it('returns empty for no sessions', () => {
    expect(getCompletedScheduledWorkoutIds([])).toEqual([]);
  });

  it('ignores in-progress sessions', () => {
    const ids = getCompletedScheduledWorkoutIds([makeSession('1')]);
    expect(ids).toEqual([]);
  });

  it('includes completed sessions', () => {
    const s = sessionWithSet('1');
    const c = completeWorkoutSession(s, new Date());
    if (!c.ok) throw Error();
    const ids = getCompletedScheduledWorkoutIds([c.data]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(c.data.scheduledWorkoutId);
  });

  it('removes duplicates', () => {
    const s = sessionWithSet('1');
    const c = completeWorkoutSession(s, new Date());
    if (!c.ok) throw Error();
    const ids = getCompletedScheduledWorkoutIds([c.data, c.data]);
    expect(ids).toHaveLength(1);
  });

  it('mixes in-progress and completed sessions', () => {
    const s1 = sessionWithSet('1');
    const c1 = completeWorkoutSession(s1, new Date());
    if (!c1.ok) throw Error();
    const s2 = makeSession('2');
    const ids = getCompletedScheduledWorkoutIds([c1.data, s2]);
    expect(ids).toHaveLength(1);
    expect(ids[0]).toBe(c1.data.scheduledWorkoutId);
  });
});