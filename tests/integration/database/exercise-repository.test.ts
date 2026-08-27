import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { closeDatabase, exerciseRepository, resetAndSeed } from './setup';

describe('DrizzleExerciseRepository', () => {
  beforeEach(async () => {
    await resetAndSeed();
  });

  it('list() returns all seeded exercises mapped correctly', async () => {
    const exercises = await exerciseRepository.list();

    expect(exercises.length).toBe(17);

    const squat = exercises.find((exercise) => exercise.slug === 'bodyweight-squat');
    expect(squat).toBeDefined();
    expect(squat?.id).toBe('ex-001');
    expect(squat?.primaryMuscle).toBe('quadriceps');
    expect(squat?.secondaryMuscles).toContain('glutes');
    expect(squat?.considerations.length).toBeGreaterThan(0);
  });

  it('findBySlug() returns exercise with arrays and considerations', async () => {
    const exercise = await exerciseRepository.findBySlug('bodyweight-squat');

    expect(exercise).not.toBeNull();
    expect(exercise?.id).toBe('ex-001');
    expect(exercise?.name).toBe('Bodyweight Squat');
    expect(exercise?.considerations[0]?.level).toBe('caution');
  });

  it('findBySlug() returns null for unknown slug', async () => {
    const exercise = await exerciseRepository.findBySlug('does-not-exist');

    expect(exercise).toBeNull();
  });
});

afterAll(async () => {
  await closeDatabase();
});
