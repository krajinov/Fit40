import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { exercises } from '@/infrastructure/database/schema';

import { closeDatabase, db, exerciseRepository, resetAndSeed } from './setup';

function exerciseRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ex-test-considerations',
    slug: 'test-considerations',
    name: 'Test Exercise',
    description: 'A test exercise for considerations validation.',
    primaryMuscle: 'chest',
    secondaryMuscles: [],
    equipment: 'bodyweight',
    difficulty: 'beginner',
    movementPattern: 'push-horizontal',
    ...overrides,
  };
}

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

  it('persists valid considerations and reads them back', async () => {
    const considerations = [
      { consideration: 'knee-sensitive', level: 'caution' },
      { consideration: 'limited-mobility', level: 'unsuitable' },
    ];

    await db.insert(exercises).values(exerciseRow({ considerations }));

    const exercise = await exerciseRepository.findBySlug('test-considerations');
    expect(exercise).not.toBeNull();
    expect(exercise?.considerations).toEqual(considerations);
  });

  it('rejects a non-array considerations payload', async () => {
    await expect(
      db.insert(exercises).values(exerciseRow({ considerations: { consideration: 'knee-sensitive', level: 'caution' } })),
    ).rejects.toThrow();
  });

  it('rejects an unsupported consideration value', async () => {
    await expect(
      db.insert(exercises).values(
        exerciseRow({ considerations: [{ consideration: 'banana', level: 'caution' }] }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an unsupported level value', async () => {
    await expect(
      db.insert(exercises).values(
        exerciseRow({ considerations: [{ consideration: 'knee-sensitive', level: 'awesome' }] }),
      ),
    ).rejects.toThrow();
  });

  it('rejects an entry missing a required key', async () => {
    await expect(
      db.insert(exercises).values(
        exerciseRow({ considerations: [{ consideration: 'knee-sensitive' }] }),
      ),
    ).rejects.toThrow();
  });
});

afterAll(async () => {
  await closeDatabase();
});
