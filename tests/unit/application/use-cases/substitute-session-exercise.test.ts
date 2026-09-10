import { describe, expect, it, vi } from 'vitest';
import { SubstituteSessionExerciseUseCase } from '@/application/use-cases/substitute-session-exercise';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { createWorkoutSession, logSessionSet, completeWorkoutSession } from '@/domain/entities/workout-session';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
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
 * Builds an in-progress session with one occurrence per exercise id (orders
 * from 1), persisted so the use case loads a stored snapshot.
 */
async function seedSession(
  exerciseIds: ReadonlyArray<string>,
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
    exerciseLogs: exerciseIds.map((id, index) => ({
      authoredExerciseId: eid(id),
      order: index + 1,
      prescription: rep(),
      restSeconds: 60,
    })),
  });
  if (!sr.ok) throw Error();
  await repo.save(sr.data);
  return { repo, sessionId: sr.data.id as string };
}

/** Logs one set on the given occurrence of a stored session and persists it. */
async function withLoggedSet(repo: InMemoryWorkoutSessionRepository, exerciseOrder: number) {
  const loaded = await repo.findById(sid('s-1'));
  if (!loaded) throw Error();
  const rs = logSessionSet(loaded, {
    exerciseOrder,
    type: 'reps',
    reps: 10,
    weightKg: 20,
    rpe: null,
  });
  if (!rs.ok) throw Error();
  await repo.save(rs.data);
}

/** A minimal mock exercise repository: only findByIds is exercised here. */
function makeExerciseRepo(existingIds: ReadonlyArray<string>) {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds: vi.fn(async (ids: ReadonlyArray<string>) => {
      const found = ids.filter((id) => existingIds.includes(id));
      return found.map((id) => ({
        id: eid(id),
        name: `Exercise ${id}`,
        slug: `exercise-${id}`,
        description: 'A catalog exercise.',
        primaryMuscle: MuscleGroup.Quadriceps,
        secondaryMuscles: [],
        equipment: EquipmentType.Bodyweight,
        difficulty: Difficulty.Beginner,
        movementPattern: MovementPattern.Squat,
        considerations: [],
      }));
    }),
  } satisfies ExerciseRepository;
}

describe('SubstituteSessionExerciseUseCase', () => {
  it('substitutes the performed exercise, keeping authored identity, prescription, rest and order', async () => {
    const { repo, sessionId } = await seedSession(['ex-001', 'ex-002']);
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 1,
      replacementExerciseId: REPLACE_WITH,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const log = r.data.exerciseLogs[0];
    // Only the performed identity swaps; the occurrence contract carries over.
    expect(log?.performedExerciseId).toBe(REPLACE_WITH);
    expect(log?.authoredExerciseId).toBe('ex-001');
    expect(log?.isSubstituted).toBe(true);
    expect(log?.order).toBe(1);
    expect(log?.prescription).toEqual(rep());
    expect(log?.sets).toEqual([]);
    // Other occurrences are untouched.
    const other = r.data.exerciseLogs[1];
    expect(other?.performedExerciseId).toBe('ex-002');
    expect(other?.authoredExerciseId).toBe('ex-002');
    expect(other?.isSubstituted).toBe(false);
    // The substitution persisted.
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs[0]?.performedExerciseId).toBe(REPLACE_WITH);
  });

  it('rejects invalid input before touching any repository', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const exerciseRepo = makeExerciseRepo([REPLACE_WITH]);
    const uc = new SubstituteSessionExerciseUseCase(repo, exerciseRepo);
    const findByIdSpy = vi.spyOn(repo, 'findById');

    const cases = [
      { sessionId: '', userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: REPLACE_WITH },
      { sessionId: 's-1', userId: '', exerciseOrder: 1, replacementExerciseId: REPLACE_WITH },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 0, replacementExerciseId: REPLACE_WITH },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 1.5, replacementExerciseId: REPLACE_WITH },
      { sessionId: 's-1', userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: ' ' },
    ];
    for (const input of cases) {
      const r = await uc.execute(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
  });

  it('returns SESSION_NOT_FOUND for an unknown session', async () => {
    const uc = new SubstituteSessionExerciseUseCase(
      new InMemoryWorkoutSessionRepository(),
      makeExerciseRepo([REPLACE_WITH]),
    );
    const r = await uc.execute({ sessionId: 'unknown', userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: REPLACE_WITH });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const { repo, sessionId } = await seedSession(['ex-001'], 'user-1');
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    const r = await uc.execute({ sessionId, userId: 'user-2', exerciseOrder: 1, replacementExerciseId: REPLACE_WITH });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
  });

  it('rejects substituting a detached session (enrollment nulled by leaving)', async () => {
    const { repo, sessionId } = await seedSession(['ex-001'], OWNER_ID, null);
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: REPLACE_WITH });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
  });

  it('rejects substituting a completed session', async () => {
    const { repo, sessionId } = await seedSession(['ex-001']);
    await withLoggedSet(repo, 1);
    const loaded = await repo.findById(sid('s-1'));
    if (!loaded) throw Error();
    const completed = completeWorkoutSession(loaded, new Date());
    if (!completed.ok) throw Error();
    await repo.save(completed.data);
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: REPLACE_WITH });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
  });

  it('returns EXERCISE_LOG_NOT_FOUND for an unknown occurrence order', async () => {
    const { repo, sessionId } = await seedSession(['ex-001']);
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 99, replacementExerciseId: REPLACE_WITH });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_LOG_NOT_FOUND');
  });

  it('returns EXERCISE_NOT_FOUND when the replacement is not in the catalog', async () => {
    const { repo, sessionId } = await seedSession(['ex-001']);
    const exerciseRepo = makeExerciseRepo([]);
    const uc = new SubstituteSessionExerciseUseCase(repo, exerciseRepo);

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: 'ex-404' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_NOT_FOUND');
    // The failed lookup must not save anything.
    const untouched = await repo.findById(sid('s-1'));
    expect(untouched?.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
  });

  it('returns SUBSTITUTION_NO_CHANGE when the replacement is the performed exercise', async () => {
    const { repo, sessionId } = await seedSession(['ex-001']);
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo(['ex-001']));

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: 'ex-001' });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SUBSTITUTION_NO_CHANGE');
  });

  it('rejects substitution once the occurrence has any logged set', async () => {
    const { repo, sessionId } = await seedSession(['ex-001', 'ex-002']);
    await withLoggedSet(repo, 1);
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: REPLACE_WITH });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');
    const stored = await repo.findById(sid('s-1'));
    expect(stored?.exerciseLogs[0]?.performedExerciseId).toBe('ex-001');
  });

  it('maps a concurrent modification to SESSION_MODIFIED', async () => {
    const { repo, sessionId } = await seedSession(['ex-001']);
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionStaleVersionError('s-1'));
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: REPLACE_WITH });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
  });

  it('maps an enrollment changed between load and save to NOT_ENROLLED', async () => {
    const { repo, sessionId } = await seedSession(['ex-001']);
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionEnrollmentChangedError('s-1'));
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    const r = await uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: REPLACE_WITH });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
  });

  it('rethrows unexpected repository errors instead of swallowing them', async () => {
    const { repo, sessionId } = await seedSession(['ex-001']);
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new Error('db connection lost'));
    const uc = new SubstituteSessionExerciseUseCase(repo, makeExerciseRepo([REPLACE_WITH]));

    await expect(
      uc.execute({ sessionId, userId: OWNER_ID, exerciseOrder: 1, replacementExerciseId: REPLACE_WITH }),
    ).rejects.toThrow('db connection lost');

    saveSpy.mockRestore();
  });
});


