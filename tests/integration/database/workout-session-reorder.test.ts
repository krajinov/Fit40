/**
 * Integration tests for M10 Slice 5: adjacent occurrence reordering
 * persisted through DrizzleWorkoutSessionRepository. The exercise_logs PK
 * (session_id, exercise_order) and the set_logs composite FK to it mean a
 * move must re-parent every set_log row to the occurrence's new
 * exercise_order — these tests prove that re-parenting with no orphaned or
 * lost sets, across whole-aggregate saves (delete + reinsert of children)
 * and under the optimistic-concurrency guard.
 */

import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  SessionOccurrenceKeyConflictError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import {
  createWorkoutSession,
  logSessionSet,
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
import { pgConstraintName } from '@/infrastructure/database/pg-error';
import { exerciseLogs, setLogs, users } from '@/infrastructure/database/schema';

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

function reps() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/**
 * A three-occurrence session (ex-002 order 1, ex-015 order 2, ex-010 order 3)
 * with two logged sets on the middle occurrence — three distinguishable
 * exercises so every adjacent swap is observable in the persisted rows.
 */
function makeSession(
  id = 'session-reorder-1',
  identity?: { scheduledWorkoutId: string; workoutId: string },
): WorkoutSession {
  const result = createWorkoutSession({
    id,
    userId: userId('user-test-a'),
    enrollmentId: enrollmentId('enrollment-test-a'),
    scheduledWorkoutId: scheduledWorkoutId(identity?.scheduledWorkoutId ?? 'fit40-beginner-strength-w1-1'),
    workoutId: workoutId(identity?.workoutId ?? 'wo-beginner-strength-a'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
      { authoredExerciseId: exerciseId('ex-015'), order: 2, prescription: reps(), restSeconds: 60 },
      { authoredExerciseId: exerciseId('ex-010'), order: 3, prescription: reps(), restSeconds: 75 },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  const first = logSessionSet(result.data, {
    exerciseOrder: 2, type: 'reps', reps: 8, weightKg: 40, rpe: null,
  });
  if (!first.ok) throw new Error(first.error.message);
  const second = logSessionSet(first.data, {
    exerciseOrder: 2, type: 'reps', reps: 10, weightKg: 45, rpe: null,
  });
  if (!second.ok) throw new Error(second.error.message);
  return second.data;
}

/** Raw persisted log rows, for asserting column values without hydration. */
async function loadLogRows(sessionId: string) {
  return db
    .select()
    .from(exerciseLogs)
    .where(eq(exerciseLogs.sessionId, sessionId))
    .orderBy(asc(exerciseLogs.exerciseOrder));
}

/** Raw persisted set rows across every occurrence, ordered for assertions. */
async function loadSetRows(sessionId: string) {
  return db
    .select()
    .from(setLogs)
    .where(eq(setLogs.sessionId, sessionId))
    .orderBy(asc(setLogs.exerciseOrder), asc(setLogs.setNumber));
}

describe('DrizzleWorkoutSessionRepository reorder persistence (M10 Slice 5)', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-test-a');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
  });

  it('re-parents set_logs to the moved occurrence with no orphans or loss', async () => {
    // Three distinguishable occurrences; the middle one (ex-015, order 2)
    // carries two logged sets. Moving it DOWN must rewrite its exercise_log
    // to order 3 AND re-parent both set_log rows to (session, 3) — the
    // set_logs composite FK would reject any other arrangement.
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findById(session.id);
    if (!loaded) throw new Error('session not found');
    const moved = moveSessionExercise(loaded, { exerciseOrder: 2, direction: 'down' });
    if (!moved.ok) throw new Error(moved.error.message);
    // The domain result itself is canonical: array position agrees with
    // order (exerciseLogs[index].order === index + 1).
    expect(moved.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3]);
    expect(moved.data.exerciseLogs.map((log) => log.authoredExerciseId)).toEqual([
      'ex-002',
      'ex-010',
      'ex-015',
    ]);
    await workoutSessionRepository.save(moved.data);

    // exercise_logs swapped; orders stay dense 1..N.
    const logRows = await loadLogRows(session.id);
    expect(logRows.map((row) => row.exerciseOrder)).toEqual([1, 2, 3]);
    expect(logRows.map((row) => row.exerciseId)).toEqual(['ex-002', 'ex-010', 'ex-015']);

    // set_logs followed the occurrence: both rows now on exercise_order 3,
    // payload intact, count preserved — nothing orphaned, nothing lost.
    const setRows = await loadSetRows(session.id);
    expect(setRows).toHaveLength(2);
    expect(setRows.map((row) => row.exerciseOrder)).toEqual([3, 3]);
    expect(setRows.map((row) => row.reps)).toEqual([8, 10]);
    expect(setRows.map((row) => row.weightKg)).toEqual([40, 45]);

    // FK integrity: every set row references an existing exercise_log row.
    const logOrders = new Set(logRows.map((row) => row.exerciseOrder));
    for (const row of setRows) {
      expect(logOrders.has(row.exerciseOrder)).toBe(true);
    }

    // The hydrated aggregate agrees with the raw rows — and is canonical.
    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3]);
    expect(reloaded?.exerciseLogs.map((log) => log.performedExerciseId)).toEqual([
      'ex-002',
      'ex-010',
      'ex-015',
    ]);
    expect(reloaded?.exerciseLogs.find((log) => log.order === 3)?.sets).toHaveLength(2);
  });

  it('round-trips an up move and its reversing down move', async () => {
    const session = makeSession('session-reorder-up');
    await workoutSessionRepository.save(session);

    // Move the logged-set occurrence UP: ex-015 to order 1, ex-002 to 2, and
    // the two sets re-parent from order 2 to order 1.
    const loaded = await workoutSessionRepository.findById(sessionId('session-reorder-up'));
    if (!loaded) throw new Error('session not found');
    const up = moveSessionExercise(loaded, { exerciseOrder: 2, direction: 'up' });
    if (!up.ok) throw new Error(up.error.message);
    // Canonical result: ex-015 physically moves above ex-002.
    expect(up.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3]);
    expect(up.data.exerciseLogs.map((log) => log.authoredExerciseId)).toEqual([
      'ex-015',
      'ex-002',
      'ex-010',
    ]);
    await workoutSessionRepository.save(up.data);

    let logRows = await loadLogRows('session-reorder-up');
    expect(logRows.map((row) => row.exerciseId)).toEqual(['ex-015', 'ex-002', 'ex-010']);
    expect((await loadSetRows('session-reorder-up')).map((row) => row.exerciseOrder)).toEqual([
      1,
      1,
    ]);

    // Reverse it from the reloaded aggregate: ex-015 (order 1) moves back
    // down, restoring the original arrangement and set placement.
    const reloaded = await workoutSessionRepository.findById(sessionId('session-reorder-up'));
    if (!reloaded) throw new Error('session not found');
    const down = moveSessionExercise(reloaded, { exerciseOrder: 1, direction: 'down' });
    if (!down.ok) throw new Error(down.error.message);
    await workoutSessionRepository.save(down.data);

    logRows = await loadLogRows('session-reorder-up');
    expect(logRows.map((row) => row.exerciseId)).toEqual(['ex-002', 'ex-015', 'ex-010']);
    const setRows = await loadSetRows('session-reorder-up');
    expect(setRows.map((row) => row.exerciseOrder)).toEqual([2, 2]);
    expect(setRows.map((row) => row.reps)).toEqual([8, 10]);
  });

  it('rejects a stale-version move save instead of overwriting a concurrent reorder', async () => {
    const session = makeSession('session-reorder-stale');
    await workoutSessionRepository.save(session); // version 0

    // A concurrent tab moves the logged-set occurrence down and saves
    // (version 0 → 1), re-parenting its sets to order 3.
    const loaded = await workoutSessionRepository.findById(sessionId('session-reorder-stale'));
    if (!loaded) throw new Error('session not found');
    const concurrent = moveSessionExercise(loaded, { exerciseOrder: 2, direction: 'down' });
    if (!concurrent.ok) throw new Error(concurrent.error.message);
    // The concurrent mover's result is canonical too.
    expect(concurrent.data.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3]);
    await workoutSessionRepository.save(concurrent.data);

    // Saving the original stale snapshot must fail, not silently revert the
    // concurrent reorder.
    await expect(workoutSessionRepository.save(session)).rejects.toBeInstanceOf(
      SessionStaleVersionError,
    );

    // The concurrent swap — and its re-parented set rows — survived.
    const logRows = await loadLogRows('session-reorder-stale');
    expect(logRows.map((row) => row.exerciseId)).toEqual(['ex-002', 'ex-010', 'ex-015']);
    expect((await loadSetRows('session-reorder-stale')).map((row) => row.exerciseOrder)).toEqual([
      3,
      3,
    ]);
  });

  it('persists occurrence keys and reorders them with their occurrences (PR #13 Finding 1)', async () => {
    const session = makeSession('session-reorder-keys');
    await workoutSessionRepository.save(session);

    // The insert persisted a distinct token per occurrence, in creation order.
    let logRows = await loadLogRows('session-reorder-keys');
    expect(logRows.map((row) => row.occurrenceKey)).toEqual([1, 2, 3]);

    // Rehydrate and move ex-015 (order 2, occurrenceKey 2) up. The whole
    // occurrence — its token included — travels to order 1.
    const loaded = await workoutSessionRepository.findById(sessionId('session-reorder-keys'));
    if (!loaded) throw new Error('session not found');
    expect(loaded.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2, 3]);
    const up = moveSessionExercise(loaded, { exerciseOrder: 2, direction: 'up' });
    if (!up.ok) throw new Error(up.error.message);
    await workoutSessionRepository.save(up.data);

    // Persisted: the token follows its occurrence — exercise ex-015 now sits
    // at order 1 STILL carrying key 2, and every key stays session-unique.
    logRows = await loadLogRows('session-reorder-keys');
    expect(logRows.map((row) => row.exerciseId)).toEqual(['ex-015', 'ex-002', 'ex-010']);
    expect(logRows.map((row) => row.occurrenceKey)).toEqual([2, 1, 3]);
    expect(new Set(logRows.map((row) => row.occurrenceKey)).size).toBe(3);
  });

  it('hydrates legacy NULL occurrence_key rows via the order fallback and self-heals on the next save (PR #13 Finding 1)', async () => {
    const session = makeSession('session-legacy-keys');
    await workoutSessionRepository.save(session);

    // Simulate pre-fix legacy rows: NULL tokens, exercised orders intact.
    await db.update(exerciseLogs).set({ occurrenceKey: null }).where(
      eq(exerciseLogs.sessionId, 'session-legacy-keys'),
    );
    let logRows = await loadLogRows('session-legacy-keys');
    expect(logRows.map((row) => row.occurrenceKey)).toEqual([null, null, null]);

    // Hydration coalesces NULL to exercise_order (distinct within the session
    // by the composite PK), so a legacy render keys each occurrence by its
    // order exactly as the pre-fix behavior did.
    const hydrated = await workoutSessionRepository.findById(sessionId('session-legacy-keys'));
    if (!hydrated) throw new Error('session not found');
    expect(hydrated.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2, 3]);

    // The next whole-aggregate save persists the coalesced tokens — the row
    // self-heals with values that match the fallback the render used, so the
    // render key never changes across the transition.
    const moved = moveSessionExercise(hydrated, { exerciseOrder: 2, direction: 'up' });
    if (!moved.ok) throw new Error(moved.error.message);
    await workoutSessionRepository.save(moved.data);

    logRows = await loadLogRows('session-legacy-keys');
    // ex-015 (hydrated key 2) now sits at order 1 still carrying key 2.
    expect(logRows.map((row) => row.exerciseId)).toEqual(['ex-015', 'ex-002', 'ex-010']);
    expect(logRows.map((row) => row.occurrenceKey)).toEqual([2, 1, 3]);
    expect(new Set(logRows.map((row) => row.occurrenceKey)).size).toBe(3);
  });
});

describe('exercise_logs occurrence_key uniqueness (PR #13 Finding 2)', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-test-a');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
  });

  it('maps a duplicate-occurrence-key save to the typed conflict error, never session-exists', async () => {
    const session = makeSession('session-key-dupes');
    await workoutSessionRepository.save(session);

    // A snapshot whose tokens collide (order 1 stamped with order 2's key)
    // is one the domain factory would never build — the repository trusts
    // the domain, so only a hand-built object can reach the database with
    // this corruption. PostgreSQL must reject it on
    // `exercise_logs_session_occurrence_key_unique`, and the repository must
    // classify it as the occurrence-key conflict — NOT the catch-all
    // `SessionAlreadyExistsError` (which is reserved for the
    // workout_sessions one-session-per-occurrence constraint).
    const loaded = await workoutSessionRepository.findById(session.id);
    if (!loaded) throw new Error('session not found');
    const conflicted: WorkoutSession = {
      ...loaded,
      exerciseLogs: loaded.exerciseLogs.map((log) =>
        log.order === 1 ? { ...log, occurrenceKey: 2 } : log,
      ),
    };
    await expect(workoutSessionRepository.save(conflicted)).rejects.toThrow(
      SessionOccurrenceKeyConflictError,
    );

    // The failed save persisted nothing; a legitimate snapshot of the same
    // session still saves cleanly afterwards.
    const healedRows = await loadLogRows('session-key-dupes');
    expect(healedRows.map((row) => row.occurrenceKey)).toEqual([1, 2, 3]);
  });

  it('rejects the duplicate at the database level, not only through hydration', async () => {
    const session = makeSession('session-key-db-reject');
    await workoutSessionRepository.save(session);

    // Prove the PARTIAL index itself fires: two non-null equal keys in one
    // session violate `exercise_logs_session_occurrence_key_unique`. The
    // statement is wrapped so the rejection is observed exactly once.
    let rejected = false;
    try {
      await db
        .update(exerciseLogs)
        .set({ occurrenceKey: 3 })
        .where(eq(exerciseLogs.sessionId, 'session-key-db-reject'));
    } catch (error) {
      rejected = true;
      expect(pgConstraintName(error)).toBe('exercise_logs_session_occurrence_key_unique');
    }
    expect(rejected).toBe(true);
  });

  it('allows the same occurrence key across DIFFERENT sessions', async () => {
    const first = makeSession('session-keys-first');
    // A different scheduled workout of the same enrollment: the
    // one-session-per-(enrollment, occurrence) constraint stays satisfied
    // while the occurrence keys deliberately repeat across the sessions.
    const second = makeSession('session-keys-second', {
      scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
      workoutId: 'wo-beginner-strength-b',
    });
    await workoutSessionRepository.save(first);
    await workoutSessionRepository.save(second);

    // Both sessions legitimately carry the tokens 1, 2, 3 — uniqueness is
    // scoped to the session, not global.
    const firstRows = await loadLogRows('session-keys-first');
    const secondRows = await loadLogRows('session-keys-second');
    expect(firstRows.map((row) => row.occurrenceKey)).toEqual([1, 2, 3]);
    expect(secondRows.map((row) => row.occurrenceKey)).toEqual([1, 2, 3]);
  });

  it('keeps allowing multiple NULL legacy occurrence_key rows in one session', async () => {
    const session = makeSession('session-keys-null-legacy');
    await workoutSessionRepository.save(session);
    await db
      .update(exerciseLogs)
      .set({ occurrenceKey: null })
      .where(eq(exerciseLogs.sessionId, 'session-keys-null-legacy'));

    // Three NULL tokens in ONE session: the partial index does not index
    // them, so any number of legacy rows remains representable.
    const rows = await loadLogRows('session-keys-null-legacy');
    expect(rows.map((row) => row.occurrenceKey)).toEqual([null, null, null]);
  });

  it('preserves the normal reorder/save round-trip and the legacy NULL self-heal', async () => {
    // The whole-aggregate rewrite deletes and reinserts ALL child rows of a
    // session inside one transaction — if the new index made that rewrite
    // self-conflicting (e.g. rows reinserted in an order that collides with
    // not-yet-deleted siblings), this exact M10 flow would break.
    const session = makeSession('session-keys-reorder');
    await workoutSessionRepository.save(session);
    await db
      .update(exerciseLogs)
      .set({ occurrenceKey: null })
      .where(eq(exerciseLogs.sessionId, 'session-keys-reorder'));

    const hydrated = await workoutSessionRepository.findById(session.id);
    if (!hydrated) throw new Error('session not found');
    // Legacy NULLs hydrate via the order fallback and self-heal on the next
    // save, WHILE a move reorders the aggregate in the same write.
    expect(hydrated.exerciseLogs.map((log) => log.occurrenceKey)).toEqual([1, 2, 3]);
    const moved = moveSessionExercise(hydrated, { exerciseOrder: 2, direction: 'up' });
    if (!moved.ok) throw new Error(moved.error.message);
    await workoutSessionRepository.save(moved.data);

    const rows = await loadLogRows('session-keys-reorder');
    expect(rows.map((row) => row.exerciseId)).toEqual(['ex-015', 'ex-002', 'ex-010']);
    expect(rows.map((row) => row.occurrenceKey)).toEqual([2, 1, 3]);
    expect(new Set(rows.map((row) => row.occurrenceKey)).size).toBe(3);
  });
});

afterAll(async () => {
  await closeDatabase();
});