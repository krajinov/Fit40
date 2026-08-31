import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createExerciseId } from '@/domain/types/ids';
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

  it('rejects a duplicate consideration key within the array', async () => {
    await expect(
      db.insert(exercises).values(
        exerciseRow({
          considerations: [
            { consideration: 'knee-sensitive', level: 'caution' },
            { consideration: 'knee-sensitive', level: 'suitable' },
          ],
        }),
      ),
    ).rejects.toThrow();
  });

  it('persists distinct secondary muscles and reads them back', async () => {
    await db.insert(exercises).values(exerciseRow({ secondaryMuscles: ['back', 'shoulders'] }));

    const exercise = await exerciseRepository.findBySlug('test-considerations');
    expect(exercise).not.toBeNull();
    expect(exercise?.secondaryMuscles).toEqual(['back', 'shoulders']);
  });

  it('rejects the primary muscle appearing in secondary_muscles', async () => {
    // exerciseRow() has primaryMuscle 'chest'.
    await expect(
      db.insert(exercises).values(exerciseRow({ secondaryMuscles: ['chest'] })),
    ).rejects.toThrow();
  });

  it('rejects duplicate values in secondary_muscles', async () => {
    await expect(
      db.insert(exercises).values(exerciseRow({ secondaryMuscles: ['back', 'back'] })),
    ).rejects.toThrow();
  });

  it('rejects duplicates anywhere in secondary_muscles (regression: non-adjacent tail)', async () => {
    // A duplicate in the head with a distinct tail element must still be rejected.
    await expect(
      db.insert(exercises).values(exerciseRow({ secondaryMuscles: ['back', 'back', 'biceps'] })),
    ).rejects.toThrow();
  });

  it('rejects an unsupported muscle value in secondary_muscles', async () => {
    await expect(
      db.insert(exercises).values(exerciseRow({ secondaryMuscles: ['banana'] })),
    ).rejects.toThrow();
  });
});

describe('DrizzleExerciseRepository.findByIds', () => {
  beforeEach(async () => {
    await resetAndSeed();
  });

  function eid(value: string) {
    const result = createExerciseId(value);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  }

  it('returns only the seeded exercises matching the requested ids', async () => {
    const result = await exerciseRepository.findByIds([eid('ex-001'), eid('ex-002')]);

    expect(result.map((exercise) => exercise.id).sort()).toEqual(['ex-001', 'ex-002']);

    const squat = result.find((exercise) => exercise.id === 'ex-001');
    expect(squat?.name).toBe('Bodyweight Squat');
  });

  it('returns an empty array for an empty id list', async () => {
    const result = await exerciseRepository.findByIds([]);

    expect(result).toEqual([]);
  });

  it('omits unknown ids and collapses duplicate ids to a single result', async () => {
    const result = await exerciseRepository.findByIds([
      eid('ex-001'),
      eid('ex-001'),
      eid('ex-unknown'),
    ]);

    expect(result).toHaveLength(1);
    expect(result[0]?.id).toBe('ex-001');
  });
});

afterAll(async () => {
  await closeDatabase();
});
