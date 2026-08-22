import { describe, expect, it } from 'vitest';

import {
  exerciseSlugSchema,
  parseExerciseFilters,
} from '@/features/exercises/schemas/exercise-filters-schema';

describe('parseExerciseFilters', () => {
  it('returns empty criteria for undefined params', () => {
    const result = parseExerciseFilters({});

    expect(result).toEqual({
      equipment: [],
      muscleGroups: [],
      difficulties: [],
    });
  });

  it('keeps valid single-string values', () => {
    const result = parseExerciseFilters({
      equipment: 'dumbbell',
      muscle: 'chest',
      difficulty: 'beginner',
    });

    expect(result).toEqual({
      equipment: ['dumbbell'],
      muscleGroups: ['chest'],
      difficulties: ['beginner'],
    });
  });

  it('keeps valid array values', () => {
    const result = parseExerciseFilters({
      equipment: ['dumbbell', 'bodyweight'],
      muscle: ['quadriceps', 'glutes'],
      difficulty: ['beginner', 'intermediate'],
    });

    expect(result).toEqual({
      equipment: ['dumbbell', 'bodyweight'],
      muscleGroups: ['quadriceps', 'glutes'],
      difficulties: ['beginner', 'intermediate'],
    });
  });

  it('drops invalid values and keeps valid ones', () => {
    const result = parseExerciseFilters({
      equipment: ['dumbbell', 'invalid-equipment'],
      muscle: ['invalid-muscle', 'back'],
      difficulty: ['expert', 'advanced'],
    });

    expect(result).toEqual({
      equipment: ['dumbbell'],
      muscleGroups: ['back'],
      difficulties: ['advanced'],
    });
  });

  it('deduplicates repeated values', () => {
    const result = parseExerciseFilters({
      equipment: ['dumbbell', 'dumbbell'],
      muscle: ['chest', 'chest'],
      difficulty: ['beginner', 'beginner'],
    });

    expect(result).toEqual({
      equipment: ['dumbbell'],
      muscleGroups: ['chest'],
      difficulties: ['beginner'],
    });
  });

  it('maps muscle to muscleGroups and difficulty to difficulties', () => {
    const result = parseExerciseFilters({
      muscle: 'glutes',
      difficulty: 'intermediate',
    });

    expect(result).toEqual({
      equipment: [],
      muscleGroups: ['glutes'],
      difficulties: ['intermediate'],
    });
  });
});

describe('exerciseSlugSchema', () => {
  it('accepts a valid kebab-case slug', () => {
    const result = exerciseSlugSchema.safeParse('dumbbell-bench-press');

    expect(result.success).toBe(true);
  });

  it('rejects a slug with uppercase letters', () => {
    const result = exerciseSlugSchema.safeParse('Dumbbell-Bench-Press');

    expect(result.success).toBe(false);
  });

  it('rejects a slug with spaces', () => {
    const result = exerciseSlugSchema.safeParse('dumbbell bench press');

    expect(result.success).toBe(false);
  });

  it('rejects an empty slug', () => {
    const result = exerciseSlugSchema.safeParse('');

    expect(result.success).toBe(false);
  });
});