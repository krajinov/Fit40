import { describe, expect, it } from 'vitest';

import { createExercise } from '@/domain/entities/exercise';
import {
  Difficulty,
  EquipmentType,
  MovementPattern,
  MuscleGroup,
  PhysicalConsideration,
  SuitabilityLevel,
} from '@/domain/types/exercise';

function validInput() {
  return {
    id: 'ex-test-001',
    name: 'Test Exercise',
    slug: 'test-exercise',
    description: 'A test exercise used only for unit tests.',
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [MuscleGroup.Shoulders, MuscleGroup.Triceps] as const,
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [] as const,
  };
}

describe('createExercise', () => {
  it('creates a valid exercise', () => {
    const result = createExercise(validInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.name).toBe('Test Exercise');
    expect(result.data.slug).toBe('test-exercise');
    expect(result.data.primaryMuscle).toBe(MuscleGroup.Chest);
  });

  it('rejects an empty id', () => {
    const result = createExercise({ ...validInput(), id: '   ' });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('id');
  });

  it('rejects an empty name', () => {
    const result = createExercise({ ...validInput(), name: '' });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('name');
  });

  it('rejects an empty description', () => {
    const result = createExercise({ ...validInput(), description: '   ' });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('description');
  });

  it('rejects an invalid slug', () => {
    const result = createExercise({ ...validInput(), slug: 'Test Exercise' });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('slug');
  });

  it('rejects when primary muscle appears in secondary muscles', () => {
    const result = createExercise({
      ...validInput(),
      secondaryMuscles: [MuscleGroup.Chest],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('secondaryMuscles');
  });

  it('rejects duplicate secondary muscles', () => {
    const result = createExercise({
      ...validInput(),
      secondaryMuscles: [MuscleGroup.Shoulders, MuscleGroup.Shoulders],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('secondaryMuscles');
  });

  it('rejects duplicate considerations', () => {
    const result = createExercise({
      ...validInput(),
      considerations: [
        { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Caution },
        { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Unsuitable },
      ],
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.field).toBe('considerations');
  });
});