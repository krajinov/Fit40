import { describe, expect, it } from 'vitest';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession } from '@/domain/entities/workout-session';
import { createEnrollmentId, createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_ID = 'user-1';

function makeSession(ownerId: string = OWNER_ID) {
  const r = createWorkoutSession({ id: 's-1', userId: uid(ownerId), enrollmentId: enid('enr-1'), scheduledWorkoutId: swid('sw-1'), workoutId: wid('w-1'), startedAt: new Date(), exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!r.ok) throw Error();
  return r.data;
}

describe('LogSessionSetUseCase', () => {
  it('logs a valid set and returns DTO', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(makeSession());
    const uc = new LogSessionSetUseCase(repo);
    const r = await uc.execute({ sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 20, rpe: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.metrics.totalSets).toBe(1);
  });

  it('returns SESSION_NOT_FOUND for unknown session', async () => {
    const uc = new LogSessionSetUseCase(new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({ sessionId: 'unknown', userId: OWNER_ID, exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(makeSession('user-1'));
    const uc = new LogSessionSetUseCase(repo);
    const r = await uc.execute({ sessionId: 's-1', userId: 'user-2', exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');

    const untouched = await repo.findById(makeSession().id);
    expect(untouched?.exerciseLogs[0]?.sets).toHaveLength(0);
  });
});