import { beforeEach, describe, expect, it } from 'vitest';

import { DrizzleExerciseRepository } from '@/infrastructure/database/repositories/drizzle-exercise-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import { resetDatabase, setupTestDb, testDb } from '../setup';

describe('DrizzleExerciseRepository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  it('lists all seeded exercises', async () => {
    const repository = new DrizzleExerciseRepository(testDb);
    const exercises = await repository.list();

    expect(exercises.length).toBeGreaterThan(0);
  });

  it('finds an exercise by slug', async () => {
    const repository = new DrizzleExerciseRepository(testDb);
    const exercise = await repository.findBySlug('bodyweight-squat');

    expect(exercise).not.toBeNull();
    expect(exercise?.name).toBe('Bodyweight Squat');
  });

  it('returns null when exercise slug does not exist', async () => {
    const repository = new DrizzleExerciseRepository(testDb);
    const exercise = await repository.findBySlug('non-existent-exercise');

    expect(exercise).toBeNull();
  });
});
