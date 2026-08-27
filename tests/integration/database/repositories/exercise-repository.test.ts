import { beforeEach, describe, expect, it } from 'vitest';

import { Difficulty, EquipmentType, MovementPattern, MuscleGroup, PhysicalConsideration, SuitabilityLevel } from '@/domain/types/exercise';
import { DrizzleExerciseRepository } from '@/infrastructure/database/repositories/drizzle-exercise-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import { seedExercises } from '@/infrastructure/exercises/seed-exercises';
import { resetDatabase, setupTestDb, testDb } from '../setup';

describe('DrizzleExerciseRepository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  const repository = () => new DrizzleExerciseRepository(testDb);

  it('lists all seeded exercises', async () => {
    const exercises = await repository().list();

    expect(exercises).toHaveLength(seedExercises.length);
  });

  it('lists exercises ordered by name', async () => {
    const names = (await repository().list()).map((exercise) => exercise.name);

    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b)));
  });

  it('finds an exercise by slug', async () => {
    const exercise = await repository().findBySlug('bodyweight-squat');

    expect(exercise).not.toBeNull();
    expect(exercise?.id).toBe('ex-001');
    expect(exercise?.name).toBe('Bodyweight Squat');
    expect(exercise?.description).toContain('foundational lower-body exercise');
    expect(exercise?.primaryMuscle).toBe(MuscleGroup.Quadriceps);
    expect(exercise?.equipment).toBe(EquipmentType.Bodyweight);
    expect(exercise?.difficulty).toBe(Difficulty.Beginner);
    expect(exercise?.movementPattern).toBe(MovementPattern.Squat);
  });

  it('preserves secondary muscles in catalog order', async () => {
    const exercise = await repository().findBySlug('bodyweight-squat');

    expect(exercise?.secondaryMuscles).toEqual([
      MuscleGroup.Glutes,
      MuscleGroup.Hamstrings,
      MuscleGroup.Core,
    ]);
  });

  it('preserves consideration guidance entries', async () => {
    const exercise = await repository().findBySlug('bodyweight-squat');

    expect(exercise?.considerations).toEqual([
      { consideration: PhysicalConsideration.KneeSensitive, level: SuitabilityLevel.Caution },
      { consideration: PhysicalConsideration.LimitedMobility, level: SuitabilityLevel.Caution },
    ]);
  });

  it('reads an exercise without considerations as an empty list', async () => {
    const exercise = await repository().findBySlug('glute-bridge');

    expect(exercise?.considerations).toEqual([]);
  });

  it('reads exercises that share no fields with their neighbours', async () => {
    const [first, second] = await Promise.all([
      repository().findBySlug('push-up'),
      repository().findBySlug('dumbbell-bench-press'),
    ]);

    expect(first?.equipment).not.toBe(second?.equipment);
    expect(second?.equipment).toBe(EquipmentType.Dumbbell);
  });

  it('returns null when exercise slug does not exist', async () => {
    const exercise = await repository().findBySlug('non-existent-exercise');

    expect(exercise).toBeNull();
  });
});
