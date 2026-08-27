import { beforeEach, describe, expect, it } from 'vitest';

import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import { resetDatabase, setupTestDb, testDb } from '../setup';

describe('DrizzleProgramRepository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  it('lists all seeded programs', async () => {
    const repository = new DrizzleProgramRepository(testDb);
    const programs = await repository.list();

    expect(programs.length).toBeGreaterThan(0);
  });

  it('finds a program by slug with its workouts and schedule', async () => {
    const repository = new DrizzleProgramRepository(testDb);
    const program = await repository.findBySlug('fit40-beginner-strength');

    expect(program).not.toBeNull();
    expect(program?.workouts.length).toBeGreaterThan(0);
    expect(program?.weeks.length).toBeGreaterThan(0);
  });

  it('returns null when program slug does not exist', async () => {
    const repository = new DrizzleProgramRepository(testDb);
    const program = await repository.findBySlug('non-existent-program');

    expect(program).toBeNull();
  });
});
