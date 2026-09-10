import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { WorkoutSession } from '@/domain/entities/workout-session';
import { createWorkoutSession } from '@/domain/entities/workout-session';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import {
  skipSessionExercise,
  unskipSessionExercise,
} from '@/domain/services/session-exercise-adjustment';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { exerciseLogs, users, workoutSessions } from '@/infrastructure/database/schema';

import {
  closeDatabase,
  db,
  programEnrollmentRepository,
  resetAndSeed,
  workoutSessionRepository,
} from './setup';

function exerciseId(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledWorkoutId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function workoutId(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function sessionId(value: string) {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function userId(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enrollmentId(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Creates a real user row so session ownership FKs are satisfiable. */
async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@example.test`, passwordHash: 'x' });
}

/** Creates a real enrollment row so session enrollment FKs are satisfiable. */
async function seedEnrollment(id: string, ownerId: string, programId: string): Promise<void> {
  const result = createProgramEnrollment({
    id,
    userId: ownerId,
    programId,
    enrolledAt: new Date('2026-01-01T00:00:00Z'),
  });
  if (!result.ok) throw new Error(result.error.message);
  await programEnrollmentRepository.create(result.data);
}

/**
 * A two-occurrence session (ex-002 order 1, ex-015 order 2) with an explicit
 * skip decision on order 2 — a valid aggregate because a skipped occurrence
 * carries zero sets.
 */
function makeSession(id = 'session-skip-1'): WorkoutSession {
  const result = createWorkoutSession({
    id,
    userId: userId('user-test-a'),
    enrollmentId: enrollmentId('enrollment-test-a'),
    scheduledWorkoutId: scheduledWorkoutId('fit40-beginner-strength-w1-1'),
    workoutId: workoutId('wo-beginner-strength-a'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
      {
        authoredExerciseId: exerciseId('ex-015'),
        order: 2,
        prescription: reps(),
        restSeconds: 60,
        isSkipped: true,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Raw persisted log rows, for asserting column values without hydration. */
async function loadLogRows(sessionId: string) {
  return db
    .select()
    .from(exerciseLogs)
    .where(eq(exerciseLogs.sessionId, sessionId))
    .orderBy(asc(exerciseLogs.exerciseOrder));
}

function reps() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('DrizzleWorkoutSessionRepository skip persistence (M10 Slice 2)', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-test-a');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
  });

  it('round-trips isSkipped while leaving the occurrence contract untouched', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findById(sessionId(session.id));
    if (!loaded) throw new Error('session not found');

    // The persisted decision survives the save → reload round-trip.
    expect(loaded.exerciseLogs.map((log) => log.isSkipped)).toEqual([false, true]);

    // A skipped occurrence keeps its full authored contract: identities,
    // prescription snapshot, rest, order, and (by invariant) zero sets.
    const skipped = loaded.exerciseLogs[1];
    if (!skipped) throw new Error('skipped occurrence missing');
    expect(skipped.authoredExerciseId).toBe(exerciseId('ex-015'));
    expect(skipped.performedExerciseId).toBe(exerciseId('ex-015'));
    expect(skipped.order).toBe(2);
    expect(skipped.prescription).toEqual(reps());
    expect(skipped.restSeconds).toBe(60);
    expect(skipped.sets).toEqual([]);

    // The normal occurrence stays untouched too.
    const normal = loaded.exerciseLogs[0];
    if (!normal) throw new Error('normal occurrence missing');
    expect(normal.isSkipped).toBe(false);
    expect(normal.authoredExerciseId).toBe(exerciseId('ex-002'));
    expect(normal.performedExerciseId).toBe(exerciseId('ex-002'));

    // The column itself holds the decision.
    const rows = await loadLogRows(session.id);
    expect(rows.map((row) => row.isSkipped)).toEqual([false, true]);
  });

  it('hydrates a row relying on the column default as not skipped', async () => {
    // A pre-M10-shaped row: the exercise_log is written by direct SQL
    // without is_skipped, so only the DB DEFAULT false can supply it. The
    // direct write stays invariant-consistent (zero sets, not skipped).
    // There is deliberately no DB CHECK tying is_skipped to set_logs.
    await db.insert(workoutSessions).values({
      id: 'session-skip-legacy',
      userId: 'user-test-a',
      enrollmentId: 'enrollment-test-a',
      scheduledWorkoutId: 'fit40-beginner-strength-w1-1',
      workoutId: 'wo-beginner-strength-a',
      startedAt: new Date('2025-01-01T10:00:00Z'),
    });
    await db.insert(exerciseLogs).values({
      sessionId: 'session-skip-legacy',
      exerciseOrder: 1,
      exerciseId: 'ex-002',
      authoredExerciseId: 'ex-002',
      prescriptionType: 'reps',
      sets: 3,
      minReps: 8,
      maxReps: 10,
      restSeconds: 90,
    });

    const loaded = await workoutSessionRepository.findById(sessionId('session-skip-legacy'));
    if (!loaded) throw new Error('session not found');
    expect(loaded.exerciseLogs[0]?.isSkipped).toBe(false);

    const rows = await loadLogRows('session-skip-legacy');
    expect(rows[0]?.isSkipped).toBe(false);
  });


  it('follows the aggregate through false → true → false whole-aggregate saves', async () => {
    // Skip is reversible while in progress; every save rewrites the whole
    // aggregate (delete + reinsert of children). The persisted flag must
    // track each domain transition and never silently fall back to the
    // column default.
    const base = makeSession('session-skip-flip');

    // Start from a fully unskipped aggregate (false).
    const unskipped = unskipSessionExercise(base, { exerciseOrder: 2 });
    if (!unskipped.ok) throw new Error(unskipped.error.message);
    await workoutSessionRepository.save(unskipped.data);
    expect((await loadLogRows('session-skip-flip')).map((row) => row.isSkipped)).toEqual([
      false,
      false,
    ]);

    // false → true through the domain mutation.
    const reloaded = await workoutSessionRepository.findById(unskipped.data.id);
    if (!reloaded) throw new Error('session not found');
    const skipped = skipSessionExercise(reloaded, { exerciseOrder: 2 });
    if (!skipped.ok) throw new Error(skipped.error.message);
    await workoutSessionRepository.save(skipped.data);
    expect((await loadLogRows('session-skip-flip')).map((row) => row.isSkipped)).toEqual([
      false,
      true,
    ]);

    // true → false through the domain mutation.
    const reloadedAgain = await workoutSessionRepository.findById(skipped.data.id);
    if (!reloadedAgain) throw new Error('session not found');
    const unskippedAgain = unskipSessionExercise(reloadedAgain, { exerciseOrder: 2 });
    if (!unskippedAgain.ok) throw new Error(unskippedAgain.error.message);
    await workoutSessionRepository.save(unskippedAgain.data);
    expect((await loadLogRows('session-skip-flip')).map((row) => row.isSkipped)).toEqual([
      false,
      false,
    ]);

    // And the hydrated aggregate agrees with the column.
    const final = await workoutSessionRepository.findById(unskippedAgain.data.id);
    expect(final?.exerciseLogs.map((log) => log.isSkipped)).toEqual([false, false]);
  });
});

afterAll(async () => {
  await closeDatabase();
});

