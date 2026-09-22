/**
 * Application tests for the M11 Add composition use case: the guard chain
 * (validate → load → ownership → enrollment → stale intent → catalog
 * existence → domain → concurrency save → persisted DTO), the explicit
 * prescription construction for both schemes, and the committed-version
 * contract. Remapping an unexpected repository failure stays a throw.
 */

import { describe, expect, it, vi } from 'vitest';

import { AddSessionExerciseUseCase } from '@/application/use-cases/add-session-exercise';
import { SkipSessionExerciseUseCase } from '@/application/use-cases/skip-session-exercise';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import {
  SessionEnrollmentChangedError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  OccurrenceSource,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
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
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

function rep() { const r = createRepScheme(3, 8, 10); if (!r.ok) throw Error(); return r.data; }
function eid(v: string) { const r = createExerciseId(v); if (!r.ok) throw Error(); return r.data; }
function sid(v: string) { const r = createWorkoutSessionId(v); if (!r.ok) throw Error(); return r.data; }
function swid(v: string) { const r = createScheduledWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function wid(v: string) { const r = createWorkoutId(v); if (!r.ok) throw Error(); return r.data; }
function uid(v: string) { const r = createUserId(v); if (!r.ok) throw Error(); return r.data; }
function enid(v: string) { const r = createEnrollmentId(v); if (!r.ok) throw Error(); return r.data; }

const OWNER_ID = 'user-1';
const ADD_ID = 'ex-100';

/**
 * Builds an in-progress single-occurrence session (ex-001, order 1) persisted
 * so the use case loads a stored snapshot. Returns the repo and session id.
 */
async function seedSession(
  ownerId: string = OWNER_ID,
  enrollmentId: string | null = 'enr-1',
): Promise<{ repo: InMemoryWorkoutSessionRepository; sessionId: string }> {
  const repo = new InMemoryWorkoutSessionRepository();
  const sr = createWorkoutSession({
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
  if (!sr.ok) throw Error(sr.error.message);
  await repo.save(sr.data);
  return { repo, sessionId: sr.data.id as string };
}

/** Loads the stored aggregate for assertions on unexposed fields. */
async function storedSession(repo: InMemoryWorkoutSessionRepository): Promise<WorkoutSession> {
  const stored = await repo.findById(sid('s-1'));
  if (stored === null) throw Error('stored session vanished');
  return stored;
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

describe('AddSessionExerciseUseCase — success', () => {
  it('adds a reps exercise with the explicit target preserved as min = max', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 4,
      targetReps: 6,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs).toHaveLength(2);
    const added = r.data.exerciseLogs[1];
    expect(added?.order).toBe(2);
    expect(added?.authoredExerciseId).toBe(ADD_ID);
    expect(added?.performedExerciseId).toBe(ADD_ID);
    expect(added?.source).toBe(OccurrenceSource.UserAdded);
    expect(added?.isSkipped).toBe(false);
    expect(added?.sets).toEqual([]);
    expect(added?.prescription).toEqual({ type: 'reps', sets: 4, minReps: 6, maxReps: 6 });

    // Persisted: the rest snapshot is the M11 product rule's 0.
    const stored = await storedSession(repo);
    expect(stored.exerciseLogs[1]?.restSeconds).toBe(0);
    expect(stored.exerciseLogs[1]?.source).toBe(OccurrenceSource.UserAdded);
  });

  it('adds a duration exercise with the explicit seconds preserved', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'duration',
      sets: 2,
      durationSeconds: 45,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs[1]?.prescription).toEqual({
      type: 'duration',
      sets: 2,
      seconds: 45,
    });
  });

  it('allows selecting an exercise already present in the session', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo(['ex-001']));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: 'ex-001',
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.exerciseLogs.map((log) => log.performedExerciseId)).toEqual(['ex-001', 'ex-001']);
    expect(r.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
  });

  it('hands the domain-derived occurrence key and high-water mark to save', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));
    const saveSpy = vi.spyOn(repo, 'save');

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    const savedAggregate = saveSpy.mock.calls[0]?.[0];
    saveSpy.mockRestore();
    if (savedAggregate === undefined) throw Error('save was not called');
    // The new occurrence took the PRIOR mark (2), and the mark advanced once.
    expect(savedAggregate.exerciseLogs[1]?.occurrenceKey).toBe(2);
    expect(savedAggregate.exerciseLogs[1]?.source).toBe(OccurrenceSource.UserAdded);
    expect(savedAggregate.nextOccurrenceKey).toBe(3);
  });

  it('returns the DTO from the persisted aggregate with the committed version', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const stored = await storedSession(repo);
    expect(stored.version).toBe(1);
    expect(r.data.version).toBe(stored.version);
    // The DTO reflects the persisted aggregate, not the pre-save snapshot.
    expect(r.data.exerciseLogs).toHaveLength(stored.exerciseLogs.length);
  });

  it('lets a chained follow-up mutation reuse the returned version without a false SESSION_MODIFIED', async () => {
    const { repo, sessionId } = await seedSession();
    const addUc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID, 'ex-101']));

    const first = await addUc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });
    expect(first.ok).toBe(true);
    if (!first.ok) return;

    // A second composition add using the returned version.
    const second = await addUc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: 'ex-101',
      scheme: 'duration',
      sets: 2,
      durationSeconds: 30,
      expectedSessionVersion: first.data.version,
    });
    expect(second.ok).toBe(true);

    // A different occurrence-addressed mutation using the latest version.
    if (!second.ok) return;
    const skip = await new SkipSessionExerciseUseCase(repo).execute({
      sessionId,
      userId: OWNER_ID,
      exerciseOrder: 2,
      expectedSessionVersion: second.data.version,
    });
    expect(skip.ok).toBe(true);
  });
});

describe('AddSessionExerciseUseCase — guard chain', () => {
  it('rejects invalid input before touching any repository', async () => {
    const repo = new InMemoryWorkoutSessionRepository();
    const exerciseRepo = makeExerciseRepo([ADD_ID]);
    const uc = new AddSessionExerciseUseCase(repo, exerciseRepo);
    const findByIdSpy = vi.spyOn(repo, 'findById');

    const cases = [
      { sessionId: '', userId: OWNER_ID, exerciseId: ADD_ID, scheme: 'reps', sets: 3, targetReps: 8, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: '', exerciseId: ADD_ID, scheme: 'reps', sets: 3, targetReps: 8, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseId: ' ', scheme: 'reps', sets: 3, targetReps: 8, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseId: ADD_ID, scheme: 'reps', sets: 0, targetReps: 8, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseId: ADD_ID, scheme: 'reps', sets: 3, targetReps: 0, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseId: ADD_ID, scheme: 'reps', sets: 1.5, targetReps: 8, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseId: ADD_ID, scheme: 'duration', sets: 3, durationSeconds: -5, expectedSessionVersion: 0 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseId: ADD_ID, scheme: 'reps', sets: 3, targetReps: 8, expectedSessionVersion: -1 },
      { sessionId: 's-1', userId: OWNER_ID, exerciseId: ADD_ID, scheme: 'reps', sets: 3, targetReps: 8, expectedSessionVersion: 1.5 },
    ] as const;

    for (const input of cases) {
      const r = await uc.execute(input);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.code).toBe('INVALID_INPUT');
    }
    expect(findByIdSpy).not.toHaveBeenCalled();
    expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
  });

  it('returns SESSION_NOT_FOUND for an unknown session', async () => {
    const uc = new AddSessionExerciseUseCase(
      new InMemoryWorkoutSessionRepository(),
      makeExerciseRepo([ADD_ID]),
    );

    const r = await uc.execute({
      sessionId: 'unknown',
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns FORBIDDEN when the session belongs to another user', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));

    const r = await uc.execute({
      sessionId,
      userId: 'user-2',
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('FORBIDDEN');
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(1);
  });

  it('returns NOT_ENROLLED for a detached session', async () => {
    const { repo, sessionId } = await seedSession(OWNER_ID, null);
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(1);
  });

  it('returns EXERCISE_NOT_FOUND when the selection is not in the catalog', async () => {
    const { repo, sessionId } = await seedSession();
    const exerciseRepo = makeExerciseRepo([]);
    const uc = new AddSessionExerciseUseCase(repo, exerciseRepo);

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: 'ex-404',
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('EXERCISE_NOT_FOUND');
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(1);
  });

  it('rejects a stale expectedSessionVersion before any mutation', async () => {
    const { repo, sessionId } = await seedSession();
    // A concurrent mutation (skip order 1) bumps the persisted version to 1.
    const loaded = await repo.findById(sid('s-1'));
    if (loaded === null) throw Error();
    const skipped = skipSessionExercise(loaded, { exerciseOrder: 1 });
    if (!skipped.ok) throw Error();
    await repo.save(skipped.data);

    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));
    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0, // the stale rendered version
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
    // Nothing was appended by the stale intent.
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(1);
  });

  it('rejects a completed session with SESSION_ALREADY_COMPLETED', async () => {
    const { repo, sessionId } = await seedSession();
    const seeded = await repo.findById(sid('s-1'));
    if (seeded === null) throw Error();
    const logged = logSessionSet(seeded, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: null,
    });
    if (!logged.ok) throw Error();
    await repo.save(logged.data); // committed version 1

    // Reload so the completion carries the version the store now holds.
    const afterLog = await repo.findById(sid('s-1'));
    if (afterLog === null) throw Error();
    const completed = completeWorkoutSession(afterLog, new Date('2026-01-01T11:00:00Z'));
    if (!completed.ok) throw Error();
    await repo.save(completed.data); // committed version 2

    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));
    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 2,
    });

    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_ALREADY_COMPLETED');
    expect((await storedSession(repo)).exerciseLogs).toHaveLength(1);
  });
});

describe('AddSessionExerciseUseCase — concurrency mapping', () => {
  it('maps a concurrent modification to SESSION_MODIFIED', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new SessionStaleVersionError('s-1'));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('SESSION_MODIFIED');
  });

  it('maps a changed enrollment between load and save to NOT_ENROLLED', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));
    const saveSpy = vi
      .spyOn(repo, 'save')
      .mockRejectedValue(new SessionEnrollmentChangedError('s-1'));

    const r = await uc.execute({
      sessionId,
      userId: OWNER_ID,
      exerciseId: ADD_ID,
      scheme: 'reps',
      sets: 3,
      targetReps: 8,
      expectedSessionVersion: 0,
    });

    saveSpy.mockRestore();
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('NOT_ENROLLED');
  });

  it('rethrows unexpected repository errors instead of swallowing them', async () => {
    const { repo, sessionId } = await seedSession();
    const uc = new AddSessionExerciseUseCase(repo, makeExerciseRepo([ADD_ID]));
    const saveSpy = vi.spyOn(repo, 'save').mockRejectedValue(new Error('db connection lost'));

    await expect(
      uc.execute({
        sessionId,
        userId: OWNER_ID,
        exerciseId: ADD_ID,
        scheme: 'reps',
        sets: 3,
        targetReps: 8,
        expectedSessionVersion: 0,
      }),
    ).rejects.toThrow('db connection lost');

    saveSpy.mockRestore();
  });
});
