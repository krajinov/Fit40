import { describe, expect, it } from 'vitest';
import { SessionAlreadyExistsError, SessionEnrollmentChangedError } from '@/application/ports/workout-session-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet, completeWorkoutSession } from '@/domain/entities/workout-session';
import { createEnrollmentId, createExerciseId, createScheduledWorkoutId, createUserId, createWorkoutId, createWorkoutSessionId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

function createTestSession(override?: Partial<{ id: string; swId: string; userId: string; enrollmentId: string | null; startedAt: string }>) {
  const r = createWorkoutSession({
    id: override?.id ?? 's-1',
    userId: uid(override?.userId ?? 'user-1'),
    enrollmentId: override?.enrollmentId === null ? null : enid(override?.enrollmentId ?? 'enr-1'),
    scheduledWorkoutId: sid(override?.swId ?? 'sw-1'), workoutId: wid('w-1'),
    startedAt: new Date(override?.startedAt ?? '2025-01-01T10:00:00Z'),
    exerciseLogs: [{ exerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }],
  });
  if (!r.ok) throw Error();
  return r.data;
}

function completed(session: ReturnType<typeof createTestSession>) {
  const rs = logSessionSet(session, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
  if (!rs.ok) throw Error();
  const c = completeWorkoutSession(rs.data, new Date('2025-01-01T11:00:00Z'));
  if (!c.ok) throw Error();
  return c.data;
}

describe('InMemoryWorkoutSessionRepository', () => {
  it('returns null for missing session by ID', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const idR = createWorkoutSessionId('nonexistent');
    if (!idR.ok) throw Error();
    expect(await repo.findById(idR.data)).toBeNull();
  });

  it('returns null for a missing (enrollment, scheduled workout) pair', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    expect(await repo.findByEnrollmentAndScheduledWorkout(enid('missing'), sid('missing'))).toBeNull();
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

  it('saves and retrieves a session by enrollment and scheduled workout', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const s = createTestSession({ swId: 'sw-query' });
    await repo.save(s);
    const found = await repo.findByEnrollmentAndScheduledWorkout(enid('enr-1'), s.scheduledWorkoutId);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(s.id);
  });

  it('scopes the occurrence lookup to the enrollment: another enrollment is invisible', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(createTestSession({ id: 's-1', swId: 'sw-1', enrollmentId: 'enr-1' }));

    expect(await repo.findByEnrollmentAndScheduledWorkout(enid('enr-2'), sid('sw-1'))).toBeNull();
  });

  it('allows two enrollments to hold sessions for the same occurrence', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(createTestSession({ id: 's-1', swId: 'sw-1', enrollmentId: 'enr-1' }));
    await repo.save(createTestSession({ id: 's-2', swId: 'sw-1', enrollmentId: 'enr-2' }));

    expect((await repo.findByEnrollmentAndScheduledWorkout(enid('enr-1'), sid('sw-1')))?.id).toBe('s-1');
    expect((await repo.findByEnrollmentAndScheduledWorkout(enid('enr-2'), sid('sw-1')))?.id).toBe('s-2');
  });

  it('rejects a second session for the same enrollment and occurrence', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(createTestSession({ id: 's-1', swId: 'sw-1', enrollmentId: 'enr-1' }));

    await expect(
      repo.save(createTestSession({ id: 's-2', swId: 'sw-1', enrollmentId: 'enr-1' })),
    ).rejects.toBeInstanceOf(SessionAlreadyExistsError);
  });

  it('never lets detached (null-enrollment) sessions collide', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(createTestSession({ id: 's-1', swId: 'sw-1', enrollmentId: null }));
    await repo.save(createTestSession({ id: 's-2', swId: 'sw-1', enrollmentId: null }));

    const secondId = createWorkoutSessionId('s-2');
    if (!secondId.ok) throw Error();
    expect(await repo.findById(secondId.data)).not.toBeNull();
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

  it('listCompletedScheduledWorkoutIds returns only that enrollment\'s completed ids', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    await repo.save(completed(createTestSession({ id: 's-c1', swId: 'sw-c1', enrollmentId: 'enr-1' })));
    await repo.save(createTestSession({ id: 's-ip', swId: 'sw-ip', enrollmentId: 'enr-1' }));
    await repo.save(completed(createTestSession({ id: 's-c2', swId: 'sw-c2', enrollmentId: 'enr-2' })));

    const completedForEnr1 = await repo.listCompletedScheduledWorkoutIds(enid('enr-1'));
    expect(completedForEnr1).toEqual(['sw-c1']);

    const completedForEnr2 = await repo.listCompletedScheduledWorkoutIds(enid('enr-2'));
    expect(completedForEnr2).toEqual(['sw-c2']);
  });

  it('listCompletedScheduledWorkoutIds orders ids by start time ascending', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    // Saved out of order on purpose: the projection must sort by startedAt.
    await repo.save(completed(createTestSession({ id: 's-late', swId: 'sw-late', startedAt: '2025-01-02T10:00:00Z' })));
    await repo.save(completed(createTestSession({ id: 's-early', swId: 'sw-early', startedAt: '2025-01-01T09:00:00Z' })));

    expect(await repo.listCompletedScheduledWorkoutIds(enid('enr-1'))).toEqual(['sw-early', 'sw-late']);
  });

  it('rejects saving over a row whose enrollment changed since the snapshot', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    // Persisted state AFTER a concurrent leave: the row is detached (null).
    await repo.save(completed(createTestSession({ id: 's-1', swId: 'sw-1', enrollmentId: null })));

    // The caller's snapshot was loaded BEFORE the leave: still enrolled
    // (enr-1). The write must not commit against detached history.
    await expect(
      repo.save(completed(createTestSession({ id: 's-1', swId: 'sw-1', enrollmentId: 'enr-1' }))),
    ).rejects.toBeInstanceOf(SessionEnrollmentChangedError);

    // A snapshot expecting a different enrollment identity is refused too.
    await expect(
      repo.save(completed(createTestSession({ id: 's-1', swId: 'sw-1', enrollmentId: 'enr-2' }))),
    ).rejects.toBeInstanceOf(SessionEnrollmentChangedError);

    // The stored row is untouched by both refused writes.
    const id = createWorkoutSessionId('s-1');
    if (!id.ok) throw Error();
    const stored = await repo.findById(id.data);
    expect(stored?.enrollmentId).toBeNull();
  });

  it('repository starts empty', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    expect(await repo.listCompletedScheduledWorkoutIds(enid('enr-1'))).toEqual([]);
    expect(await repo.findByEnrollmentAndScheduledWorkout(enid('enr-1'), sid('x'))).toBeNull();
  });
});