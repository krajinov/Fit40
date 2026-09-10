import { describe, expect, it, vi } from 'vitest';
import { RestoreSessionExerciseUseCase } from '@/application/use-cases/restore-session-exercise';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet, completeWorkoutSession } from '@/domain/entities/workout-session';
import { substituteSessionExercise } from '@/domain/services/session-exercise-substitution';
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
const REPLACE_WITH = 'ex-009';

/**
 * Builds an in-progress session whose FIRST occurrence is already
 * substituted (performed: ex-009, authored: ex-001), persisted so the use
 * case loads a stored snapshot.
 */
async function seedSubstitutedSession(
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
  const substituted = substituteSessionExercise(sr.data, {
    exerciseOrder: 1,
    replacementExerciseId: eid(REPLACE_WITH),
  });
  if (!substituted.ok) throw Error();
  await repo.save(substituted.data);
  return { repo, sessionId: substituted.data.id as string };
}

describe('RestoreSessionExerciseUseCase', () => {
  it('restores a substituted occurrence to performed-as-authored', async () => {
    const { repo, sessionId } = await seedSubstitutedSession();
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const log = r.data.exerciseLogs[0];
    expect(log?.performedExerciseId).toBe('ex-001');
    expect(log?.authoredExerciseId).toBe('ex-001');
    expect(log?.isSubstituted).toBe(false);
    // The occurrence contract carries over untouched.
    expect(log?.prescription).toEqual(rep());
    expect(log?.order).toBe(1);
    // The restore persisted.
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
  });

  it('rejects invalid input before touching the repository', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const uc = new RestoreSessionExerciseUseCase(repo);
    const findByIdSpy = vi.spyOn(repo, 'findById');

    const cases = [
      { sessionId: '', userId: OWNER_ID, exerciseOrder: 1 },
      { sessionId: 's-1', userId: '', exerciseOrder: 1 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 2.5 },
    ];
    for (const input of cases) {
      const r = await uc.execute(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
    expect(findByIdSpy).not.toHaveBeenCalled();
  });

  it('returns SESSION_NOT_FOUND for an unknown session', async () => {
    const uc = new RestoreSessionExerciseUseCase(new InMemoryWorkoutSessionRepository());
    const r = await uc.execute({ sessionId: 'unknown', userId: OWNER_ID, exerciseOrder: 1 });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const { repo, sessionId } = await seedSubstitutedSession('user-1');
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: 'user-2', exerciseOrder: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs[0]?.performedExerciseId).toBe(REPLACE_WITH);
  });

  it('rejects restoring a detached session (enrollment nulled by leaving)', async () => {
    const { repo, sessionId } = await seedSubstitutedSession(OWNER_ID, null);
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs[0]?.performedExerciseId).toBe(REPLACE_WITH);
  });

  it('rejects restoring a completed session', async () => {
    const { repo, sessionId } = await seedSubstitutedSession();
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
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('returns SUBSTITUTION_NO_CHANGE for a performed-as-authored occurrence', async () => {
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
    await repo.save(sr.data);
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId: sr.data.id as string, userId: OWNER_ID, exerciseOrder: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SUBSTITUTION_NO_CHANGE');
  });

  it('returns EXERCISE_LOG_NOT_FOUND for an unknown occurrence order', async () => {
    const { repo, sessionId } = await seedSubstitutedSession();
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 99 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('rejects restore once the occurrence has any logged set', async () => {
    const { repo, sessionId } = await seedSubstitutedSession();
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
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs[0]?.performedExerciseId).toBe(REPLACE_WITH);
  });

  it('maps a concurrent modification to SESSION_MODIFIED', async () => {
    const { repo, sessionId } = await seedSubstitutedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionStaleVersionError('s-1'));
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
  });

  it('maps an enrollment changed between load and save to NOT_ENROLLED', async () => {
    const { repo, sessionId } = await seedSubstitutedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionEnrollmentChangedError('s-1'));
    const uc = new RestoreSessionExerciseUseCase(repo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
  });

  it('rethrows unexpected repository errors instead of swallowing them', async () => {
    const { repo, sessionId } = await seedSubstitutedSession();
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new Error('db connection lost'));
    const uc = new RestoreSessionExerciseUseCase(repo);

    await expect(
      uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1 }),
    ).rejects.toThrow('db connection lost');

    saveSpy.mockRestore();
  });
});


