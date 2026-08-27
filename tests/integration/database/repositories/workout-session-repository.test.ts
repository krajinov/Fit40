import { beforeEach, describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import { resetDatabase, setupTestDb, testDb } from '../setup';
import type { ScheduledWorkoutId, WorkoutId } from '@/domain/types/ids';

async function createCompletedSession(sessionId: string): Promise<{
  repository: DrizzleWorkoutSessionRepository;
  session: WorkoutSession;
  scheduledWorkoutId: ScheduledWorkoutId;
  workoutId: WorkoutId;
}> {
  const programRepository = new DrizzleProgramRepository(testDb);
  const repository = new DrizzleWorkoutSessionRepository(testDb);

  const program = await programRepository.findBySlug('fit40-beginner-strength');
  expect(program).not.toBeNull();
  if (program === null) {
    throw new Error('Expected seed program to exist');
  }

  const week = program.weeks[0];
  expect(week).not.toBeUndefined();
  if (week === undefined) {
    throw new Error('Expected program to have at least one week');
  }

  const scheduled = week.scheduledWorkouts[0];
  expect(scheduled).not.toBeUndefined();
  if (scheduled === undefined) {
    throw new Error('Expected week to have at least one scheduled workout');
  }

  const workout = program.workouts.find((w) => w.id === scheduled.workoutId);
  expect(workout).not.toBeUndefined();
  if (workout === undefined) {
    throw new Error('Expected scheduled workout to exist in program');
  }

  const exercise = workout.exercises[0];
  expect(exercise).not.toBeUndefined();
  if (exercise === undefined) {
    throw new Error('Expected workout to have at least one exercise');
  }

  const sessionResult = createWorkoutSession({
    id: sessionId,
    scheduledWorkoutId: scheduled.id,
    workoutId: workout.id,
    startedAt: new Date('2026-08-27T10:00:00.000Z'),
    exerciseLogs: [
      {
        exerciseId: exercise.exerciseId,
        order: exercise.order,
        prescription:
          exercise.prescription.type === 'reps'
            ? { type: 'reps' as const, sets: 1, minReps: 1, maxReps: 1 }
            : { type: 'duration' as const, sets: 1, seconds: 1 },
        restSeconds: 60,
      },
    ],
  });

  expect(sessionResult.ok).toBe(true);
  if (!sessionResult.ok) {
    throw new Error('Failed to create workout session');
  }

  const setInput =
    exercise.prescription.type === 'reps'
      ? { exerciseOrder: exercise.order, type: 'reps' as const, reps: 8, weightKg: 20, rpe: 8 }
      : {
          exerciseOrder: exercise.order,
          type: 'duration' as const,
          durationSeconds: 30,
          weightKg: 20,
          rpe: 8,
        };

  const logResult = logSessionSet(sessionResult.data, setInput);
  expect(logResult.ok).toBe(true);
  if (!logResult.ok) {
    throw new Error('Failed to log session set');
  }

  const completedResult = completeWorkoutSession(
    logResult.data,
    new Date('2026-08-27T11:00:00.000Z'),
  );
  expect(completedResult.ok).toBe(true);
  if (!completedResult.ok) {
    throw new Error('Failed to complete workout session');
  }

  return {
    repository,
    session: completedResult.data,
    scheduledWorkoutId: scheduled.id as ScheduledWorkoutId,
    workoutId: workout.id as WorkoutId,
  };
}

describe('DrizzleWorkoutSessionRepository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  it('saves and retrieves a workout session', async () => {
    const { repository, session } = await createCompletedSession('session-001');

    await repository.save(session);

    const loaded = await repository.findById(session.id);

    expect(loaded).not.toBeNull();
    expect(loaded?.exerciseLogs).toHaveLength(1);
    expect(loaded?.exerciseLogs[0]?.restSeconds).toBe(60);
    expect(loaded?.exerciseLogs[0]?.sets).toHaveLength(1);
  });

  it('finds a session by scheduled workout id', async () => {
    const { repository, session, scheduledWorkoutId } = await createCompletedSession('session-002');

    await repository.save(session);

    const loaded = await repository.findByScheduledWorkoutId(scheduledWorkoutId);

    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(session.id);
  });
});
