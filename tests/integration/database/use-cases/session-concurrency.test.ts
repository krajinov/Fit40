/**
 * Concurrent session writes, driven through the use cases against PostgreSQL.
 *
 * Every session mutation is a read-then-write, so two overlapping requests can
 * both hold the same revision. The repository's compare-and-swap decides which one
 * lands, and the loser must be told with a typed conflict instead of having its
 * stale aggregate overwrite the winner's work.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { CompleteWorkoutSessionUseCase } from '@/application/use-cases/complete-workout-session';
import { LogSessionSetUseCase } from '@/application/use-cases/log-session-set';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { UpdateSessionSetUseCase } from '@/application/use-cases/update-session-set';
import { INITIAL_SESSION_VERSION } from '@/domain/entities/workout-session';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import {
  loadSessionOrThrow,
  readingAs,
  SEEDED_PROGRAM_SLUG,
  toSessionId,
} from '../fixtures';
import { resetDatabase, setupTestDb, testDb } from '../setup';

const START_INPUT = { programSlug: SEEDED_PROGRAM_SLUG, weekNumber: 1, workoutOrder: 1 };

const REPS = { type: 'reps', weightKg: null, rpe: null } as const;

describe('workout session concurrency (PostgreSQL)', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  it('reports the revision it stored on every mutating step', async () => {
    const { sessions, sessionId } = await startSession();

    const logged = await new LogSessionSetUseCase(sessions).execute({
      sessionId,
      exerciseOrder: 1,
      ...REPS,
      reps: 9,
    });
    expect(logged.ok).toBe(true);
    if (!logged.ok) return;
    expect(logged.data.version).toBe(INITIAL_SESSION_VERSION + 1);

    const completed = await new CompleteWorkoutSessionUseCase(sessions).execute({ sessionId });
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    expect(completed.data.version).toBe(INITIAL_SESSION_VERSION + 2);

    const stored = await sessions.findById(toSessionId(sessionId));
    expect(stored?.version).toBe(INITIAL_SESSION_VERSION + 2);
  });

  it('refuses a logged set written from a revision the database moved past', async () => {
    const { sessions, sessionId } = await startSession();
    const stale = await loadSessionOrThrow(sessions, sessionId);

    const winner = await new LogSessionSetUseCase(sessions).execute({
      sessionId,
      exerciseOrder: 1,
      ...REPS,
      reps: 9,
    });
    expect(winner.ok).toBe(true);

    const loser = await new LogSessionSetUseCase(readingAs(sessions, stale)).execute({
      sessionId,
      exerciseOrder: 2,
      ...REPS,
      reps: 12,
    });

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error).toMatchObject({ code: 'SESSION_MODIFIED', sessionId });

    // Nothing from the stale write reached storage, not even its child rows.
    const stored = await sessions.findById(toSessionId(sessionId));
    expect(stored?.exerciseLogs[0]?.sets).toEqual([
      { type: 'reps', setNumber: 1, reps: 9, weightKg: null, rpe: null },
    ]);
    expect(stored?.exerciseLogs[1]?.sets).toHaveLength(0);
  });

  it('refuses an updated set written from a revision the database moved past', async () => {
    const { sessions, sessionId } = await startSession();
    await new LogSessionSetUseCase(sessions).execute({
      sessionId,
      exerciseOrder: 1,
      ...REPS,
      reps: 9,
    });
    const stale = await loadSessionOrThrow(sessions, sessionId);

    const winner = await new UpdateSessionSetUseCase(sessions).execute({
      sessionId,
      exerciseOrder: 1,
      setNumber: 1,
      ...REPS,
      reps: 11,
    });
    expect(winner.ok).toBe(true);

    const loser = await new UpdateSessionSetUseCase(readingAs(sessions, stale)).execute({
      sessionId,
      exerciseOrder: 1,
      setNumber: 1,
      ...REPS,
      reps: 5,
    });

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error.code).toBe('SESSION_MODIFIED');

    const stored = await sessions.findById(toSessionId(sessionId));
    expect(stored?.exerciseLogs[0]?.sets).toEqual([
      { type: 'reps', setNumber: 1, reps: 11, weightKg: null, rpe: null },
    ]);
  });

  it('refuses to complete a session another request already changed', async () => {
    const { sessions, sessionId } = await startSession();
    // Completion needs at least one logged set, so start from a session that has
    // one and capture the revision it is at.
    expect(
      (
        await new LogSessionSetUseCase(sessions).execute({
          sessionId,
          exerciseOrder: 1,
          ...REPS,
          reps: 9,
        })
      ).ok,
    ).toBe(true);
    const stale = await loadSessionOrThrow(sessions, sessionId);

    // A second request logs another set before this one gets to complete.
    expect(
      (
        await new LogSessionSetUseCase(sessions).execute({
          sessionId,
          exerciseOrder: 2,
          ...REPS,
          reps: 12,
        })
      ).ok,
    ).toBe(true);

    const loser = await new CompleteWorkoutSessionUseCase(readingAs(sessions, stale)).execute({
      sessionId,
    });

    expect(loser.ok).toBe(false);
    if (loser.ok) return;
    expect(loser.error.code).toBe('SESSION_MODIFIED');

    // Completing from the older revision would have rolled the second set back.
    const stored = await sessions.findById(toSessionId(sessionId));
    expect(stored?.completedAt).toBeNull();
    expect(stored?.exerciseLogs[1]?.sets).toHaveLength(1);
  });
});

/** Starts a session through the real repositories and returns its identifier. */
async function startSession(): Promise<{
  sessions: DrizzleWorkoutSessionRepository;
  sessionId: string;
}> {
  const sessions = new DrizzleWorkoutSessionRepository(testDb);
  const programs = new DrizzleProgramRepository(testDb);
  const started = await new StartWorkoutSessionUseCase(programs, sessions).execute(START_INPUT);

  if (!started.ok) {
    throw new Error(`Failed to start the session under test: ${started.error.message}`);
  }

  return { sessions, sessionId: started.data.sessionId };
}

