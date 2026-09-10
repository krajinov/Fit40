/**
 * Tests for GetActiveWorkoutExerciseDataUseCase — the M9 Active Workout's
 * ONE-catalog-read composition helper. Verifies the single `list()` call
 * shared by display summaries and every distinct performed source's
 * candidate set (no per-source repository reads), unknown-id degradation,
 * and candidate mapping through the shared pure mapper.
 */

import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import { GetActiveWorkoutExerciseDataUseCase } from '@/application/use-cases/get-active-workout-exercise-data';
import {
  createExercise,
  type CreateExerciseInput,
  type Exercise,
} from '@/domain/entities/exercise';
import {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
} from '@/domain/types/exercise';

function makeExercise(overrides: Partial<CreateExerciseInput> & { id: string }): Exercise {
  const result = createExercise({
    name: `Exercise ${overrides.id}`,
    slug: `exercise-${overrides.id}`,
    description: 'A catalog exercise.',
    primaryMuscle: MuscleGroup.Quadriceps,
    secondaryMuscles: [],
    equipment: EquipmentType.Bodyweight,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.Squat,
    considerations: [],
    ...overrides,
  });
  if (!result.ok) throw new Error('fixture exercise failed validation');
  return result.data;
}

const bench = makeExercise({
  id: 'ex-bench',
  name: 'Bench Press',
  slug: 'bench-press',
  primaryMuscle: MuscleGroup.Chest,
  secondaryMuscles: [MuscleGroup.Triceps],
  equipment: EquipmentType.Barbell,
  difficulty: Difficulty.Intermediate,
  movementPattern: MovementPattern.PushHorizontal,
});

const dbBench = makeExercise({
  id: 'ex-db-bench',
  name: 'Dumbbell Bench Press',
  slug: 'dumbbell-bench-press',
  primaryMuscle: MuscleGroup.Chest,
  secondaryMuscles: [MuscleGroup.Triceps],
  equipment: EquipmentType.Dumbbell,
  difficulty: Difficulty.Intermediate,
  movementPattern: MovementPattern.PushHorizontal,
});

const pushup = makeExercise({
  id: 'ex-pushup',
  name: 'Push-up',
  slug: 'push-up',
  primaryMuscle: MuscleGroup.Chest,
  equipment: EquipmentType.Bodyweight,
  movementPattern: MovementPattern.PushHorizontal,
});

const row = makeExercise({
  id: 'ex-row',
  name: 'Bent-Over Row',
  slug: 'bent-over-row',
  primaryMuscle: MuscleGroup.Back,
  equipment: EquipmentType.Barbell,
  movementPattern: MovementPattern.PullHorizontal,
});

const CATALOG = [bench, dbBench, pushup, row];

function makeExerciseRepo(catalog: ReadonlyArray<Exercise>) {
  return {
    list: vi.fn(async () => catalog),
    findBySlug: vi.fn(),
    findByIds: vi.fn(),
  } satisfies ExerciseRepository;
}

describe('GetActiveWorkoutExerciseDataUseCase', () => {
  it('performs exactly ONE repository.list() for many distinct performed sources', async () => {
    const repo = makeExerciseRepo(CATALOG);
    const useCase = new GetActiveWorkoutExerciseDataUseCase(repo);

    const data = await useCase.execute({
      displayExerciseIds: ['ex-bench', 'ex-db-bench', 'ex-row', 'ex-bench'],
      performedExerciseIds: ['ex-bench', 'ex-db-bench', 'ex-row', 'ex-bench'],
    });

    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(repo.findByIds).not.toHaveBeenCalled();
    expect(data.summariesByExerciseId.size).toBe(3);
    expect(data.candidatesByPerformedExerciseId.size).toBe(3);
  });

  it('resolves performed and authored metadata from the same single catalog', async () => {
    const repo = makeExerciseRepo(CATALOG);

    const data = await new GetActiveWorkoutExerciseDataUseCase(repo).execute({
      // A substituted occurrence: authored bench, performed db-bench.
      displayExerciseIds: ['ex-db-bench', 'ex-bench'],
      performedExerciseIds: ['ex-db-bench'],
    });

    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(data.summariesByExerciseId.get('ex-bench')?.name).toBe('Bench Press');
    expect(data.summariesByExerciseId.get('ex-db-bench')?.equipment).toBe('dumbbell');
  });

  it('maps each source through the candidate mapper over the preloaded catalog', async () => {
    const repo = makeExerciseRepo(CATALOG);

    const data = await new GetActiveWorkoutExerciseDataUseCase(repo).execute({
      displayExerciseIds: ['ex-bench', 'ex-row'],
      performedExerciseIds: ['ex-bench', 'ex-row'],
    });

    const benchCandidates = data.candidatesByPerformedExerciseId.get('ex-bench');
    // Same pattern + same muscle tier: db-bench and pushup, ranked.
    expect(benchCandidates?.candidates.map((c) => c.exerciseId)).toEqual([
      'ex-db-bench',
      'ex-pushup',
    ]);
    expect(benchCandidates?.isLimited).toBe(false);

    // A structurally unmatched source yields an EMPTY candidate set —
    // never unrelated exercises.
    const rowCandidates = data.candidatesByPerformedExerciseId.get('ex-row');
    expect(rowCandidates?.candidates).toEqual([]);
  });

  it('computes candidates once per DISTINCT performed id, duplicates collapse', async () => {
    const repo = makeExerciseRepo(CATALOG);

    const data = await new GetActiveWorkoutExerciseDataUseCase(repo).execute({
      displayExerciseIds: ['ex-bench', 'ex-bench'],
      performedExerciseIds: ['ex-bench', 'ex-bench'],
    });

    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(data.candidatesByPerformedExerciseId.size).toBe(1);
  });

  it('omits unknown ids from both maps — never fabricates metadata or candidates', async () => {
    const repo = makeExerciseRepo(CATALOG);

    const data = await new GetActiveWorkoutExerciseDataUseCase(repo).execute({
      displayExerciseIds: ['ex-gone', 'ex-bench'],
      performedExerciseIds: ['ex-gone', 'ex-bench'],
    });

    expect(data.summariesByExerciseId.has('ex-gone')).toBe(false);
    expect(data.candidatesByPerformedExerciseId.has('ex-gone')).toBe(false);
    expect(data.summariesByExerciseId.get('ex-bench')?.name).toBe('Bench Press');
  });

  it('handles empty inputs without widening the catalog result', async () => {
    const repo = makeExerciseRepo(CATALOG);

    const data = await new GetActiveWorkoutExerciseDataUseCase(repo).execute({
      displayExerciseIds: [],
      performedExerciseIds: [],
    });

    expect(repo.list).toHaveBeenCalledTimes(1);
    expect(data.summariesByExerciseId.size).toBe(0);
    expect(data.candidatesByPerformedExerciseId.size).toBe(0);
  });
});

