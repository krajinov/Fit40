/**
 * Session schema constraints.
 *
 * Inserts are written with raw statements because the repositories and domain
 * already refuse these shapes: the point is that PostgreSQL refuses them too, so
 * no future writer, seed, or migration can store the data by accident.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { eq } from 'drizzle-orm';

import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import { exerciseLogs, setLogs, workoutSessions } from '@/infrastructure/database/schema';
import { loadOccurrence, startSession } from '../fixtures';
import { resetDatabase, setupTestDb, testDb } from '../setup';
import { failureMessage } from './constraint-helpers';

const SESSION_ID = 'constraint-session';

type ExerciseLogValues = typeof exerciseLogs.$inferInsert;
type SetLogValues = typeof setLogs.$inferInsert;

function exerciseLog(overrides: Partial<ExerciseLogValues>): ExerciseLogValues {
  return {
    sessionId: SESSION_ID,
    exerciseOrder: 9,
    exerciseId: 'ex-001',
    prescriptionType: 'reps',
    sets: 3,
    minReps: 8,
    maxReps: 12,
    durationSeconds: null,
    restSeconds: 60,
    ...overrides,
  };
}

function setLog(overrides: Partial<SetLogValues>): SetLogValues {
  return {
    sessionId: SESSION_ID,
    exerciseOrder: 1,
    setNumber: 1,
    type: 'reps',
    reps: 8,
    durationSeconds: null,
    weightKg: '20.5',
    rpe: 8,
    ...overrides,
  };
}

function insertExerciseLog(overrides: Partial<ExerciseLogValues>): Promise<string> {
  return failureMessage(() => testDb.insert(exerciseLogs).values(exerciseLog(overrides)));
}

function insertSetLog(overrides: Partial<SetLogValues>): Promise<string> {
  return failureMessage(() => testDb.insert(setLogs).values(setLog(overrides)));
}

describe('session schema constraints', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);

    const occurrence = await loadOccurrence();
    const saved = await new DrizzleWorkoutSessionRepository(testDb).save(
      startSession(SESSION_ID, occurrence),
    );
    if (!saved.ok) {
      throw new Error('Failed to seed the session used by the constraint tests');
    }
  });

  it('accepts a valid exercise log and set log', async () => {
    await testDb.insert(exerciseLogs).values(exerciseLog({}));
    await testDb
      .insert(setLogs)
      .values(setLog({ exerciseOrder: 9, weightKg: null, rpe: null }));

    const stored = await testDb.select().from(setLogs).where(eq(setLogs.exerciseOrder, 9));
    expect(stored).toHaveLength(1);
  });

  it('rejects an exercise log pointing at an unknown catalog exercise', async () => {
    const message = await insertExerciseLog({ exerciseId: 'does-not-exist' });

    expect(message).toMatch(/exercise_logs_exercise_id_fk/);
  });

  it('rejects an exercise log pointing at an unknown session', async () => {
    const message = await insertExerciseLog({ sessionId: 'no-such-session' });

    expect(message).toMatch(/exercise_logs_session_id_workout_sessions_id_fk/);
  });

  it('rejects non-positive exercise order, set counts, and rest periods', async () => {
    expect(await insertExerciseLog({ exerciseOrder: 0 })).toMatch(
      /chk_exercise_logs_exercise_order/,
    );
    expect(await insertExerciseLog({ sets: 0 })).toMatch(/chk_exercise_logs_sets/);
    expect(await insertExerciseLog({ restSeconds: -1 })).toMatch(/chk_exercise_logs_rest_seconds/);
  });

  it('rejects an inverted rep range', async () => {
    const message = await insertExerciseLog({ minReps: 12, maxReps: 8 });

    expect(message).toMatch(/chk_exercise_logs_reps_range/);
  });

  it('rejects a prescription that does not match its discriminator', async () => {
    expect(await insertExerciseLog({ minReps: null })).toMatch(/chk_exercise_logs_prescription/);
    expect(await insertExerciseLog({ durationSeconds: 30 })).toMatch(
      /chk_exercise_logs_prescription/,
    );
  });

  it('rejects a set log without a parent exercise log in the same session', async () => {
    expect(await insertSetLog({ exerciseOrder: 99 })).toMatch(/set_logs_exercise_log_fk/);
    expect(await insertSetLog({ sessionId: 'no-such-session' })).toMatch(
      /set_logs_exercise_log_fk/,
    );
  });

  it('rejects non-positive set numbers, reps, durations, and negative weights', async () => {
    expect(await insertSetLog({ setNumber: 0 })).toMatch(/chk_set_logs_set_number/);
    expect(await insertSetLog({ reps: 0 })).toMatch(/chk_set_logs_reps/);
    expect(await insertSetLog({ type: 'duration', reps: null, durationSeconds: 0 })).toMatch(
      /chk_set_logs_duration/,
    );
    expect(await insertSetLog({ weightKg: '-0.5' })).toMatch(/chk_set_logs_weight/);
  });

  it('rejects an RPE outside the 1-10 scale', async () => {
    expect(await insertSetLog({ rpe: 11 })).toMatch(/chk_set_logs_rpe_range/);
    expect(await insertSetLog({ rpe: 0 })).toMatch(/chk_set_logs_rpe_range/);
  });

  it('rejects a set whose columns disagree with its type', async () => {
    expect(await insertSetLog({ reps: null })).toMatch(/chk_set_logs_type/);
    expect(await insertSetLog({ type: 'duration', reps: 12, durationSeconds: 30 })).toMatch(
      /chk_set_logs_type/,
    );
  });

  it('rejects a session that completes before it starts', async () => {
    const message = await failureMessage(() =>
      testDb.insert(workoutSessions).values({
        id: 'session-backwards',
        scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
        workoutId: 'wo-beginner-strength-b',
        startedAt: new Date('2026-08-27T11:00:00.000Z'),
        completedAt: new Date('2026-08-27T10:00:00.000Z'),
      }),
    );

    expect(message).toMatch(/chk_workout_sessions_completed_at/);
  });

  it('rejects a session pointing at a scheduled occurrence that does not exist', async () => {
    const message = await failureMessage(() =>
      testDb.insert(workoutSessions).values({
        id: 'session-orphan',
        scheduledWorkoutId: 'no-such-occurrence',
        workoutId: 'wo-beginner-strength-a',
        startedAt: new Date('2026-08-27T10:00:00.000Z'),
        completedAt: null,
      }),
    );

    expect(message).toMatch(/workout_sessions_scheduled_workout_id_scheduled_workouts_id_fk/);
  });
});
