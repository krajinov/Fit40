import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import { ListExercisesUseCase } from '@/application/use-cases/list-exercises';
import { createExercise, type CreateExerciseInput } from '@/domain/entities/exercise';
import {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
} from '@/domain/types/exercise';

function makeExercise(input: Partial<CreateExerciseInput> = {}) {
  const result = createExercise({
    id: `ex-${Math.random().toString(36).slice(2)}`,
    name: 'Test Exercise',
    slug: `test-${Math.random().toString(36).slice(2)}`,
    description: 'Test description.',
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [],
    ...input,
  });

  if (!result.ok) {
    throw new Error(result.error.message);
  }

  return result.data;
}

function createMockRepository(): ExerciseRepository {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findByIds: vi.fn(),
  };
}

describe('ListExercisesUseCase', () => {
  it('returns summary DTOs for all exercises when no filters are set', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.list).mockResolvedValue([
      makeExercise({ name: 'Squat', slug: 'squat', primaryMuscle: MuscleGroup.Quadriceps }),
      makeExercise({ name: 'Push-up', slug: 'push-up', primaryMuscle: MuscleGroup.Chest }),
    ]);

    const useCase = new ListExercisesUseCase(repo);
    const result = await useCase.execute({
      equipment: [],
      muscleGroups: [],
      difficulties: [],
    });

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('Squat');
    expect(result[1]?.name).toBe('Push-up');
  });

  it('strips the branded id to a plain string in the DTO', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.list).mockResolvedValue([
      makeExercise({ id: 'ex-123', name: 'Squat', slug: 'squat' }),
    ]);

    const useCase = new ListExercisesUseCase(repo);
    const result = await useCase.execute({
      equipment: [],
      muscleGroups: [],
      difficulties: [],
    });

    expect(result[0]?.id).toBe('ex-123');
    expect(typeof result[0]?.id).toBe('string');
  });

  it('applies the filter criteria', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.list).mockResolvedValue([
      makeExercise({
        name: 'Bodyweight Squat',
        slug: 'bodyweight-squat',
        primaryMuscle: MuscleGroup.Quadriceps,
        equipment: EquipmentType.Bodyweight,
      }),
      makeExercise({
        name: 'Goblet Squat',
        slug: 'goblet-squat',
        primaryMuscle: MuscleGroup.Quadriceps,
        equipment: EquipmentType.Dumbbell,
      }),
    ]);

    const useCase = new ListExercisesUseCase(repo);
    const result = await useCase.execute({
      equipment: [EquipmentType.Dumbbell],
      muscleGroups: [],
      difficulties: [],
    });

    expect(result).toHaveLength(1);
    expect(result[0]?.slug).toBe('goblet-squat');
  });

  it('returns an empty array when the repository is empty', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.list).mockResolvedValue([]);

    const useCase = new ListExercisesUseCase(repo);
    const result = await useCase.execute({
      equipment: [],
      muscleGroups: [],
      difficulties: [],
    });

    expect(result).toHaveLength(0);
  });
});