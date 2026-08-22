import { describe, expect, it } from 'vitest';

import { InMemoryProgramRepository } from '@/infrastructure/programs/in-memory-program-repository';
import { seedPrograms } from '@/infrastructure/programs/seed-programs';

describe('InMemoryProgramRepository', () => {
  it('lists all seed programs', async () => {
    const repository = new InMemoryProgramRepository();

    const programs = await repository.list();

    expect(programs).toHaveLength(seedPrograms.length);
  });

  it('returns a shallow copy from list', async () => {
    const repository = new InMemoryProgramRepository();

    const first = await repository.list();
    const second = await repository.list();

    expect(first).not.toBe(second);
    expect(first).toEqual(second);
  });

  it('finds a program by slug', async () => {
    const repository = new InMemoryProgramRepository();

    const program = await repository.findBySlug('fit40-beginner-strength');

    expect(program).not.toBeNull();
    expect(program?.name).toBe('Fit40 Beginner Strength');
  });

  it('returns null for an unknown slug', async () => {
    const repository = new InMemoryProgramRepository();

    const program = await repository.findBySlug('does-not-exist');

    expect(program).toBeNull();
  });
});