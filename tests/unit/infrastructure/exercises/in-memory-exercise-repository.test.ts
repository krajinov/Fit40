import { describe, expect, it } from 'vitest';

import { createExerciseId } from '@/domain/types/ids';
import { InMemoryExerciseRepository } from '@/infrastructure/exercises/in-memory-exercise-repository';
import { seedExercises } from '@/infrastructure/exercises/seed-exercises';

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('InMemoryExerciseRepository', () => {
  const repository = new InMemoryExerciseRepository();

  it('lists all seeded exercises', async () => {
    const result = await repository.list();

    expect(result).toHaveLength(seedExercises.length);
  });

  it('returns a fresh copy of the catalog on each call', async () => {
    const first = await repository.list();
    const second = await repository.list();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('finds an exercise by slug', async () => {
    const result = await repository.findBySlug('push-up');

    expect(result).not.toBeNull();
    expect(result?.name).toBe('Push-up');
  });

  it('returns null for an unknown slug', async () => {
    const result = await repository.findBySlug('does-not-exist');

    expect(result).toBeNull();
  });

  it('returns null for an empty slug', async () => {
    const result = await repository.findBySlug('');

    expect(result).toBeNull();
  });

  describe('findByIds', () => {
    it('returns only the exercises matching the requested ids', async () => {
      const [first, second] = seedExercises;
      if (first === undefined || second === undefined) throw new Error('Seed catalog is empty');

      const result = await repository.findByIds([first.id, second.id]);

      expect(result.map((exercise) => exercise.id)).toEqual([first.id, second.id]);
    });

    it('returns an empty array for an empty id list', async () => {
      const result = await repository.findByIds([]);

      expect(result).toEqual([]);
    });

    it('collapses duplicate ids to a single result', async () => {
      const [first] = seedExercises;
      if (first === undefined) throw new Error('Seed catalog is empty');

      const result = await repository.findByIds([first.id, first.id]);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(first.id);
    });

    it('omits ids that do not exist in the catalog', async () => {
      const [first] = seedExercises;
      if (first === undefined) throw new Error('Seed catalog is empty');

      const result = await repository.findByIds([first.id, eid('ex-unknown')]);

      expect(result).toHaveLength(1);
      expect(result[0]?.id).toBe(first.id);
    });
  });
});