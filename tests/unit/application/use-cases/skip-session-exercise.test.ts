import { describe, expect, it, vi } from 'vitest';
import { SkipSessionExerciseUseCase } from '@/application/use-cases/skip-session-exercise';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet, completeWorkoutSession } from '@/domain/entities/workout-session';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createWorkoutSessionId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_ID = 'user-1';

/**
 * Builds an in-progress session with one plain (not skipped) occurrence,
 * persisted so the use case loads a stored snapshot.
 */
async function seedSession(
  ownerId: string = OWNER_ID,
  enrollmentId: string | null = 'enr-1',
) {
  const repo = new InMemoryWorkoutSessionRepository();
  const sr = createWorkoutSession({
    id: 's-1',
    userId: uid(ownerId),
    enrollmentId: enrollmentId === null ? null : enid(enrollmentId),
    scheduledWorkoutId: swid('sw-1'),
    workoutId: wid('w-1'),
    startedAt: new Date(),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
    ],
  });
  if (!sr.ok) throw Error();
  await repo.save(sr.data);
  return { repo, sessionId: sr.data.id as string };
}

/** Builds and persists a session whose FIRST occurrence is already skipped. */
async function seedSkippedSession() {
  const repo = new InMemoryWorkoutSessionRepository();
  const sr = createWorkoutSession({
    id: 's-1',
    userId: uid(OWNER_ID),
    enrollmentId: enid('enr-1'),
    scheduledWorkoutId: swid('sw-1'),
    workoutId: wid('w-1'),
    startedAt: new Date(),
    exerciseLogs: [
      { authoredExerciseId: eid('ex-001'), order: 1, prescription: rep(), restSeconds: 60 },
    ],
  });
  if (!sr.ok) throw Error();
  const skipped = skipSessionExercise(sr.data, { exerciseOrder: 1 });
  if (!skipped.ok) throw Error();
  await repo.save(skipped.data);
  return { repo, sessionId: skipped.data.id as string };
}

describe('SkipSessionExerciseUseCase', () => {
  it('skips an adjustable occurrence, persists it, and returns the updated DTO', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 , expectedSessionVersion: 0 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[0]?.isSkipped).toBe(true);
    // Skip never touches the occurrence contract beyond the flag.
    expect(r.data.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
    expect(r.data.skippedExerciseCount).toBe(1);
    expect(r.data.prescribedSets).toBe(0);
    // The skip persisted.
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs[0]?.isSkipped).toBe(true);
  });

  it('rejects invalid input before touching the repository', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const uc = new SkipSessionExerciseUseCase(repo);
    const findByIdSpy = vi.spyOn(repo, 'findById');

    const cases = [
      { sessionId: '', userId: OWNER_ID, exerciseOrder: 1, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: '', exerciseOrder: 1, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 0, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 2.5, expectedSessionVersion: 0 },
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
    const uc = new SkipSessionExerciseUseCase(new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({ sessionId: 'unknown', userId: OWNER_ID, exerciseOrder: 1 , expectedSessionVersion: 0 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const { repo, sessionId } = await seedSession('user-1');
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: 'user-2', exerciseOrder: 1 , expectedSessionVersion: 0 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs[0]?.isSkipped).toBe(false);
  });

  it('rejects skipping a detached session (enrollment nulled by leaving)', async () => {
    const { repo, sessionId } = await seedSession(OWNER_ID, null);
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 , expectedSessionVersion: 0 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs[0]?.isSkipped).toBe(false);
  });

  it('rejects skipping a completed session', async () => {
    const { repo, sessionId } = await seedSession();
    const loaded = await repo.findById(sid('s-1'));
    if (!loaded) throw Error();
    const withSet = logSessionSet(loaded, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: null,
      rpe: null,
    });
    if (!withSet.ok) throw Error();
    const completed = completeWorkoutSession(withSet.data, new Date());
    if (!completed.ok) throw Error();
    await repo.save(completed.data);
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 , expectedSessionVersion: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('rejects skipping an occurrence that has any logged set', async () => {
    const { repo, sessionId } = await seedSession();
    const loaded = await repo.findById(sid('s-1'));
    if (!loaded) throw Error();
    const withSet = logSessionSet(loaded, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: null,
      rpe: null,
    });
    if (!withSet.ok) throw Error();
    await repo.save(withSet.data);
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 , expectedSessionVersion: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs[0]?.isSkipped).toBe(false);
  });

  it('returns ADJUSTMENT_NO_CHANGE for an already-skipped occurrence', async () => {
    const { repo, sessionId } = await seedSkippedSession();
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 , expectedSessionVersion: 0 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('ADJUSTMENT_NO_CHANGE');
  });

  it('returns EXERCISE_LOG_NOT_FOUND for an unknown occurrence order', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 99 , expectedSessionVersion: 0 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('maps a concurrent modification to SESSION_MODIFIED', async () => {
    const { repo, sessionId } = await seedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionStaleVersionError('s-1'));
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 , expectedSessionVersion: 0 });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
  });

  it('maps an enrollment changed between load and save to NOT_ENROLLED', async () => {
    const { repo, sessionId } = await seedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionEnrollmentChangedError('s-1'));
    const uc = new SkipSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 , expectedSessionVersion: 0 });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
  });

  it('rethrows unexpected repository errors instead of swallowing them', async () => {
    const { repo, sessionId } = await seedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new Error('db connection lost'));
    const uc = new SkipSessionExerciseUseCase(repo);

    await expect(
      uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, expectedSessionVersion: 0 }),
    ).rejects.toThrow('db connection lost');

    saveSpy.mockRestore();
  });

  it('never performs an exercise catalog lookup', () => {
    // Skipping never changes the performed exercise, so the use case takes
    // ONLY the session repository (constructor arity 1, unlike substitution's
    // 2) — there is no catalog dependency to consult.
    expect(SkipSessionExerciseUseCase.length).toBe(1);
    new SkipSessionExerciseUseCase(new InMemoryWorkoutSessionRepository());
  });
});
