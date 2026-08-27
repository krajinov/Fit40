/**
 * Referential integrity behaviour of the hardened schema.
 *
 * These cover what the constraint *kinds* guarantee: catalog rows a session
 * depends on cannot be deleted, child rows disappear with their parent, and the
 * schedule cannot reference a week or slot that does not exist.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { and, eq } from 'drizzle-orm';

import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import {
  exerciseLogs,
  exercises,
  scheduledWorkouts,
  setLogs,
  workoutExercises,
  workoutSessions,
} from '@/infrastructure/database/schema';
import { loadOccurrence, startSession } from '../fixtures';
import { resetDatabase, setupTestDb, testDb } from '../setup';
import { failureMessage } from './constraint-helpers';

const SESSION_ID = 'integrity-session';
const PROGRAM_ID = 'prog-beginner-strength';

async function seedSession(): Promise<void> {
  const occurrence = await loadOccurrence();
  const saved = await new DrizzleWorkoutSessionRepository(testDb).save(
    startSession(SESSION_ID, occurrence),
  );

  if (!saved.ok) {
    throw new Error('Failed to seed the session used by the integrity tests');
  }
}

describe('referential integrity', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
    await seedSession();
  });

  it('refuses to delete a catalog exercise a program template depends on', async () => {
    const message = await failureMessage(() =>
      testDb.delete(exercises).where(eq(exercises.id, 'ex-002')),
    );

    expect(message).toMatch(/workout_exercises_exercise_id_fk/);
  });

  it('refuses to delete a catalog exercise a session log depends on', async () => {
    await testDb.insert(exercises).values({
      id: 'ex-probe',
      slug: 'probe-hold',
      name: 'Probe Hold',
      description: 'A catalog exercise referenced only by a logged session.',
      primaryMuscle: 'core',
      secondaryMuscles: [],
      equipment: 'bodyweight',
      difficulty: 'beginner',
      movementPattern: 'core',
      considerations: [],
    });
    await testDb.insert(exerciseLogs).values({
      sessionId: SESSION_ID,
      exerciseOrder: 90,
      exerciseId: 'ex-probe',
      prescriptionType: 'reps',
      sets: 3,
      minReps: 8,
      maxReps: 12,
      durationSeconds: null,
      restSeconds: 60,
    });

    const message = await failureMessage(() =>
      testDb.delete(exercises).where(eq(exercises.id, 'ex-probe')),
    );

    expect(message).toMatch(/exercise_logs_exercise_id_fk/);
    expect(await testDb.select().from(exercises).where(eq(exercises.id, 'ex-probe'))).toHaveLength(1);
  });

  it('cascades from an exercise log to its set logs', async () => {
    await testDb.insert(setLogs).values({
      sessionId: SESSION_ID,
      exerciseOrder: 1,
      setNumber: 1,
      type: 'reps',
      reps: 8,
      durationSeconds: null,
      weightKg: '20',
      rpe: 8,
    });

    await testDb
      .delete(exerciseLogs)
      .where(and(eq(exerciseLogs.sessionId, SESSION_ID), eq(exerciseLogs.exerciseOrder, 1)));

    expect(
      await testDb
        .select()
        .from(setLogs)
        .where(eq(setLogs.sessionId, SESSION_ID)),
    ).toHaveLength(0);
  });

  it('cascades from a session to its exercise and set logs', async () => {
    await testDb.delete(workoutSessions).where(eq(workoutSessions.id, SESSION_ID));

    expect(
      await testDb.select().from(exerciseLogs).where(eq(exerciseLogs.sessionId, SESSION_ID)),
    ).toHaveLength(0);
    expect(
      await testDb.select().from(setLogs).where(eq(setLogs.sessionId, SESSION_ID)),
    ).toHaveLength(0);
  });

  it('refuses a scheduled occurrence without a matching program week', async () => {
    const message = await failureMessage(() =>
      testDb.insert(scheduledWorkouts).values({
        id: 'sched-missing-week',
        programId: PROGRAM_ID,
        weekNumber: 99,
        workoutId: 'wo-beginner-strength-a',
        orderInWeek: 1,
      }),
    );

    expect(message).toMatch(/scheduled_workouts_program_week_fk/);
  });

  it('refuses two occurrences claiming the same slot in a week', async () => {
    const message = await failureMessage(() =>
      testDb.insert(scheduledWorkouts).values({
        id: 'sched-duplicate-slot',
        programId: PROGRAM_ID,
        weekNumber: 1,
        workoutId: 'wo-beginner-strength-b',
        orderInWeek: 1,
      }),
    );

    expect(message).toMatch(/scheduled_workouts_program_week_order_idx/);
  });

  it('refuses an exercise template with an inverted rep range', async () => {
    const message = await failureMessage(() =>
      testDb.insert(workoutExercises).values({
        workoutId: 'wo-beginner-strength-a',
        exerciseOrder: 90,
        exerciseId: 'ex-001',
        prescriptionType: 'reps',
        sets: 3,
        minReps: 12,
        maxReps: 8,
        durationSeconds: null,
        restSeconds: 60,
      }),
    );

    expect(message).toMatch(/chk_workout_exercises_reps_range/);
  });

  it('refuses catalog rows outside the domain vocabulary', async () => {
    const movementPattern = await failureMessage(() =>
      testDb.insert(exercises).values({
        id: 'ex-teleport',
        slug: 'teleporting',
        name: 'Teleporting',
        description: 'An exercise whose classification is not part of the domain.',
        primaryMuscle: 'quadriceps',
        secondaryMuscles: [],
        equipment: 'bodyweight',
        difficulty: 'beginner',
        movementPattern: 'teleportation',
        considerations: [],
      }),
    );

    expect(movementPattern).toMatch(/chk_exercises_movement_pattern/);

    const equipment = await failureMessage(() =>
      testDb.insert(exercises).values({
        id: 'ex-replicator',
        slug: 'replicator-curl',
        name: 'Replicator Curl',
        description: 'An exercise that requires equipment the domain does not model.',
        primaryMuscle: 'biceps',
        secondaryMuscles: [],
        equipment: 'replicator',
        difficulty: 'beginner',
        movementPattern: 'isolation',
        considerations: [],
      }),
    );

    expect(equipment).toMatch(/chk_exercises_equipment/);
  });
});
