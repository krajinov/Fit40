import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeAll, expect, it } from 'vitest';

import { resolveWorkingLoadComparison } from '@/domain/services/occurrence-working-load';
import { DrizzleTrainingHistoryRepository } from '@/infrastructure/database/repositories/drizzle-training-history-repository';
import * as schema from '@/infrastructure/database/schema';

import { exerciseId, prSession, savePrSessions, seedUser, userId } from './personal-record-fixtures';
import { closeDatabase, db, resetAndSeed } from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'occurrence-capacity';
const SINCE = new Date('2026-06-29T00:00:00Z');
const COUNT = 32768;

beforeAll(async () => {
  await resetAndSeed();
  await seedUser(OWNER);
  await savePrSessions(prSession({
    id: 'capacity-session', userId: OWNER,
    startedAt: '2026-07-01T09:00:00Z', completedAt: '2026-07-01T10:00:00Z',
    logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 10 }] }],
  }));
  // Generate valid repeated occurrences without a bulk INSERT parameter ceiling.
  await db.execute(sql`
    insert into exercise_logs
      (session_id, exercise_order, exercise_id, prescription_type, sets, min_reps, max_reps, rest_seconds)
    select 'capacity-session', n, 'ex-002', 'reps', 1, 8, 8, 60
    from generate_series(2, ${COUNT}) n
  `);
  await db.execute(sql`
    insert into set_logs (session_id, exercise_order, set_number, type, reps, weight_kg)
    select 'capacity-session', n, 1, 'reps', 8, case when n = ${COUNT} then 20 else 10 end
    from generate_series(2, ${COUNT}) n
  `);
  // A different performed exercise in the same session must never leak into hydration.
  await db.execute(sql`
    insert into exercise_logs
      (session_id, exercise_order, exercise_id, prescription_type, sets, min_reps, max_reps, rest_seconds)
    values ('capacity-session', ${COUNT + 1}, 'ex-001', 'reps', 1, 8, 8, 60)
  `);
  await db.execute(sql`
    insert into set_logs (session_id, exercise_order, set_number, type, reps, weight_kg)
    values ('capacity-session', ${COUNT + 1}, 1, 'reps', 8, 999)
  `);
  await db.execute(sql`analyze workout_sessions, exercise_logs, set_logs`);
});

afterAll(closeDatabase);

it('hydrates 32,768 exact occurrence keys with two statements and one hydration parameter', async () => {
  const queries: { query: string; parameters: number }[] = [];
  const client = postgres(getTestDatabaseUrl(), {
    max: 1, prepare: false,
    debug: (_connection, query, parameters) => queries.push({ query, parameters: parameters.length }),
  });
  const repository = new DrizzleTrainingHistoryRepository(drizzle(client, { schema }));
  try {
    await repository.listCompletedExerciseOccurrences(userId(OWNER), exerciseId('ex-002'), 2);
    queries.length = 0;
    const rows = await repository.listCompletedExerciseOccurrencesSince(userId(OWNER), exerciseId('ex-002'), SINCE);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.parameters).toBe(1);
    expect(rows).toHaveLength(COUNT);
    expect(rows.every((row, index) => row.exerciseOrder === index + 1 && row.sets.length === 1)).toBe(true);
    expect(rows[0]?.sets[0]?.weightKg).toBe(10);
    expect(rows[COUNT - 1]?.sets[0]?.weightKg).toBe(20);
    expect(resolveWorkingLoadComparison(rows)).toMatchObject({ direction: 'increased' });

    queries.length = 0;
    const displayed = await repository.listCompletedExerciseOccurrences(userId(OWNER), exerciseId('ex-002'), 2);
    expect(queries).toHaveLength(2);
    expect(queries[1]?.parameters).toBe(1);
    expect(displayed.map((row) => row.exerciseOrder)).toEqual([COUNT, COUNT - 1]);
    expect(displayed.map((row) => row.sets[0]?.weightKg)).toEqual([20, 10]);
  } finally {
    await client.end();
  }
});
