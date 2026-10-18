import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { GetExerciseHistoryPresenceUseCase } from '@/application/use-cases/get-exercise-history-presence';
import * as schema from '@/infrastructure/database/schema';
import { DrizzleExerciseRepository } from '@/infrastructure/database/repositories/drizzle-exercise-repository';
import { DrizzleTrainingHistoryRepository } from '@/infrastructure/database/repositories/drizzle-training-history-repository';

import { prSession, savePrSessions, seedEnrollment, seedUser, type PrSessionSpec } from './personal-record-fixtures';
import { closeDatabase, exerciseRepository, resetAndSeed, trainingHistoryRepository } from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'presence-owner';
const ENROLLMENT = 'presence-enrollment';
const useCase = new GetExerciseHistoryPresenceUseCase(trainingHistoryRepository, exerciseRepository);
const input = { userId: OWNER, slug: 'goblet-squat' };

function session(overrides: Partial<PrSessionSpec> = {}) {
  return prSession({
    id: 'presence-session', userId: OWNER, enrollmentId: ENROLLMENT,
    startedAt: '2026-01-01T10:00:00Z', completedAt: '2026-01-01T11:00:00Z',
    logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 20 }] }],
    ...overrides,
  });
}

beforeEach(async () => {
  await resetAndSeed();
  await seedUser(OWNER);
  await seedEnrollment(ENROLLMENT, OWNER, 'prog-beginner-strength');
});
afterAll(closeDatabase);

describe('exercise history presence over PostgreSQL', () => {
  it('reports completed history present', async () => {
    await savePrSessions(session());
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'present' } });
  });

  it('reports a successful no-history read absent', async () => {
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'absent' } });
  });

  it('credits a substituted occurrence only to the replacement exercise', async () => {
    await savePrSessions(session({ logs: [
      { exerciseId: 'ex-004', performedExerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
    ] }));
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'present' } });
    expect(await useCase.execute({ ...input, slug: 'dumbbell-romanian-deadlift' })).toEqual({
      ok: true, data: { status: 'absent' },
    });
  });

  it.each([true, false])('excludes a zero-set occurrence (skipped=%s) in a completed session', async (isSkipped) => {
    await savePrSessions(session({ logs: [
      { exerciseId: 'ex-002', type: 'reps', sets: [], isSkipped },
      { exerciseId: 'ex-004', type: 'reps', sets: [{ reps: 10 }] },
    ] }));
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'absent' } });
  });

  it('includes a detached completed session', async () => {
    await savePrSessions(session({ enrollmentId: null }));
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'present' } });
  });

  it('excludes in-progress history even with logged sets', async () => {
    await savePrSessions(session({ completedAt: undefined }));
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'absent' } });
  });

  it('never exposes another user’s history', async () => {
    await seedUser('presence-other');
    await savePrSessions(session({ userId: 'presence-other', enrollmentId: null }));
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'absent' } });
  });

  it('bounds statement count independently of history size and hydrates only one occurrence', async () => {
    const queries: { query: string; parameters: readonly unknown[] }[] = [];
    const client = postgres(getTestDatabaseUrl(), {
      max: 1, prepare: false,
      debug: (_connection, query, parameters) => { queries.push({ query, parameters }); },
    });
    const db = drizzle(client, { schema });
    const counting = new GetExerciseHistoryPresenceUseCase(
      new DrizzleTrainingHistoryRepository(db), new DrizzleExerciseRepository(db),
    );
    try {
      await counting.execute(input); // Warm driver type discovery.
      queries.length = 0;
      expect(await counting.execute(input)).toEqual({ ok: true, data: { status: 'absent' } });
      expect(queries).toHaveLength(2); // Slug lookup + empty occurrence selection.

      await savePrSessions(session());
      queries.length = 0;
      await counting.execute(input);
      expect(queries).toHaveLength(3); // Slug + occurrence + batched sets.

      await savePrSessions(...Array.from({ length: 20 }, (_, index) => session({
        id: `presence-many-${index}`, enrollmentId: null,
      })));
      queries.length = 0;
      expect(await counting.execute(input)).toEqual({ ok: true, data: { status: 'present' } });
      expect(queries).toHaveLength(3);
      const hydration = queries.find(({ query }) => query.includes('jsonb_to_recordset'));
      expect(hydration).toBeDefined();
      const keys = hydration?.parameters.find((parameter) => typeof parameter === 'string' && parameter.startsWith('['));
      expect(typeof keys).toBe('string');
      if (typeof keys !== 'string') throw new Error('Missing occurrence hydration keys');
      expect(JSON.parse(keys)).toHaveLength(1);
    } finally {
      await client.end();
    }
  });
});
