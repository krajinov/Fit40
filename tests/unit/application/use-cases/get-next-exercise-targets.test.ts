import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type {
  LatestCompletedExercisePerformance,
  WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import {
  GetNextExerciseTargetsUseCase,
  type NextExerciseTargetRequest,
} from '@/application/use-cases/get-next-exercise-targets';
import { createExercise } from '@/domain/entities/exercise';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import { createExerciseId, createWorkoutSessionId } from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';

function rep(sets = 3, minReps = 8, maxReps = 10) {
  const result = createRepScheme(sets, minReps, maxReps);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function duration(sets = 3, seconds = 45) {
  const result = createDurationScheme(sets, seconds);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function sessionId() {
  const result = createWorkoutSessionId('sess-1');
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeExercise(id: string, equipment: EquipmentType = EquipmentType.Dumbbell) {
  const result = createExercise({
    id,
    name: `Exercise ${id}`,
    slug: `exercise-${id}`,
    description: `The ${id} exercise.`,
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [],
    equipment,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/**
 * Builds a `LatestCompletedExercisePerformance` projection for history stubs.
 * Only prescription and sets influence the engine; the other fields mirror
 * the port shape.
 */
function performance(
  exerciseId: string,
  prescription: ReturnType<typeof rep> | ReturnType<typeof duration>,
  sets: LatestCompletedExercisePerformance['sets'],
): LatestCompletedExercisePerformance {
  return {
    exerciseId: eid(exerciseId),
    sessionId: sessionId(),
    exerciseOrder: 1,
    completedAt: new Date('2026-08-01T10:00:00Z'),
    prescription,
    sets,
  };
}

function repSet(setNumber: number, reps: number, weightKg: number | null) {
  return { type: 'reps' as const, setNumber, reps, weightKg, rpe: null };
}

function request(exerciseId: string, prescription = rep()): NextExerciseTargetRequest {
  return { exerciseId: eid(exerciseId), prescription };
}

function createMockExerciseRepository(): ExerciseRepository {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds: vi.fn(),
  };
}

function createMockSessionRepository(): WorkoutSessionRepository {
  return {
    findById: vi.fn(),
    findByEnrollmentAndScheduledWorkout: vi.fn(),
    save: vi.fn(),
    listCompletedScheduledWorkoutIds: vi.fn(),
    listLatestCompletedExercisePerformances: vi.fn(),
  };
}

describe('GetNextExerciseTargetsUseCase', () => {
  it('returns one first-exposure target per request when no history exists', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(sessionRepo.listLatestCompletedExercisePerformances).mockResolvedValue([]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1')],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(1);
    expect(result.data[0]?.exerciseId).toBe('ex-1');
    expect(result.data[0]?.target).toEqual({ basis: 'first-exposure' });
  });

  it('zips results by request position, treating absent history as first exposure', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([
      makeExercise('ex-1'),
      makeExercise('ex-2'),
    ]);
    vi.mocked(sessionRepo.listLatestCompletedExercisePerformances).mockResolvedValue([
      performance('ex-1', rep(), [repSet(1, 10, 20), repSet(2, 10, 20), repSet(3, 10, 20)]),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1'), request('ex-2')],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.exerciseId).toBe('ex-1');
    expect(result.data[0]?.target).toEqual({
      basis: 'increase',
      previousLoadKg: 20,
      nextLoadKg: 22,
      incrementKg: 2,
    });
    expect(result.data[1]?.exerciseId).toBe('ex-2');
    expect(result.data[1]?.target).toEqual({ basis: 'first-exposure' });
  });

  it('queries each port once with deduplicated exercise ids', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(sessionRepo.listLatestCompletedExercisePerformances).mockResolvedValue([
      performance('ex-1', rep(), [repSet(1, 10, 20), repSet(2, 10, 20), repSet(3, 10, 20)]),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      // Same exercise scheduled twice with different prescriptions.
      requests: [request('ex-1'), request('ex-1', rep(3, 6, 8))],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toHaveLength(2);
    expect(result.data[0]?.target).toEqual({
      basis: 'increase',
      previousLoadKg: 20,
      nextLoadKg: 22,
      incrementKg: 2,
    });
    expect(result.data[1]?.target).toEqual({ basis: 'scheme-change' });

    expect(exerciseRepo.findByIds).toHaveBeenCalledTimes(1);
    expect(vi.mocked(exerciseRepo.findByIds).mock.calls[0]?.[0]).toEqual([eid('ex-1')]);
    expect(sessionRepo.listLatestCompletedExercisePerformances).toHaveBeenCalledTimes(1);
  });

  it('holds on mixed performance', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(sessionRepo.listLatestCompletedExercisePerformances).mockResolvedValue([
      performance('ex-1', rep(), [repSet(1, 10, 20), repSet(2, 8, 20), repSet(3, 8, 20)]),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1')],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]?.target).toEqual({ basis: 'hold', previousLoadKg: 20, nextLoadKg: 20 });
  });

  it('reports scheme-change when history was earned under a different scheme', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(sessionRepo.listLatestCompletedExercisePerformances).mockResolvedValue([
      performance('ex-1', rep(3, 6, 8), [repSet(1, 8, 20), repSet(2, 8, 20), repSet(3, 8, 20)]),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1', rep())],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]?.target).toEqual({ basis: 'scheme-change' });
  });

  it('defers to the engine for duration prescriptions with compatible history', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([makeExercise('ex-1')]);
    vi.mocked(sessionRepo.listLatestCompletedExercisePerformances).mockResolvedValue([
      performance('ex-1', duration(), [
        { type: 'duration', setNumber: 1, durationSeconds: 45, weightKg: 10, rpe: null },
      ]),
    ]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-1', duration())],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data[0]?.target).toEqual({ basis: 'duration' });
  });

  it('fails with EXERCISE_NOT_FOUND when a requested exercise no longer exists', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();
    vi.mocked(exerciseRepo.findByIds).mockResolvedValue([]);
    vi.mocked(sessionRepo.listLatestCompletedExercisePerformances).mockResolvedValue([]);

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({
      userId: 'user-1',
      requests: [request('ex-deleted')],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
    if (result.error.code !== 'EXERCISE_NOT_FOUND') return;
    expect(result.error.exerciseId).toBe('ex-deleted');
  });

  it('returns an empty result and queries no port for an empty request list', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({ userId: 'user-1', requests: [] });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual([]);
    expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
    expect(sessionRepo.listLatestCompletedExercisePerformances).not.toHaveBeenCalled();
  });

  it('rejects an invalid user id without querying any port', async () => {
    const exerciseRepo = createMockExerciseRepository();
    const sessionRepo = createMockSessionRepository();

    const useCase = new GetNextExerciseTargetsUseCase(exerciseRepo, sessionRepo);
    const result = await useCase.execute({
      userId: '',
      requests: [request('ex-1')],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('INVALID_INPUT');
    if (result.error.code !== 'INVALID_INPUT') return;
    expect(result.error.field).toBe('userId');
    expect(exerciseRepo.findByIds).not.toHaveBeenCalled();
    expect(sessionRepo.listLatestCompletedExercisePerformances).not.toHaveBeenCalled();
  });
});