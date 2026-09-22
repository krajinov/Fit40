/**
 * Application tests for the M11 removal use case: the guard chain (validate →
 * load → ownership → enrollment → stale intent → domain → concurrency save →
 * persisted DTO), the canonical renumbering handed to `save`, and the
 * committed-version contract. The stale-intent ordering is asserted directly:
 * a stale version is rejected BEFORE `exerciseOrder` is interpreted.
 */

import { describe, expect, it, vi } from 'vitest';

import { RemoveSessionExerciseUseCase } from '@/application/use-cases/remove-session-exercise';
import { SkipSessionExerciseUseCase } from '@/application/use-cases/skip-session-exercise';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { addSessionExercise } from '@/domain/services/session-exercise-composition';
import { moveSessionExercise } from '@/domain/services/session-exercise-reorder';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createWorkoutSessionId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_ID = 'user-1';

/** Appends one user-added occurrence (ex-100) to a session aggregate. */
function withAdded(session: WorkoutSession, exerciseId = 'ex-100'): WorkoutSession {
  const r = addSessionExercise(session, {
    exerciseId: eid(exerciseId),
    prescription: rep(),
    restSeconds: 0,
  });
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

/**
 * Seeds an in-progress two-occurrence session: ex-001 (template, order 1) and
 * ex-100 (user-added, order 2), persisted at version 0.
 */
async function seedSession(
  ownerId: string = OWNER_ID,
  enrollmentId: string | null = 'enr-1',
): Promise<{ repo: InMemoryWorkoutSessionRepository; sessionId: string }> {
  const repo = new InMemoryWorkoutSessionRepository();
  const created = createWorkoutSession({
    id: 's-1',
    userId: uid(ownerId),
    enrollmentId: enrollmentId === null ? null : enid(enrollmentId),
    scheduledWorkoutId: swid('sw-1'),
    workoutId: wid('w-1'),
    startedAt: new Date('2026-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
    ],
  });
  if (!created.ok) throw Error(created.error.message);
  const seeded = withAdded(created.data);
  await repo.save(seeded);
  return { repo, sessionId: seeded.id as string };
}

/** Seeds a three-occurrence session with TWO user-added occurrences (v0). */
async function seedThreeOccurrenceSession(): Promise<{
  repo: InMemoryWorkoutSessionRepository;
  sessionId: string;
}> {
  const repo = new InMemoryWorkoutSessionRepository();
  const created = createWorkoutSession({
    id: 's-1',
    userId: uid(OWNER_ID),
    enrollmentId: enid('enr-1'),
    scheduledWorkoutId: swid('sw-1'),
    workoutId: wid('w-1'),
    startedAt: new Date('2026-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
    ],
  });
  if (!created.ok) throw Error(created.error.message);
  // ex-001 (template), ex-100 (added, order 2), ex-200 (added, order 3).
  const seeded = withAdded(withAdded(created.data, 'ex-100'), 'ex-200');
  await repo.save(seeded);
  return { repo, sessionId: seeded.id as string };
}

/** Loads the stored aggregate for assertions on the persisted state. */
async function storedSession(repo: InMemoryWorkoutSessionRepository): Promise<WorkoutSession> {
  const stored = await repo.findById(sid('s-1'));
  if (stored === null) throw Error('stored session vanished');
  return stored;
}

describe('RemoveSessionExerciseUseCase — success', () => {
  it('removes the user-added occurrence and renumbers deterministically', async () => {
    const { repo, sessionId } = await seedThreeOccurrenceSession();
    const uc = new RemoveSessionExerciseUseCase(repo);

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    expect(r.data.exerciseLogs.map((log) => log.performedExerciseId)).toEqual([
      'ex-001',
      'ex-200',
    ]);
    // No user-added occurrence survives at order 2 — the FIRST added one went.
    expect(r.data.exerciseLogs.find((log) => log.order === 2)?.occurrenceKey).toBe(3);
  });

  it('hands save the canonical renumbered aggregate with the high-water mark intact', async () => {
    const { repo, sessionId } = await seedThreeOccurrenceSession();
    const uc = new RemoveSessionExerciseUseCase(repo);
    const saveSpy = vi.spyOn(repo, 'save');

    await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, expectedSessionVersion: 0 });

    const savedAggregate = saveSpy.mock.calls[0]?.[0];
    saveSpy.mockRestore();
    if (savedAggregate === undefined) throw Error('save was not called');
    expect(savedAggregate.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    expect(savedAggregate.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 3]);
    expect(savedAggregate.nextOccurrenceKey).toBe(4);
  });

  it('returns the DTO from the persisted aggregate with the committed version', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new RemoveSessionExerciseUseCase(repo);

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = await storedSession(repo);
    expect(stored.version).toBe(1);
    expect(r.data.version).toBe(stored.version);
    expect(r.data.exerciseLogs).toHaveLength(stored.exerciseLogs.length);
  });

  it('lets a chained follow-up mutation reuse the returned version', async () => {
    const { repo, sessionId } = await seedThreeOccurrenceSession();
    const removed = await new RemoveSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: 0,
    });
    expect(removed.ok).toBe(true);
    if (!removed.ok) return;

    const skip = await new SkipSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 1,
      expectedSessionVersion: removed.data.version,
    });
    expect(skip.ok).toBe(true);
  });
});

describe('RemoveSessionExerciseUseCase — guard chain', () => {
  it('rejects invalid input before touching any repository', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const uc = new RemoveSessionExerciseUseCase(repo);
    const findByIdSpy = vi.spyOn(repo, 'findById');

    const cases = [
      { sessionId: '', userId: OWNER_ID, exerciseOrder: 1, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: '', exerciseOrder: 1, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 0, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 1.5, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 1, expectedSessionVersion: -1 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 1, expectedSessionVersion: 1.5 },
    ];

    for (const input of cases) {
      const r = await uc.execute(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
    expect(findByIdSpy).not.toHaveBeenCalled();
  });

  it('returns SESSION_NOT_FOUND for an unknown session', async () => {
    const uc = new RemoveSessionExerciseUseCase(new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({
      sessionId: 'unknown',
      userId: OWNER_ID,
      exerciseOrder: 1,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const { repo, sessionId } = await seedSession();
    const r = await new RemoveSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: 'user-2',
      exerciseOrder: 2,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(2);
  });

  it('returns NOT_ENROLLED for a detached session', async () => {
    const { repo, sessionId } = await seedSession(OWNER_ID, null);
    const r = await new RemoveSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(2);
  });

  it('rejects a stale expectedSessionVersion BEFORE interpreting exerciseOrder', async () => {
    const { repo, sessionId } = await seedThreeOccurrenceSession();
    // A concurrent mutation (move order 3 up) bumps the persisted version.
    const loaded = await repo.findById(sid(sessionId));
    if (loaded === null) throw Error();
    const moved = moveSessionExercise(loaded, { exerciseOrder: 3, direction: 'up' });
    if (!moved.ok) throw Error();
    await repo.save(moved.data); // version 1; order 2 is now the ex-200 occurrence

    const r = await new RemoveSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2, // the stale tab believes order 2 is the ex-100 occurrence
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
    // The current occupant of order 2 was NOT removed by the stale intent.
    const stored = await storedSession(repo);
    expect(stored.exerciseLogs).toHaveLength(3);
    expect(stored.exerciseLogs.find((log) => log.order === 2)?.performedExerciseId).toBe('ex-200');
  });

  it('rejects a template-authored occurrence with EXERCISE_NOT_REMOVABLE', async () => {
    const { repo, sessionId } = await seedSession();
    const r = await new RemoveSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 1,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_NOT_REMOVABLE');
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(2);
  });

  it('rejects removal of a user-added occurrence with logged sets', async () => {
    const { repo, sessionId } = await seedSession();
    const loaded = await repo.findById(sid(sessionId));
    if (loaded === null) throw Error();
    const logged = logSessionSet(loaded, {
      exerciseOrder: 2,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: null,
    });
    if (!logged.ok) throw Error();
    await repo.save(logged.data); // version 1

    const r = await new RemoveSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: 1,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');
    // Nothing was silently discarded.
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(2);
  });

  it('rejects an unknown occurrence order', async () => {
    const { repo, sessionId } = await seedSession();
    const r = await new RemoveSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 99,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('rejects a completed session with SESSION_ALREADY_COMPLETED', async () => {
    const { repo, sessionId } = await seedSession();
    const seeded = await repo.findById(sid(sessionId));
    if (seeded === null) throw Error();
    const logged = logSessionSet(seeded, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: null,
    });
    if (!logged.ok) throw Error();
    await repo.save(logged.data); // version 1
    const afterLog = await repo.findById(sid(sessionId));
    if (afterLog === null) throw Error();
    const completed = completeWorkoutSession(afterLog, new Date('2026-01-01T11:00:00Z'));
    if (!completed.ok) throw Error();
    await repo.save(completed.data); // version 2

    const r = await new RemoveSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: 2,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(2);
  });
});

describe('RemoveSessionExerciseUseCase — concurrency mapping', () => {
  it('maps a concurrent modification to SESSION_MODIFIED', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new RemoveSessionExerciseUseCase(repo);
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionStaleVersionError('s-1'));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: 0,
    });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
  });

  it('maps a changed enrollment between load and save to NOT_ENROLLED', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new RemoveSessionExerciseUseCase(repo);
    const saveSpy = vi
      .spyOn(repo, 'save')
      .mockRejectedValue(new SessionEnrollmentChangedError('s-1'));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: 0,
    });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
  });

  it('rethrows unexpected repository errors instead of swallowing them', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new RemoveSessionExerciseUseCase(repo);
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new Error('db connection lost'));

    await expect(
      uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 2, expectedSessionVersion: 0 }),
    ).rejects.toThrow('db connection lost');

    saveSpy.mockRestore();
  });
});
