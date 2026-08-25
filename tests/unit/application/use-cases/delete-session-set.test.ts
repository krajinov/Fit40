import { describe, expect, it } from 'vitest';
import { DeleteSessionSetUseCase } from '@/application/use-cases/delete-session-set';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { createExerciseId, createScheduledWorkoutId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }

async function sessionWithSet() {
  const repo = new InMemoryWorkoutSessionRepository();
  const sr = createWorkoutSession({ id: 's-1', scheduledWorkoutId: swid('sw-1'), workoutId: wid('w-1'), startedAt: new Date(), exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }] });
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
    const r = await uc.execute({ sessionId: sessionId as string, exerciseOrder: 1, setNumber: 1 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.metrics.totalSets).toBe(0);
  });

  it('returns SESSION_NOT_FOUND', async () => {
    const uc = new DeleteSessionSetUseCase(new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({ sessionId: 'unknown', exerciseOrder: 1, setNumber: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });
});