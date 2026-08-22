import { describe, expect, it } from 'vitest';

import { InMemoryExerciseRepository } from '@/infrastructure/exercises/in-memory-exercise-repository';
import { seedExercises } from '@/infrastructure/exercises/seed-exercises';

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
});