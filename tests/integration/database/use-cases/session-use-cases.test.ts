/**
 * Use cases driven against the real database.
 *
 * These cover the parts the unit suite cannot reach: the repository translating
 * PostgreSQL's unique violation into the port's conflict result, and the
 * update-path saves round-tripping through the new constraint-backed schema.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import { createWorkoutSessionId, type WorkoutSessionId } from '@/domain/types/ids';
import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';
import { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import { SEEDED_PROGRAM_SLUG } from '../fixtures';
import { resetDatabase, setupTestDb, testDb } from '../setup';

const START_INPUT = { programSlug: SEEDED_PROGRAM_SLUG, weekNumber: 1, workoutOrder: 1 };

describe('workout session use cases (PostgreSQL)', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  it('persists a started session and reads it back through the query use case', async () => {
    const sessions = new DrizzleWorkoutSessionRepository(testDb);
    const programs = new DrizzleProgramRepository(testDb);
    const started = await new StartWorkoutSessionUseCase(programs, sessions).execute(START_INPUT);

    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.data.status).toBe('in-progress');
    expect(started.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3, 4, 5]);
    expect(started.data.exerciseLogs[0]?.prescription).toEqual({
      type: 'reps',
      sets: 3,
      minReps: 8,
      maxReps: 10,
    });
    expect(started.data.exerciseLogs[0]?.sets).toEqual([]);

    const fetched = await new GetWorkoutSessionUseCase(programs, sessions).execute(START_INPUT);

    expect(fetched.ok).toBe(true);
    if (!fetched.ok) return;
    expect(fetched.data?.sessionId).toBe(started.data.sessionId);
  });

  it('rejects a second start for the same scheduled workout', async () => {
    const sessions = new DrizzleWorkoutSessionRepository(testDb);
    const programs = new DrizzleProgramRepository(testDb);
    const useCase = new StartWorkoutSessionUseCase(programs, sessions);

    expect((await useCase.execute(START_INPUT)).ok).toBe(true);
    const second = await useCase.execute(START_INPUT);

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('SESSION_ALREADY_EXISTS');
  });

  it('maps a lost start race onto the database constraint', async () => {
    const sessions = new DrizzleWorkoutSessionRepository(testDb);
    const programs = new DrizzleProgramRepository(testDb);
    // Both requests pass the existence pre-check; only the unique constraint can
    // decide the winner, which the repository must report as a conflict.
    const useCase = new StartWorkoutSessionUseCase(programs, skippingExistenceCheck(sessions));

    expect((await useCase.execute(START_INPUT)).ok).toBe(true);
    const loser = await useCase.execute(START_INPUT);

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error.code).toBe('SESSION_ALREADY_EXISTS');
  });

  it('persists logged sets and completion', async () => {
    const sessions = new DrizzleWorkoutSessionRepository(testDb);
    const programs = new DrizzleProgramRepository(testDb);
    const started = await new StartWorkoutSessionUseCase(programs, sessions).execute(START_INPUT);
    expect(started.ok).toBe(true);
    if (!started.ok) return;

    const sessionId = started.data.sessionId;
    const logged = await new LogSessionSetUseCase(sessions).execute({
      sessionId,
      exerciseOrder: 1,
      type: 'reps',
      reps: 9,
      weightKg: 22.5,
      rpe: 8,
    });

    expect(logged.ok).toBe(true);
    const completed = await new CompleteWorkoutSessionUseCase(sessions).execute({ sessionId });

    expect(completed.ok).toBe(true);
    const stored = await sessions.findById(toSessionId(sessionId));
    expect(stored?.completedAt).not.toBeNull();
    expect(stored?.exerciseLogs[0]?.sets).toEqual([
      { type: 'reps', setNumber: 1, reps: 9, weightKg: 22.5, rpe: 8 },
    ]);
  });
});

function toSessionId(value: string): WorkoutSessionId {
  const result = createWorkoutSessionId(value);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

/** Delegates every call except the existence pre-check, which always misses. */
function skippingExistenceCheck(
  sessions: WorkoutSessionRepository,
): WorkoutSessionRepository {
  return {
    findById: (id) => sessions.findById(id),
    findByScheduledWorkoutId: async () => null,
    save: (session) => sessions.save(session),
    listCompleted: () => sessions.listCompleted(),
  };
}
