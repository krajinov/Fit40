import { describe, expect, it } from 'vitest';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet, completeWorkoutSession } from '@/domain/entities/workout-session';
import { createExerciseId, createScheduledWorkoutId, createWorkoutId, createWorkoutSessionId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }

function createTestSession(override?: Partial<{ id: string; swId: string }>) {
  const r = createWorkoutSession({
    id: override?.id ?? 's-1', scheduledWorkoutId: sid(override?.swId ?? 'sw-1'), workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep() }],
  });
  if (!r.ok) throw Error();
  return r.data;
}

describe('InMemoryWorkoutSessionRepository', () => {
  it('returns null for missing session by ID', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const idR = createWorkoutSessionId('nonexistent');
    if (!idR.ok) throw Error();
    expect(await repo.findById(idR.data)).toBeNull();
  });

  it('returns null for missing session by scheduled workout ID', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const swId = sid('missing');
    expect(await repo.findByScheduledWorkoutId(swId)).toBeNull();
  });

  it('saves and retrieves a session by ID', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const s = createTestSession();
    await repo.save(s);
    const found = await repo.findById(s.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(s.id);
    expect(found!.scheduledWorkoutId).toBe(s.scheduledWorkoutId);
  });

  it('saves and retrieves a session by scheduled workout ID', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const s = createTestSession({ swId: 'sw-query' });
    await repo.save(s);
    const found = await repo.findByScheduledWorkoutId(s.scheduledWorkoutId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(s.id);
  });

  it('updates an existing session when saving the same ID', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const s = createTestSession();
    await repo.save(s);
    const loaded = await repo.findById(s.id);
    if (!loaded) throw Error();
    const rs = logSessionSet(loaded, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    if (!rs.ok) throw Error();
    await repo.save(rs.data);
    const reloaded = await repo.findById(s.id);
    if (!reloaded) throw Error();
    expect(reloaded.exerciseLogs[0]?.sets).toHaveLength(1);
  });

  it('mutating a returned session does not mutate stored state', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const s = createTestSession();
    await repo.save(s);
    const loaded = await repo.findById(s.id);
    if (!loaded) throw Error();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing mutation isolation
    (loaded as any).startedAt = new Date('2099-01-01');
    const reloaded = await repo.findById(s.id);
    if (!reloaded) throw Error();
    expect(reloaded.startedAt.getTime()).not.toBe(new Date('2099-01-01').getTime());
  });

  it('mutating the session object after save does not affect stored state', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const s = createTestSession();
    await repo.save(s);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- testing mutation isolation
    (s as any).id = 'modified';
    const reloaded = await repo.findById(createTestSession().id);
    expect(reloaded).not.toBeNull();
  });

  it('listCompleted returns only completed sessions', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const s1 = createTestSession({ id: 's-c1', swId: 'sw-c1' });
    const rs1 = logSessionSet(s1, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    if (!rs1.ok) throw Error();
    const c1 = completeWorkoutSession(rs1.data, new Date());
    if (!c1.ok) throw Error();
    await repo.save(c1.data);
    await repo.save(createTestSession({ id: 's-ip', swId: 'sw-ip' }));
    const completed = await repo.listCompleted();
    expect(completed).toHaveLength(1);
    expect(completed[0]!.id).toBe(c1.data.id);
  });

  it('repository starts empty', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    expect(await repo.listCompleted()).toHaveLength(0);
    expect(await repo.findByScheduledWorkoutId(sid('x'))).toBeNull();
  });

  it('reports a conflict when a different session claims the same scheduled workout', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(createTestSession({ id: 's-a', swId: 'sw-shared' }));

    const result = await repo.save(createTestSession({ id: 's-b', swId: 'sw-shared' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      reason: 'scheduled-workout-conflict',
      scheduledWorkoutId: 'sw-shared',
    });
    expect(await repo.findById(sessionId('s-b'))).toBeNull();
  });

  it('allows re-saving the session that already owns its scheduled workout', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const session = createTestSession({ id: 's-own', swId: 'sw-own' });
    expect((await repo.save(session)).ok).toBe(true);

    const loaded = await repo.findById(session.id);
    if (!loaded) throw Error();
    const logged = logSessionSet(loaded, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: null,
      rpe: null,
    });
    if (!logged.ok) throw Error();

    expect((await repo.save(logged.data)).ok).toBe(true);
    expect((await repo.findById(session.id))?.exerciseLogs[0]?.sets).toHaveLength(1);
  });
});

function sessionId(value: string) {
  const r = createWorkoutSessionId(value);
  if (!r.ok) throw Error();
  return r.data;
}
