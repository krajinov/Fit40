import { describe, expect, it } from 'vitest';

import { createExercise, type CreateExerciseInput } from '@/domain/entities/exercise';
import { filterExercises } from '@/domain/services/exercise-filtering';
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

describe('filterExercises', () => {
  const catalog = [
    makeExercise({
      name: 'Goblet Squat',
      slug: 'goblet-squat',
      primaryMuscle: MuscleGroup.Quadriceps,
      secondaryMuscles: [MuscleGroup.Glutes, MuscleGroup.Hamstrings],
      equipment: EquipmentType.Dumbbell,
      difficulty: Difficulty.Beginner,
      movementPattern: MovementPattern.Squat,
    }),
    makeExercise({
      name: 'Push-up',
      slug: 'push-up',
      primaryMuscle: MuscleGroup.Chest,
      secondaryMuscles: [MuscleGroup.Shoulders, MuscleGroup.Triceps],
      equipment: EquipmentType.Bodyweight,
      difficulty: Difficulty.Intermediate,
      movementPattern: MovementPattern.PushHorizontal,
    }),
    makeExercise({
      name: 'Bodyweight Squat',
      slug: 'bodyweight-squat',
      primaryMuscle: MuscleGroup.Quadriceps,
      secondaryMuscles: [MuscleGroup.Glutes],
      equipment: EquipmentType.Bodyweight,
      difficulty: Difficulty.Beginner,
      movementPattern: MovementPattern.Squat,
    }),
  ];

  it('returns the full catalog when no filters are set', () => {
    const result = filterExercises(catalog, {
      equipment: [],
      muscleGroups: [],
      difficulties: [],
    });

    expect(result).toHaveLength(3);
  });

  it('filters by equipment', () => {
    const result = filterExercises(catalog, {
      equipment: [EquipmentType.Bodyweight],
      muscleGroups: [],
      difficulties: [],
    });

    expect(result.map((e) => e.slug)).toEqual(['push-up', 'bodyweight-squat']);
  });

  it('filters by multiple equipment values using OR', () => {
    const result = filterExercises(catalog, {
      equipment: [EquipmentType.Dumbbell, EquipmentType.Bodyweight],
      muscleGroups: [],
      difficulties: [],
    });

    expect(result).toHaveLength(3);
  });

  it('filters by primary muscle group', () => {
    const result = filterExercises(catalog, {
      equipment: [],
      muscleGroups: [MuscleGroup.Chest],
      difficulties: [],
    });

    expect(result.map((e) => e.slug)).toEqual(['push-up']);
  });

  it('filters by secondary muscle group', () => {
    const result = filterExercises(catalog, {
      equipment: [],
      muscleGroups: [MuscleGroup.Shoulders],
      difficulties: [],
    });

    expect(result.map((e) => e.slug)).toEqual(['push-up']);
  });

  it('filters by difficulty', () => {
    const result = filterExercises(catalog, {
      equipment: [],
      muscleGroups: [],
      difficulties: [Difficulty.Beginner],
    });

    expect(result.map((e) => e.slug)).toEqual(['goblet-squat', 'bodyweight-squat']);
  });

  it('combines filters across dimensions using AND', () => {
    const result = filterExercises(catalog, {
      equipment: [EquipmentType.Bodyweight],
      muscleGroups: [MuscleGroup.Quadriceps],
      difficulties: [Difficulty.Beginner],
    });

    expect(result.map((e) => e.slug)).toEqual(['bodyweight-squat']);
  });

  it('returns an empty array when nothing matches', () => {
    const result = filterExercises(catalog, {
      equipment: [EquipmentType.Machine],
      muscleGroups: [],
      difficulties: [],
    });

    expect(result).toHaveLength(0);
  });

  it('does not mutate the source catalog', () => {
    const originalOrder = catalog.map((e) => e.slug);

    filterExercises(catalog, {
      equipment: [EquipmentType.Bodyweight],
      muscleGroups: [],
      difficulties: [],
    });

    expect(catalog.map((e) => e.slug)).toEqual(originalOrder);
    expect(catalog).toHaveLength(3);
  });
});