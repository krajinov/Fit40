/**
 * Integration tests for M11 Slice 4: removing a user-added occurrence through
 * `DrizzleWorkoutSessionRepository`'s existing whole-aggregate save. These
 * prove the persisted consequences the domain promises: the row is gone, the
 * trailing orders are dense, surviving occurrence keys are untouched, the
 * high-water mark only ever advances (so a removed key is never reused), and
 * the persisted aggregate stays valid under the occurrenceKey unique index.
 */

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import {
  addSessionExercise,
  removeSessionExercise,
} from '@/domain/services/session-exercise-composition';
import {
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
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

function reps() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@example.test`, passwordHash: 'x' });
}

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
 * A three-occurrence aggregate: ex-002 authored by the template at order 1,
 * then TWO user-added occurrences (ex-015 at order 2, ex-010 at order 3) — so
 * a middle removal must renumber a trailing order while keys stay put.
 */
function makeThreeOccurrenceSession(id = 'session-removal-1'): WorkoutSession {
  const created = createWorkoutSession({
    id,
    userId: userId('user-test-a'),
    enrollmentId: enrollmentId('enrollment-test-a'),
    scheduledWorkoutId: scheduledWorkoutId('fit40-beginner-strength-w1-1'),
    workoutId: workoutId('wo-beginner-strength-a'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
    ],
  });
  if (!created.ok) throw new Error(created.error.message);

  const first = addSessionExercise(created.data, {
    exerciseId: exerciseId('ex-015'),
    prescription: reps(),
    restSeconds: 0,
  });
  if (!first.ok) throw new Error(first.error.message);

  const second = addSessionExercise(first.data, {
    exerciseId: exerciseId('ex-010'),
    prescription: reps(),
    restSeconds: 0,
  });
  if (!second.ok) throw new Error(second.error.message);
  return second.data;
}

/** Raw persisted log rows, ordered by the mutable business locator. */
async function loadLogRows(session: string) {
  return db
    .select()
    .from(exerciseLogs)
    .where(eq(exerciseLogs.sessionId, session))
    .orderBy(asc(exerciseLogs.exerciseOrder));
}

/** Raw persisted session row, for the high-water mark column. */
async function loadSessionRow(session: string) {
  const rows = await db
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.id, session))
    .limit(1);
  return rows[0];
}

describe('user-added occurrence removal persistence (M11 Slice 4)', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-test-a');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('deletes the row, renumbers the trailing order densely and keeps surviving keys', async () => {
    const session = makeThreeOccurrenceSession();
    // Keys 1 (template), 2 (ex-015), 3 (ex-010); mark 4.
    expect(session.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2, 3]);
    await workoutSessionRepository.save(session);

    const removed = removeSessionExercise(session, { exerciseOrder: 2 });
    if (!removed.ok) throw new Error(removed.error.message);
    await workoutSessionRepository.save(removed.data);

    const rows = await loadLogRows(session.id);
    expect(rows.map((row) => row.exerciseOrder)).toEqual([1, 2]);
    expect(rows.map((row) => row.exerciseId)).toEqual(['ex-002', 'ex-010']);
    // Surviving occurrence keys travel with their occurrences unchanged.
    expect(rows.map((row) => row.occurrenceKey)).toEqual([1, 3]);
    // Provenance survives the round-trip.
    expect(rows.map((row) => row.source)).toEqual(['template', 'user_added']);

    // The high-water mark is untouched (4 is still above every allocated key).
    expect((await loadSessionRow(session.id))?.nextOccurrenceKey).toBe(4);

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    expect(reloaded?.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 3]);
    expect(reloaded?.nextOccurrenceKey).toBe(4);
  });

  it('never reuses a removed occurrence key: the next Add takes the high-water key', async () => {
    const session = makeThreeOccurrenceSession('session-removal-key');
    await workoutSessionRepository.save(session);

    const removed = removeSessionExercise(session, { exerciseOrder: 3 });
    if (!removed.ok) throw new Error(removed.error.message);
    await workoutSessionRepository.save(removed.data);
    // Key 3 is gone from the aggregate...
    expect((await loadLogRows(session.id)).map((row) => row.occurrenceKey)).toEqual([1, 2]);

    const reloaded = await workoutSessionRepository.findById(sessionId('session-removal-key'));
    if (!reloaded) throw new Error('session not found');
    const reAdded = addSessionExercise(reloaded, {
      exerciseId: exerciseId('ex-015'),
      prescription: reps(),
      restSeconds: 0,
    });
    if (!reAdded.ok) throw new Error(reAdded.error.message);
    expect(reAdded.data.exerciseLogs.at(-1)?.occurrenceKey).toBe(4);
    await workoutSessionRepository.save(reAdded.data);

    const rows = await loadLogRows('session-removal-key');
    expect(rows.map((row) => row.occurrenceKey)).toEqual([1, 2, 4]);
    expect(rows.map((row) => row.exerciseOrder)).toEqual([1, 2, 3]);
    // The re-added exercise Y is a fresh user-added occurrence: it did NOT
    // inherit the removed key, and it kept the user-added provenance.
    expect(rows[2]?.exerciseId).toBe('ex-015');
    expect(rows.map((row) => row.source)).toEqual(['template', 'user_added', 'user_added']);
    expect((await loadSessionRow('session-removal-key'))?.nextOccurrenceKey).toBe(5);
  });

  it('enforces logged-set protection BEFORE persistence, leaving stored rows untouched', async () => {
    const session = makeThreeOccurrenceSession('session-removal-logged');
    await workoutSessionRepository.save(session);

    // A set is logged on the ex-015 occurrence (order 2).
    const logged = logSessionSet(session, {
      exerciseOrder: 2,
      type: 'reps',
      reps: 8,
      weightKg: 40,
      rpe: null,
    });
    if (!logged.ok) throw new Error(logged.error.message);
    await workoutSessionRepository.save(logged.data);

    const blocked = removeSessionExercise(logged.data, { exerciseOrder: 2 });
    expect(blocked.ok).toBe(false);
    if (blocked.ok) return;
    expect(blocked.error.code).toBe('EXERCISE_HAS_LOGGED_SETS');

    // Nothing was discarded: the occurrence and its set are still persisted.
    const rows = await loadLogRows('session-removal-logged');
    expect(rows.map((row) => row.exerciseOrder)).toEqual([1, 2, 3]);
    expect((await loadSessionRow('session-removal-logged'))?.nextOccurrenceKey).toBe(4);
  });

  it('keeps the persisted aggregate valid under the occurrenceKey unique index after a removal', async () => {
    const session = makeThreeOccurrenceSession('session-removal-valid');
    await workoutSessionRepository.save(session);

    const removed = removeSessionExercise(session, { exerciseOrder: 2 });
    if (!removed.ok) throw new Error(removed.error.message);
    await workoutSessionRepository.save(removed.data);

    const rows = await loadLogRows('session-removal-valid');
    const keys = rows.map((row) => row.occurrenceKey);
    expect(new Set(keys).size).toBe(keys.length);

    // A further whole-aggregate save of the hydrated (post-removal) aggregate
    // must not trip the partial unique index, and the state must be stable.
    const reloaded = await workoutSessionRepository.findById(sessionId('session-removal-valid'));
    if (!reloaded) throw new Error('session not found');
    await workoutSessionRepository.save(reloaded);

    const after = await loadLogRows('session-removal-valid');
    expect(after.map((row) => row.exerciseOrder)).toEqual([1, 2]);
    expect(after.map((row) => row.occurrenceKey)).toEqual([1, 3]);
    expect(after.map((row) => row.source)).toEqual(['template', 'user_added']);
  });
});
