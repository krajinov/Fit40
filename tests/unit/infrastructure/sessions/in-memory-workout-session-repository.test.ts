import { describe, expect, it } from 'vitest';
import { SessionAlreadyExistsError, SessionEnrollmentChangedError } from '@/application/ports/workout-session-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet, completeWorkoutSession } from '@/domain/entities/workout-session';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
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
    exerciseLogs: [{ authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 }],
  });
  if (!r.ok) throw Error();
  return r.data;
}

function completed(
  session: ReturnType<typeof createTestSession>,
  completedAtIso = '2025-01-01T11:00:00Z',
) {
  const rs = logSessionSet(session, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
  if (!rs.ok) throw Error();
  const c = completeWorkoutSession(rs.data, new Date(completedAtIso));
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

  it('round-trips a valid skipped occurrence (M10: skip is a persisted fact)', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const skipped = skipSessionExercise(createTestSession(), { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    await repo.save(skipped.data);

    const stored = await repo.findById(skipped.data.id);
    expect(stored?.exerciseLogs[0]?.isSkipped).toBe(true);
    // A valid skipped occurrence round-trips with zero sets — the
    // skip⇔sets invariant survives the save/load boundary.
    expect(stored?.exerciseLogs[0]?.sets).toHaveLength(0);
  });

  it('never persists the skip+sets combination through supported mutation paths (M10)', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const base = createTestSession();

    // Path 1: log first — a subsequent skip is refused by the domain.
    const logged = logSessionSet(base, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    expect(skipSessionExercise(logged.data, { exerciseOrder: 1 }).ok).toBe(false);

    // Path 2: skip first — a subsequent log is refused by the domain.
    const skipped = skipSessionExercise(base, { exerciseOrder: 1 });
    expect(skipped.ok).toBe(true);
    if (!skipped.ok) return;
    expect(logSessionSet(skipped.data, { exerciseOrder: 1, type: 'reps', reps: 10, weightKg: null, rpe: null }).ok).toBe(false);

    // Only the valid aggregates were saved; the stored state keeps the
    // invariant on every occurrence.
    await repo.save(logged.data);
    await repo.save(skipped.data);
    for (const session of [await repo.findById(logged.data.id), await repo.findById(skipped.data.id)]) {
      for (const log of session?.exerciseLogs ?? []) {
        expect(!(log.isSkipped && log.sets.length > 0)).toBe(true);
      }
    }
  });

  describe('listCompletedByEnrollment', () => {
    it('returns hydrated completed sessions attached to the enrollment', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      await repo.save(completed(createTestSession({ id: 's-1', swId: 'sw-1' })));

      const listed = await repo.listCompletedByEnrollment(enid('enr-1'));

      expect(listed).toHaveLength(1);
      expect(listed[0]?.id).toBe('s-1');
      expect(listed[0]?.completedAt).toBeInstanceOf(Date);
      expect(listed[0]?.completedAt.toISOString()).toBe('2025-01-01T11:00:00.000Z');
      // Fully hydrated: exercise logs and set logs ride the aggregate.
      expect(listed[0]?.exerciseLogs).toHaveLength(1);
      expect(listed[0]?.exerciseLogs[0]?.sets).toHaveLength(1);
      expect(listed[0]?.exerciseLogs[0]?.sets[0]).toMatchObject({ type: 'reps', reps: 10 });
    });

    it('excludes in-progress sessions', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      await repo.save(completed(createTestSession({ id: 's-done', swId: 'sw-done' })));
      await repo.save(createTestSession({ id: 's-progress', swId: 'sw-progress' }));

      const listed = await repo.listCompletedByEnrollment(enid('enr-1'));

      expect(listed.map((session) => session.id)).toEqual(['s-done']);
    });

    it('excludes sessions belonging to another enrollment', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      await repo.save(completed(createTestSession({ id: 's-own', swId: 'sw-own' })));
      await repo.save(
        completed(
          createTestSession({ id: 's-other', swId: 'sw-other', enrollmentId: 'enr-2' }),
        ),
      );

      const listed = await repo.listCompletedByEnrollment(enid('enr-1'));

      expect(listed.map((session) => session.id)).toEqual(['s-own']);
    });

    it('excludes detached sessions', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      await repo.save(
        completed(
          createTestSession({ id: 's-detached', swId: 'sw-detached', enrollmentId: null }),
        ),
      );

      expect(await repo.listCompletedByEnrollment(enid('enr-1'))).toEqual([]);
    });

    it("excludes sessions belonging to another user's enrollment", async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      await repo.save(
        completed(
          createTestSession({
            id: 's-user-2',
            swId: 'sw-user-2',
            userId: 'user-2',
            enrollmentId: 'enr-2',
          }),
        ),
      );

      expect(await repo.listCompletedByEnrollment(enid('enr-1'))).toEqual([]);
    });

    it('orders ascending by completedAt', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      // Saved deliberately out of order; ids also contradict completion order
      // so an id-ordered (or insertion-ordered) read would fail this.
      await repo.save(
        completed(
          createTestSession({ id: 'session-a-done-last', swId: 'sw-late' }),
          '2025-01-03T11:00:00Z',
        ),
      );
      await repo.save(
        completed(
          createTestSession({ id: 'session-b-done-first', swId: 'sw-early' }),
          '2025-01-01T11:00:00Z',
        ),
      );
      await repo.save(
        completed(
          createTestSession({ id: 'session-c-done-middle', swId: 'sw-mid' }),
          '2025-01-02T11:00:00Z',
        ),
      );

      const listed = await repo.listCompletedByEnrollment(enid('enr-1'));

      expect(listed.map((session) => session.id)).toEqual([
        'session-b-done-first',
        'session-c-done-middle',
        'session-a-done-last',
      ]);
    });

    it('breaks completedAt ties by startedAt ascending', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      // Both complete at the same instant; the later-starting session carries
      // the alphabetically SMALLER id, so an id tie-break would invert the
      // expected order and fail this test.
      await repo.save(
        completed(
          createTestSession({
            id: 'session-x',
            swId: 'sw-x',
            startedAt: '2025-01-01T10:00:00Z',
          }),
        ),
      );
      await repo.save(
        completed(
          createTestSession({
            id: 'session-y',
            swId: 'sw-y',
            startedAt: '2025-01-01T09:00:00Z',
          }),
        ),
      );

      const listed = await repo.listCompletedByEnrollment(enid('enr-1'));

      expect(listed.map((session) => session.id)).toEqual(['session-y', 'session-x']);
    });

    it('breaks completedAt and startedAt ties by session id ascending', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      // Identical timestamps; saved in reverse id order so an insertion-
      // ordered read would fail this.
      await repo.save(
        completed(
          createTestSession({
            id: 'session-b',
            swId: 'sw-b',
            startedAt: '2025-01-01T10:00:00Z',
          }),
        ),
      );
      await repo.save(
        completed(
          createTestSession({
            id: 'session-a',
            swId: 'sw-a',
            startedAt: '2025-01-01T10:00:00Z',
          }),
        ),
      );

      const listed = await repo.listCompletedByEnrollment(enid('enr-1'));

      expect(listed.map((session) => session.id)).toEqual(['session-a', 'session-b']);
    });

    it('returns [] for an enrollment with no completed sessions', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      expect(await repo.listCompletedByEnrollment(enid('enr-empty'))).toEqual([]);

      await repo.save(createTestSession({ id: 's-progress', swId: 'sw-progress' }));
      expect(await repo.listCompletedByEnrollment(enid('enr-empty'))).toEqual([]);
      expect(await repo.listCompletedByEnrollment(enid('enr-1'))).toEqual([]);
    });

    it('returns defensive clones that cannot mutate stored state', async () => {
      const repo = new InMemoryWorkoutSessionRepository();
      await repo.save(completed(createTestSession({ id: 's-1', swId: 'sw-1' })));

      const listed = await repo.listCompletedByEnrollment(enid('enr-1'));
      const returned = listed[0];
      expect(returned).toBeDefined();

      // Mutate the returned aggregate's Date in place: stored state must not
      // react (structuredClone isolation, the repository's standing rule).
      returned!.completedAt.setTime(0);
      expect(returned!.completedAt.getTime()).toBe(0);

      const idR = createWorkoutSessionId('s-1');
      if (!idR.ok) throw Error();
      const stored = await repo.findById(idR.data);
      expect(stored?.completedAt?.toISOString()).toBe('2025-01-01T11:00:00.000Z');
      expect(stored?.exerciseLogs[0]?.sets).toHaveLength(1);
    });
  });
});