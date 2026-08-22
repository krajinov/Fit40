import { describe, expect, it } from 'vitest';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import { createExerciseId, createScheduledWorkoutId, createWorkoutId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }

function makeSession() {
  const r = createWorkoutSession({ id: 's-1', scheduledWorkoutId: swid('sw-1'), workoutId: wid('w-1'), startedAt: new Date(), exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep() }] });
  if (!r.ok) throw Error();
  return r.data;
}

describe('LogSessionSetUseCase', () => {
  it('logs a valid set and returns DTO', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(makeSession());
    const uc = new LogSessionSetUseCase(repo);
    const r = await uc.execute({ sessionId: 's-1', exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 20, rpe: 7 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.metrics.totalSets).toBe(1);
  });

  it('returns SESSION_NOT_FOUND for unknown session', async () => {
    const uc = new LogSessionSetUseCase(new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({ sessionId: 'unknown', exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });
});