import { describe, expect, it } from 'vitest';

import { createExercise, type CreateExerciseInput } from '@/domain/entities/exercise';
import {
  evaluateExerciseSuitability,
  getSuitabilityLevel,
} from '@/domain/services/exercise-suitability';
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
    id: 'ex-suitability-001',
    name: 'Suitability Test',
    slug: 'suitability-test',
    description: 'Test.',
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

describe('getSuitabilityLevel', () => {
  it('returns the stored level for a consideration', () => {
    const exercise = makeExercise({
      considerations: [
        { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Caution },
      ],
    });

    expect(getSuitabilityLevel(exercise, PhysicalConsideration.KneeSensitive)).toBe(
      SuitabilityLevel.Caution,
    );
  });

  it('defaults to suitable when no guidance is stored', () => {
    const exercise = makeExercise({ considerations: [] });

    expect(getSuitabilityLevel(exercise, PhysicalConsideration.KneeSensitive)).toBe(
      SuitabilityLevel.Suitable,
    );
  });
});

describe('evaluateExerciseSuitability', () => {
  it('marks knee-sensitive exercises that require caution', () => {
    const exercise = makeExercise({
      considerations: [
        { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Caution },
      ],
    });

    const result = evaluateExerciseSuitability(exercise, [
      PhysicalConsideration.KneeSensitive,
    ]);

    expect(result.overall).toBe(SuitabilityLevel.Caution);
    expect(result.details).toHaveLength(1);
    expect(result.details[0]).toEqual({
      consideration: PhysicalConsideration.KneeSensitive,
      level: SuitabilityLevel.Caution,
    });
  });

  it('marks lower-back-sensitive exercises that are unsuitable', () => {
    const exercise = makeExercise({
      considerations: [
        {
          consideration: PhysicalConsideration.LowerBackSensitive,
          level: SuitabilityLevel.Unsuitable,
        },
      ],
    });

    const result = evaluateExerciseSuitability(exercise, [
      PhysicalConsideration.LowerBackSensitive,
    ]);

    expect(result.overall).toBe(SuitabilityLevel.Unsuitable);
  });

  it('marks shoulder-sensitive exercises that are suitable', () => {
    const exercise = makeExercise({ considerations: [] });

    const result = evaluateExerciseSuitability(exercise, [
      PhysicalConsideration.ShoulderSensitive,
    ]);

    expect(result.overall).toBe(SuitabilityLevel.Suitable);
    expect(result.details[0]).toEqual({
      consideration: PhysicalConsideration.ShoulderSensitive,
      level: SuitabilityLevel.Suitable,
    });
  });

  it('returns the most restrictive level when multiple considerations are requested', () => {
    const exercise = makeExercise({
      considerations: [
        { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Caution },
        {
          consideration: PhysicalConsideration.LowerBackSensitive,
          level: SuitabilityLevel.Unsuitable,
        },
      ],
    });

    const result = evaluateExerciseSuitability(exercise, [
      PhysicalConsideration.KneeSensitive,
      PhysicalConsideration.LowerBackSensitive,
    ]);

    expect(result.overall).toBe(SuitabilityLevel.Unsuitable);
  });

  it('returns suitable with empty details when no considerations are requested', () => {
    const exercise = makeExercise({ considerations: [] });

    const result = evaluateExerciseSuitability(exercise, []);

    expect(result.overall).toBe(SuitabilityLevel.Suitable);
    expect(result.details).toHaveLength(0);
  });
});