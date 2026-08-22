import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import { GetExerciseBySlugUseCase } from '@/application/use-cases/get-exercise-by-slug';
import { createExercise, type CreateExerciseInput } from '@/domain/entities/exercise';
import {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
  PhysicalConsideration,
  SuitabilityLevel,
} from '@/domain/types/exercise';

function makeExercise(input: Partial<CreateExerciseInput> = {}) {
  const result = createExercise({
    id: 'ex-detail-001',
    name: 'Test Exercise',
    slug: 'test-exercise',
    description: 'Test description.',
    primaryMuscle: MuscleGroup.Back,
    secondaryMuscles: [MuscleGroup.Biceps],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Intermediate,
    movementPattern: MovementPattern.PullHorizontal,
    considerations: [
      { consideration: PhysicalConsideration.LowerBackSensitive, level: SuitabilityLevel.Caution },
    ],
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
  };
}

describe('GetExerciseBySlugUseCase', () => {
  it('returns a detail DTO when the exercise is found', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.findBySlug).mockResolvedValue(makeExercise({ slug: 'found-exercise' }));

    const useCase = new GetExerciseBySlugUseCase(repo);
    const result = await useCase.execute('found-exercise');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.slug).toBe('found-exercise');
    expect(result.data.secondaryMuscles).toContain(MuscleGroup.Biceps);
    expect(result.data.considerations).toHaveLength(1);
  });

  it('strips the branded id to a plain string', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.findBySlug).mockResolvedValue(makeExercise({ id: 'ex-detail-999' }));

    const useCase = new GetExerciseBySlugUseCase(repo);
    const result = await useCase.execute('test-exercise');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.id).toBe('ex-detail-999');
  });

  it('returns EXERCISE_NOT_FOUND when the slug does not exist', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.findBySlug).mockResolvedValue(null);

    const useCase = new GetExerciseBySlugUseCase(repo);
    const result = await useCase.execute('missing-exercise');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
    expect(result.error.slug).toBe('missing-exercise');
  });
});