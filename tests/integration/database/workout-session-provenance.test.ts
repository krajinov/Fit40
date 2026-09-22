/**
 * Integration tests for M11 Slice 1: persisted occurrence provenance
 * (`exercise_logs.source`) and the monotonic occurrence-key high-water mark
 * (`workout_sessions.next_occurrence_key`) through
 * DrizzleWorkoutSessionRepository.
 *
 * These lock the schema delta, the mapper round-trip on the existing
 * whole-aggregate save, and the legacy-hydration fallbacks the domain factory
 * owns: rows written before the columns existed hydrate as template-authored,
 * and a legacy NULL high-water mark falls back to max(occurrenceKey) + 1 and
 * self-heals to a persisted value on the next save.
 */

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import {
  createWorkoutSession,
  OccurrenceSource,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { moveSessionExercise } from '@/domain/services/session-exercise-reorder';
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
 * A two-occurrence session whose second occurrence is user-added, so both
 * provenance values and both occurrence keys are present in one aggregate.
 */
function makeSession(
  id = 'session-provenance-1',
  nextOccurrenceKey?: number,
): WorkoutSession {
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
        restSeconds: 0,
        source: OccurrenceSource.UserAdded,
      },
    ],
    nextOccurrenceKey,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Raw persisted exercise-log rows, ordered by the mutable business locator. */
async function loadLogRows(session: string) {
  return db
    .select()
    .from(exerciseLogs)
    .where(eq(exerciseLogs.sessionId, session))
    .orderBy(asc(exerciseLogs.exerciseOrder));
}

/** Raw persisted session row, for asserting the high-water mark column. */
async function loadSessionRow(session: string) {
  const rows = await db
    .select()
    .from(workoutSessions)
    .where(eq(workoutSessions.id, session))
    .limit(1);
  return rows[0];
}

describe('occurrence provenance persistence (M11 Slice 1)', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-test-a');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
  });

  it('persists and hydrates source for template and user_added occurrences', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const logRows = await loadLogRows(session.id);
    expect(logRows.map((row) => row.source)).toEqual(['template', 'user_added']);

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.exerciseLogs.map((log) => log.source)).toEqual([
      OccurrenceSource.Template,
      OccurrenceSource.UserAdded,
    ]);
  });

  it('hydrates a row written without an explicit source as template-authored', async () => {
    // A pre-M11 row: the parent session is inserted directly, and the
    // exercise_logs row omits `source` so the column DEFAULT applies — the
    // exact shape of data written before the column existed.
    const id = 'session-provenance-legacy';
    await db.insert(workoutSessions).values({
      id,
      userId: 'user-test-a',
      enrollmentId: 'enrollment-test-a',
      scheduledWorkoutId: 'fit40-beginner-strength-w1-1',
      workoutId: 'wo-beginner-strength-a',
      startedAt: new Date('2025-01-01T10:00:00Z'),
      completedAt: null,
      version: 0,
    });
    await db.insert(exerciseLogs).values({
      sessionId: id,
      exerciseOrder: 1,
      exerciseId: 'ex-002',
      prescriptionType: 'reps',
      sets: 3,
      minReps: 8,
      maxReps: 10,
      restSeconds: 90,
      isSkipped: false,
    });

    const rows = await loadLogRows(id);
    expect(rows.map((row) => row.source)).toEqual(['template']);

    const hydrated = await workoutSessionRepository.findById(sessionId(id));
    expect(hydrated?.exerciseLogs.map((log) => log.source)).toEqual([OccurrenceSource.Template]);
  });

  it('keeps provenance attached to the occurrence through a reorder save', async () => {
    const session = makeSession('session-provenance-reorder');
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findById(sessionId('session-provenance-reorder'));
    if (!loaded) throw new Error('session not found');
    const moved = moveSessionExercise(loaded, { exerciseOrder: 2, direction: 'up' });
    if (!moved.ok) throw new Error(moved.error.message);
    await workoutSessionRepository.save(moved.data);

    const rows = await loadLogRows('session-provenance-reorder');
    // ex-015 (the user-added occurrence) moved to order 1 and kept its source.
    expect(rows.map((row) => row.exerciseId)).toEqual(['ex-015', 'ex-002']);
    expect(rows.map((row) => row.source)).toEqual(['user_added', 'template']);
  });
});

describe('occurrence-key high-water mark persistence (M11 Slice 1)', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-test-a');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
  });

  it('persists the factory default mark (max occurrenceKey + 1)', async () => {
    const session = makeSession('session-mark-default');
    expect(session.nextOccurrenceKey).toBe(3);

    await workoutSessionRepository.save(session);

    expect((await loadSessionRow('session-mark-default'))?.nextOccurrenceKey).toBe(3);
    const reloaded = await workoutSessionRepository.findById(sessionId('session-mark-default'));
    expect(reloaded?.nextOccurrenceKey).toBe(3);
  });

  it('round-trips an explicit high-water mark above the existing keys', async () => {
    const session = makeSession('session-mark-explicit', 9);

    await workoutSessionRepository.save(session);

    expect((await loadSessionRow('session-mark-explicit'))?.nextOccurrenceKey).toBe(9);
    const reloaded = await workoutSessionRepository.findById(sessionId('session-mark-explicit'));
    expect(reloaded?.nextOccurrenceKey).toBe(9);
  });

  it('hydrates a legacy NULL mark through the max+1 fallback and self-heals on save', async () => {
    const session = makeSession('session-mark-legacy');
    await workoutSessionRepository.save(session);

    // Simulate a row written before the column existed.
    await db
      .update(workoutSessions)
      .set({ nextOccurrenceKey: null })
      .where(eq(workoutSessions.id, session.id));
    expect((await loadSessionRow(session.id))?.nextOccurrenceKey).toBeNull();

    const hydrated = await workoutSessionRepository.findById(session.id);
    // Keys 1 and 2 survive: the domain fallback is max + 1 = 3.
    expect(hydrated?.nextOccurrenceKey).toBe(3);

    if (!hydrated) throw new Error('session not found');
    await workoutSessionRepository.save(hydrated);
    expect((await loadSessionRow(session.id))?.nextOccurrenceKey).toBe(3);
  });

  it('advances the persisted mark on every whole-aggregate save', async () => {
    const session = makeSession('session-mark-advance');
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findById(sessionId('session-mark-advance'));
    if (!loaded) throw new Error('session not found');
    await workoutSessionRepository.save({ ...loaded, nextOccurrenceKey: 12 });

    expect((await loadSessionRow('session-mark-advance'))?.nextOccurrenceKey).toBe(12);
  });
});

afterAll(async () => {
  await closeDatabase();
});
