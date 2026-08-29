import { describe, expect, it } from 'vitest';
import { DeleteSessionSetUseCase } from '@/application/use-cases/delete-session-set';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { createEnrollmentId, createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_ID = 'user-1';

async function sessionWithSet(ownerId: string = OWNER_ID) {
  const repo = new InMemoryWorkoutSessionRepository();
  const sr = createWorkoutSession({ id: 's-1', userId: uid(ownerId), enrollmentId: enid('enr-1'), scheduledWorkoutId: swid('sw-1'), workoutId: wid('w-1'), startedAt: new Date(), exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
  if (!sr.ok) throw Error();
  await repo.save(sr.data);
  const loaded = await repo.findById(sr.data.id);
  if (!loaded) throw Error();
  const rs = logSessionSet(loaded, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 20, rpe: null });
  if (!rs.ok) throw Error();
  await repo.save(rs.data);
  return { repo, sessionId: sr.data.id };
}

describe('DeleteSessionSetUseCase', () => {
  it('deletes a set and returns DTO', async () => {
    const { repo, sessionId } = await sessionWithSet();
    const uc = new DeleteSessionSetUseCase(repo);
    const r = await uc.execute({ sessionId: sessionId as string, userId: OWNER_ID, exerciseOrder: 1, setNumber: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.metrics.totalSets).toBe(0);
  });

  it('returns SESSION_NOT_FOUND', async () => {
    const uc = new DeleteSessionSetUseCase(new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({ sessionId: 'unknown', userId: OWNER_ID, exerciseOrder: 1, setNumber: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const { repo, sessionId } = await sessionWithSet('user-1');
    const uc = new DeleteSessionSetUseCase(repo);
    const r = await uc.execute({ sessionId: sessionId as string, userId: 'user-2', exerciseOrder: 1, setNumber: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');
  });
});