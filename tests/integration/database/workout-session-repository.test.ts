import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  deleteSessionSet,
  logSessionSet,
  OccurrenceSource,
  updateSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { substituteSessionExercise } from '@/domain/services/session-exercise-substitution';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';

import {
  SessionAlreadyExistsError,
  SessionEnrollmentChangedError,
  SessionEnrollmentNotFoundError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import { users, workoutSessions } from '@/infrastructure/database/schema';
import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import * as schema from '@/infrastructure/database/schema';

import {
  closeDatabase,
  db,
  programEnrollmentRepository,
  resetAndSeed,
  workoutSessionRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';

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

function duration() {
  const result = createDurationScheme(3, 30);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Creates a real user row so session ownership FKs are satisfiable. */
async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@example.test`, passwordHash: 'x' });
}

/** Creates a real enrollment row so session enrollment FKs are satisfiable. */
async function seedEnrollment(id: string, userId: string, programId: string): Promise<void> {
  const result = createProgramEnrollment({
    id,
    userId,
    programId,
    enrolledAt: new Date('2026-01-01T00:00:00Z'),
  });
  if (!result.ok) throw new Error(result.error.message);
  await programEnrollmentRepository.create(result.data);
}

function makeSession(
  id = 'session-test-1',
  overrides: {
    userId?: string;
    enrollmentId?: string | null;
    scheduledWorkoutId?: string;
    workoutId?: string;
    startedAt?: string;
  } = {},
): WorkoutSession {
  const result = createWorkoutSession({
    id,
    userId: userId(overrides.userId ?? 'user-test-a'),
    enrollmentId:
      overrides.enrollmentId === undefined
        ? enrollmentId('enrollment-test-a')
        : overrides.enrollmentId === null
          ? null
          : enrollmentId(overrides.enrollmentId),
    scheduledWorkoutId: scheduledWorkoutId(
      overrides.scheduledWorkoutId ?? 'fit40-beginner-strength-w1-1',
    ),
    workoutId: workoutId(overrides.workoutId ?? 'wo-beginner-strength-a'),
    startedAt: new Date(overrides.startedAt ?? '2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
      { authoredExerciseId: exerciseId('ex-015'), order: 2, prescription: duration(), restSeconds: 60 },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function withOneRepSet(session: WorkoutSession): WorkoutSession {
  const result = logSessionSet(session, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 10,
    weightKg: 20,
    rpe: 7,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function withTwoRepSets(session: WorkoutSession): WorkoutSession {
  const first = logSessionSet(session, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 10,
    weightKg: 20,
    rpe: 7,
  });
  if (!first.ok) throw new Error(first.error.message);
  const second = logSessionSet(first.data, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 12,
    weightKg: 22.5,
    rpe: 8,
  });
  if (!second.ok) throw new Error(second.error.message);
  return second.data;
}

function completed(session: WorkoutSession): WorkoutSession {
  const done = completeWorkoutSession(withOneRepSet(session), new Date('2025-01-01T11:00:00Z'));
  if (!done.ok) throw new Error(done.error.message);
  return done.data;
}

describe('DrizzleWorkoutSessionRepository', () => {
  beforeEach(async () => {
    await resetAndSeed();

    // Sessions carry ownership FKs (user_id, enrollment_id), so every test
    // needs real user and enrollment rows to satisfy them.
    await seedUser('user-test-a');
    await seedUser('user-test-b');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
    await seedEnrollment('enrollment-test-b', 'user-test-b', 'prog-beginner-strength');
  });

  it('save() inserts a new aggregate and findById() retrieves it', async () => {
    const session = makeSession();

    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.id).toBe(session.id);
    expect(loaded?.scheduledWorkoutId).toBe(session.scheduledWorkoutId);
    expect(loaded?.workoutId).toBe(session.workoutId);
    expect(loaded?.completedAt).toBeNull();
    expect(loaded?.exerciseLogs).toHaveLength(2);
    expect(loaded?.exerciseLogs[0]?.restSeconds).toBe(90);
    expect(loaded?.exerciseLogs[0]?.prescription.type).toBe('reps');
    expect(loaded?.exerciseLogs[1]?.prescription.type).toBe('duration');
  });

  it('save() updates an existing aggregate (adds a set)', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded).not.toBeNull();
    await workoutSessionRepository.save(withOneRepSet(loaded!));

    const updated = await workoutSessionRepository.findById(session.id);
    expect(updated?.exerciseLogs[0]?.sets).toHaveLength(1);
    expect(updated?.exerciseLogs[0]?.sets[0]).toMatchObject({
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: 7,
    });
  });

  it('save() handles an edited set', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const withSet = withOneRepSet(session);
    await workoutSessionRepository.save(withSet);

    // Re-read the persisted aggregate before mutating, as the use cases do.
    const current = await workoutSessionRepository.findById(session.id);
    expect(current).not.toBeNull();

    const edited = updateSessionSet(current!, {
      exerciseOrder: 1,
      setNumber: 1,
      type: 'reps',
      reps: 14,
      weightKg: 25,
      rpe: 9,
    });
    expect(edited.ok).toBe(true);
    if (!edited.ok) return;
    await workoutSessionRepository.save(edited.data);

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.exerciseLogs[0]?.sets[0]).toMatchObject({
      type: 'reps',
      reps: 14,
      weightKg: 25,
      rpe: 9,
    });
  });

  it('save() handles a deleted set and renumbers remaining sets', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    await workoutSessionRepository.save(withTwoRepSets(session));

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded?.exerciseLogs[0]?.sets).toHaveLength(2);

    const deleted = deleteSessionSet(loaded!, { exerciseOrder: 1, setNumber: 1 });
    expect(deleted.ok).toBe(true);
    if (!deleted.ok) return;
    await workoutSessionRepository.save(deleted.data);

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.exerciseLogs[0]?.sets).toHaveLength(1);
    expect(reloaded?.exerciseLogs[0]?.sets[0]?.setNumber).toBe(1);
    expect(reloaded?.exerciseLogs[0]?.sets[0]).toMatchObject({ reps: 12, weightKg: 22.5 });
  });

  it('save() persists the completion timestamp', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const completed = completeWorkoutSession(withOneRepSet(session), new Date('2025-01-01T11:00:00Z'));
    expect(completed.ok).toBe(true);
    if (!completed.ok) return;
    await workoutSessionRepository.save(completed.data);

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded?.completedAt).toEqual(new Date('2025-01-01T11:00:00Z'));
  });

  it('findByEnrollmentAndScheduledWorkout() returns the session', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findByEnrollmentAndScheduledWorkout(
      session.enrollmentId!,
      session.scheduledWorkoutId,
    );
    expect(loaded?.id).toBe(session.id);
  });

  it('findByEnrollmentAndScheduledWorkout() never returns another enrollment\'s session', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findByEnrollmentAndScheduledWorkout(
      enrollmentId('enrollment-test-b'),
      session.scheduledWorkoutId,
    );
    expect(loaded).toBeNull();
  });

  it('listCompletedScheduledWorkoutIds() returns only that enrollment\'s completed ids', async () => {
    const own = completed(makeSession('session-own'));
    const otherUser = completed(makeSession('session-other', { userId: 'user-test-b', enrollmentId: 'enrollment-test-b' }));
    const inProgress = makeSession('session-progress', {
      scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
      workoutId: 'wo-beginner-strength-b',
    });
    await workoutSessionRepository.save(own);
    await workoutSessionRepository.save(otherUser);
    await workoutSessionRepository.save(inProgress);

    const listed = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );

    expect(listed).toEqual([own.scheduledWorkoutId]);
  });

  it('listCompletedScheduledWorkoutIds() orders ids by start time ascending', async () => {
    // Saved out of order on purpose: the SQL projection must ORDER BY started_at.
    const late = completed(makeSession('session-late', {
      scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
      workoutId: 'wo-beginner-strength-b',
      startedAt: '2025-01-02T10:00:00Z',
    }));
    const early = completed(makeSession('session-early', { startedAt: '2025-01-01T09:00:00Z' }));
    await workoutSessionRepository.save(late);
    await workoutSessionRepository.save(early);

    const listed = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );

    expect(listed).toEqual([early.scheduledWorkoutId, late.scheduledWorkoutId]);
  });

  it('listCompletedScheduledWorkoutIds() excludes detached sessions after rejoin', async () => {
    const detached = completed(makeSession('session-detached', { enrollmentId: null }));
    await workoutSessionRepository.save(detached);

    const listed = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );

    expect(listed).toEqual([]);
  });

  it('listInProgressScheduledWorkoutIds() returns only that enrollment\'s in-progress ids', async () => {
    const inProgress = makeSession('session-in-progress');
    const otherEnrollment = makeSession('session-other-enrollment', {
      userId: 'user-test-b',
      enrollmentId: 'enrollment-test-b',
      scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
      workoutId: 'wo-beginner-strength-b',
    });
    const completedOwn = completed(
      makeSession('session-completed-own', {
        scheduledWorkoutId: 'fit40-beginner-strength-w1-3',
        workoutId: 'wo-beginner-strength-c',
      }),
    );
    await workoutSessionRepository.save(inProgress);
    await workoutSessionRepository.save(otherEnrollment);
    await workoutSessionRepository.save(completedOwn);

    const listed = await workoutSessionRepository.listInProgressScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );

    // Authored occurrence id of the live session only: neither the completed
    // session for this run nor the other enrollment's session appears.
    expect(listed).toEqual([inProgress.scheduledWorkoutId]);
  });

  it('listInProgressScheduledWorkoutIds() excludes detached sessions', async () => {
    await workoutSessionRepository.save(
      makeSession('session-detached-in-progress', { enrollmentId: null }),
    );

    const listed = await workoutSessionRepository.listInProgressScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );

    expect(listed).toEqual([]);
  });

  it('listInProgressScheduledWorkoutIds() orders ids by start time ascending', async () => {
    // Saved out of order on purpose: the projection must ORDER BY started_at.
    const late = makeSession('session-late-in-progress', {
      scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
      workoutId: 'wo-beginner-strength-b',
      startedAt: '2025-01-02T10:00:00Z',
    });
    const early = makeSession('session-early-in-progress', {
      startedAt: '2025-01-01T09:00:00Z',
    });
    await workoutSessionRepository.save(late);
    await workoutSessionRepository.save(early);

    const listed = await workoutSessionRepository.listInProgressScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );

    expect(listed).toEqual([early.scheduledWorkoutId, late.scheduledWorkoutId]);
  });

  it('listInProgressScheduledWorkoutIds() breaks startedAt ties by session id', async () => {
    // Same instant on purpose: the ordering must fall back to the session id
    // so the projection is deterministic even when start times tie.
    const second = makeSession('session-tie-b', {
      scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
      workoutId: 'wo-beginner-strength-b',
      startedAt: '2025-01-01T09:00:00Z',
    });
    const first = makeSession('session-tie-a', {
      scheduledWorkoutId: 'fit40-beginner-strength-w1-3',
      workoutId: 'wo-beginner-strength-c',
      startedAt: '2025-01-01T09:00:00Z',
    });
    await workoutSessionRepository.save(second);
    await workoutSessionRepository.save(first);

    const listed = await workoutSessionRepository.listInProgressScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );

    expect(listed).toEqual([first.scheduledWorkoutId, second.scheduledWorkoutId]);
  });

  it('listInProgressScheduledWorkoutIds() returns [] when nothing is in progress', async () => {
    await workoutSessionRepository.save(
      completed(
        makeSession('session-only-completed', {
          scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
          workoutId: 'wo-beginner-strength-b',
        }),
      ),
    );

    const listed = await workoutSessionRepository.listInProgressScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );

    expect(listed).toEqual([]);
  });

  it('listInProgressScheduledWorkoutIds() issues exactly one statement (no N+1)', async () => {
    await workoutSessionRepository.save(
      makeSession('session-batch-ip-1', { startedAt: '2025-01-01T08:00:00Z' }),
    );
    await workoutSessionRepository.save(
      makeSession('session-batch-ip-2', {
        scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
        workoutId: 'wo-beginner-strength-b',
        startedAt: '2025-01-01T08:30:00Z',
      }),
    );
    await workoutSessionRepository.save(
      makeSession('session-batch-ip-3', {
        scheduledWorkoutId: 'fit40-beginner-strength-w1-3',
        workoutId: 'wo-beginner-strength-c',
        startedAt: '2025-01-01T09:00:00Z',
      }),
    );

    // A dedicated counting client: postgres.js' debug hook fires once per
    // executed statement, so the read's statement count is observable.
    let statements = 0;
    const countingClient = postgres(getTestDatabaseUrl(), {
      max: 1,
      debug: () => {
        statements += 1;
      },
    });
    try {
      const countingDb = drizzle(countingClient, { schema });
      const countingRepo = new DrizzleWorkoutSessionRepository(countingDb);

      // Warm the connection first: a fresh postgres.js client runs a one-time
      // pg_catalog type-introspection statement on its very first query —
      // connection initialization, not part of the read. Measuring the second
      // invocation isolates the read's own statement count.
      await countingRepo.listInProgressScheduledWorkoutIds(enrollmentId('enrollment-test-a'));
      statements = 0;

      const listed = await countingRepo.listInProgressScheduledWorkoutIds(
        enrollmentId('enrollment-test-a'),
      );

      expect(listed).toHaveLength(3);
      // Exactly one single-column SELECT for N sessions: no session aggregate
      // hydration, no exercise-log/set-log queries, no planned_workouts read,
      // and never one query per session.
      expect(statements).toBe(1);
    } finally {
      await countingClient.end();
    }
  });

  it('leaving a program detaches sessions and they survive as user history', async () => {
    const session = completed(makeSession());
    await workoutSessionRepository.save(session);

    // Leaving the program deletes the enrollment; the FK detaches the session.
    const deleted = await programEnrollmentRepository.delete(enrollmentId('enrollment-test-a'));
    expect(deleted).toBe(true);

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded).not.toBeNull();
    expect(reloaded?.userId).toBe(userId('user-test-a'));
    expect(reloaded?.enrollmentId).toBeNull();
    expect(reloaded?.completedAt).not.toBeNull();

    // A rejoin (new enrollment identity) starts with zero progress.
    const listed = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );
    expect(listed).toEqual([]);
  });

  it('save() maps and reloads user ownership fields', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded?.userId).toBe(userId('user-test-a'));
    expect(loaded?.enrollmentId).toBe(enrollmentId('enrollment-test-a'));
  });

  it('enforces at most one session per enrollment per scheduled occurrence', async () => {
    const first = makeSession('session-test-1');
    await workoutSessionRepository.save(first);

    const second = makeSession('session-test-2');

    await expect(workoutSessionRepository.save(second)).rejects.toBeInstanceOf(
      SessionAlreadyExistsError,
    );
  });

  it('maps a concurrently deleted enrollment to SessionEnrollmentNotFoundError', async () => {
    // Simulates LeaveProgram deleting the enrollment between the use case's
    // enrollment check and the session insert: the enrollment FK violation on
    // insert must surface as the typed race error, not an untyped 500.
    const deleted = await programEnrollmentRepository.delete(enrollmentId('enrollment-test-a'));
    expect(deleted).toBe(true);

    const session = makeSession('session-race-orphan');

    await expect(workoutSessionRepository.save(session)).rejects.toBeInstanceOf(
      SessionEnrollmentNotFoundError,
    );
  });

  it('allows two users to log sessions for the same scheduled occurrence', async () => {
    const first = makeSession('session-user-a', { userId: 'user-test-a' });
    await workoutSessionRepository.save(first);

    const second = makeSession('session-user-b', { userId: 'user-test-b', enrollmentId: 'enrollment-test-b' });
    // save resolves with the persisted aggregate (PR #13 Finding 5 contract).
    const persisted = await workoutSessionRepository.save(second);
    expect(persisted.id).toBe('session-user-b');

    const firstLoaded = await workoutSessionRepository.findByEnrollmentAndScheduledWorkout(
      first.enrollmentId!,
      first.scheduledWorkoutId,
    );
    const secondLoaded = await workoutSessionRepository.findByEnrollmentAndScheduledWorkout(
      second.enrollmentId!,
      second.scheduledWorkoutId,
    );
    expect(firstLoaded?.id).toBe('session-user-a');
    expect(secondLoaded?.id).toBe('session-user-b');
  });

  it('rejects a stale-version save instead of overwriting concurrent changes', async () => {
    const session = makeSession(); // version 0
    await workoutSessionRepository.save(session); // insert -> persisted version 0

    // Simulate a concurrent modification that bumps the persisted version.
    await workoutSessionRepository.save(withOneRepSet(session)); // update 0 -> 1

    // Saving the original (stale) snapshot must fail, not silently replace it.
    await expect(workoutSessionRepository.save(session)).rejects.toBeInstanceOf(
      SessionStaleVersionError,
    );

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.version).toBe(1);
    expect(reloaded?.exerciseLogs[0]?.sets).toHaveLength(1);
  });

  it('rejects a save whose enrollment detached between load and save (leave race)', async () => {
    const session = makeSession(); // version 0, enrollment-test-a
    await workoutSessionRepository.save(session);
    const loaded = await workoutSessionRepository.findById(session.id);
    if (!loaded) throw new Error('session not found');

    // The user leaves: the enrollment FK detaches the persisted session
    // (ON DELETE SET NULL) after the snapshot above was loaded.
    await programEnrollmentRepository.delete(enrollmentId('enrollment-test-a'));

    // Saving the pre-leave snapshot must not commit detached-history changes.
    const completed = completeWorkoutSession(withOneRepSet(loaded), new Date());
    if (!completed.ok) throw new Error(completed.error.message);
    await expect(workoutSessionRepository.save(completed.data)).rejects.toBeInstanceOf(
      SessionEnrollmentChangedError,
    );

    // The detached history is unchanged: not completed, still detached.
    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.completedAt).toBeNull();
    expect(reloaded?.enrollmentId).toBeNull();
    expect(reloaded?.version).toBe(loaded.version);
    expect(reloaded?.exerciseLogs[0]?.sets).toHaveLength(0);
  });

  it('rejects a save when the row was re-pointed to a different enrollment', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);
    const loaded = await workoutSessionRepository.findById(session.id);
    if (!loaded) throw new Error('session not found');

    // Artificial re-point (no production path reattaches a session): the row
    // now belongs to another enrollment identity. The write condition must
    // still refuse a snapshot-based mutation.
    await db
      .update(workoutSessions)
      .set({ enrollmentId: enrollmentId('enrollment-test-b') })
      .where(eq(workoutSessions.id, session.id));

    const completed = completeWorkoutSession(withOneRepSet(loaded), new Date());
    if (!completed.ok) throw new Error(completed.error.message);
    await expect(workoutSessionRepository.save(completed.data)).rejects.toBeInstanceOf(
      SessionEnrollmentChangedError,
    );

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.enrollmentId).toBe('enrollment-test-b');
    expect(reloaded?.completedAt).toBeNull();
  });

  it('persists and returns the session version', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const inserted = await workoutSessionRepository.findById(session.id);
    expect(inserted?.version).toBe(0);

    await workoutSessionRepository.save(withOneRepSet(session));

    const updated = await workoutSessionRepository.findById(session.id);
    expect(updated?.version).toBe(1);
  });

  it('save returns the persisted aggregate with the committed version on insert', async () => {
    // PR #13 Finding 5: the INSERT branch stores the snapshot's own version,
    // and the returned aggregate must carry exactly what the row now holds.
    const session = makeSession(); // version 0
    const persisted = await workoutSessionRepository.save(session);

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(persisted.version).toBe(reloaded?.version);
    expect(persisted.version).toBe(0);
  });

  it('save returns the persisted aggregate with the committed version on update', async () => {
    // PR #13 Finding 5: the UPDATE branch commits version + 1, and the
    // returned aggregate must carry the database's own committed value — a
    // caller building a DTO from it can feed `version` straight back as its
    // next mutation's `expectedSessionVersion` and succeed.
    const session = makeSession(); // version 0
    await workoutSessionRepository.save(session); // insert -> 0

    const persisted = await workoutSessionRepository.save(withOneRepSet(session)); // update -> 1

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(persisted.version).toBe(1);
    expect(persisted.version).toBe(reloaded?.version);
    expect(persisted.exerciseLogs[0]?.sets).toHaveLength(1);
  });

  it('returns isolated objects (mutating a loaded session does not persist)', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded).not.toBeNull();
    withOneRepSet(loaded!); // returns a new object; not saved

    const reloaded = await workoutSessionRepository.findById(session.id);
    expect(reloaded?.exerciseLogs[0]?.sets).toHaveLength(0);
  });

  it('rejects a session whose workout template does not match its scheduled occurrence', async () => {
    // fit40-beginner-strength-w1-1 is scheduled with wo-beginner-strength-a, so
    // pairing it with wo-beginner-strength-b must be rejected by the composite
    // (scheduled_workout_id, workout_id) foreign key.
    await expect(
      db.insert(workoutSessions).values({
        id: 'session-test-mismatch',
        userId: 'user-test-a',
        scheduledWorkoutId: 'fit40-beginner-strength-w1-1',
        workoutId: 'wo-beginner-strength-b',
        startedAt: new Date('2025-01-01T10:00:00Z'),
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23503' }), // foreign_key_violation
    });
  });

  describe('listCompletedByEnrollment()', () => {
    beforeEach(async () => {
      // A second enrollment for the same user in a different program (the
      // (user, program) unique constraint allows one per program) and an
      // enrollment with no sessions — both for scoping assertions.
      await seedEnrollment('enrollment-test-a2', 'user-test-a', 'prog-strong-at-home');
      await seedEnrollment('enrollment-test-empty', 'user-test-a', 'prog-strength-mobility');
    });

    /** Completes a session (one logged set) at an explicit instant. */
    function completeAt(session: WorkoutSession, iso: string): WorkoutSession {
      const done = completeWorkoutSession(withOneRepSet(session), new Date(iso));
      if (!done.ok) throw new Error(done.error.message);
      return done.data;
    }

    async function listedBy(enrollment: string) {
      return workoutSessionRepository.listCompletedByEnrollment(enrollmentId(enrollment));
    }

    it("returns the enrollment's completed sessions as fully hydrated aggregates", async () => {
      const session = completed(makeSession('session-list-1'));
      await workoutSessionRepository.save(session);

      const listed = await listedBy('enrollment-test-a');

      expect(listed).toHaveLength(1);
      const found = listed[0];
      expect(found?.id).toBe('session-list-1');
      // Non-null by construction — the completed-narrowed aggregate type.
      expect(found?.completedAt).toEqual(new Date('2025-01-01T11:00:00Z'));
      expect(found?.exerciseLogs).toHaveLength(2);
      expect(found?.exerciseLogs[0]?.sets).toEqual([
        { type: 'reps', setNumber: 1, reps: 10, weightKg: 20, rpe: 7 },
      ]);
      expect(found?.exerciseLogs[1]?.prescription).toEqual(duration());
      expect(found?.exerciseLogs[1]?.restSeconds).toBe(60);
    });

    it('excludes in-progress sessions', async () => {
      await workoutSessionRepository.save(completed(makeSession('session-done')));
      await workoutSessionRepository.save(
        makeSession('session-in-progress', {
          scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
          workoutId: 'wo-beginner-strength-b',
        }),
      );

      const listed = await listedBy('enrollment-test-a');

      expect(listed.map((session) => session.id)).toEqual(['session-done']);
    });

    it('excludes sessions belonging to another enrollment', async () => {
      await workoutSessionRepository.save(completed(makeSession('session-own')));
      await workoutSessionRepository.save(
        completed(
          makeSession('session-other-enrollment', {
            enrollmentId: 'enrollment-test-a2',
            scheduledWorkoutId: 'strong-at-home-w1-1',
            workoutId: 'wo-home-a',
          }),
        ),
      );

      const own = await listedBy('enrollment-test-a');
      const other = await listedBy('enrollment-test-a2');

      // Exact scoping in both directions: nothing leaks either way.
      expect(own.map((session) => session.id)).toEqual(['session-own']);
      expect(other.map((session) => session.id)).toEqual(['session-other-enrollment']);
    });

    it('excludes detached sessions', async () => {
      const session = completed(makeSession('session-detached'));
      await workoutSessionRepository.save(session);

      // Leaving the program deletes the enrollment; the FK detaches the row.
      const deleted = await programEnrollmentRepository.delete(enrollmentId('enrollment-test-a'));
      expect(deleted).toBe(true);

      expect(await listedBy('enrollment-test-a')).toEqual([]);
      // The history itself survives as user-owned, detached truth.
      const stored = await workoutSessionRepository.findById(session.id);
      expect(stored?.completedAt).not.toBeNull();
      expect(stored?.enrollmentId).toBeNull();
    });

    it("excludes sessions belonging to another user's enrollment", async () => {
      await workoutSessionRepository.save(
        completed(
          makeSession('session-user-b', {
            userId: 'user-test-b',
            enrollmentId: 'enrollment-test-b',
          }),
        ),
      );

      expect(await listedBy('enrollment-test-a')).toEqual([]);
      // ...and the owning user still sees their own session.
      expect((await listedBy('enrollment-test-b')).map((session) => session.id)).toEqual([
        'session-user-b',
      ]);
    });

    it('orders ascending by completedAt', async () => {
      // Saved out of order; the ids also contradict completion order so an
      // id-ordered (or insertion-ordered) read would fail this assertion.
      const doneLast = completeAt(
        makeSession('session-a-done-last', {
          scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
          workoutId: 'wo-beginner-strength-b',
        }),
        '2025-01-03T11:00:00Z',
      );
      const doneFirst = completeAt(makeSession('session-b-done-first'), '2025-01-01T11:00:00Z');
      const doneMiddle = completeAt(
        makeSession('session-c-done-middle', {
          scheduledWorkoutId: 'fit40-beginner-strength-w1-3',
          workoutId: 'wo-beginner-strength-c',
        }),
        '2025-01-02T11:00:00Z',
      );
      await workoutSessionRepository.save(doneLast);
      await workoutSessionRepository.save(doneFirst);
      await workoutSessionRepository.save(doneMiddle);

      const listed = await listedBy('enrollment-test-a');

      expect(listed.map((session) => session.id)).toEqual([
        'session-b-done-first',
        'session-c-done-middle',
        'session-a-done-last',
      ]);
    });

    it('breaks completedAt ties by startedAt ascending', async () => {
      // Both complete at the same instant; the later-starting session carries
      // the alphabetically smaller id, so an id tie-break would invert the
      // expected order and fail this assertion.
      const laterStart = completed(
        makeSession('session-x-later-start', {
          scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
          workoutId: 'wo-beginner-strength-b',
          startedAt: '2025-01-01T10:00:00Z',
        }),
      );
      const earlierStart = completed(
        makeSession('session-y-earlier-start', { startedAt: '2025-01-01T09:00:00Z' }),
      );
      await workoutSessionRepository.save(laterStart);
      await workoutSessionRepository.save(earlierStart);

      const listed = await listedBy('enrollment-test-a');

      expect(listed.map((session) => session.id)).toEqual([
        'session-y-earlier-start',
        'session-x-later-start',
      ]);
    });

    it('breaks completedAt and startedAt ties by session id ascending', async () => {
      // Identical timestamps on both ladder rungs; saved in reverse id order
      // so an insertion-ordered read would fail this assertion.
      const first = completed(
        makeSession('session-tie-b', {
          scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
          workoutId: 'wo-beginner-strength-b',
          startedAt: '2025-01-01T10:00:00Z',
        }),
      );
      const second = completed(
        makeSession('session-tie-a', { startedAt: '2025-01-01T10:00:00Z' }),
      );
      await workoutSessionRepository.save(first);
      await workoutSessionRepository.save(second);

      const listed = await listedBy('enrollment-test-a');

      expect(listed.map((session) => session.id)).toEqual(['session-tie-a', 'session-tie-b']);
    });

    it('preserves exercise logs, set logs, provenance, skip state, and prescription snapshots', async () => {
      const built = createWorkoutSession({
        id: 'session-rich',
        userId: userId('user-test-a'),
        enrollmentId: enrollmentId('enrollment-test-a'),
        scheduledWorkoutId: scheduledWorkoutId('fit40-beginner-strength-w1-1'),
        workoutId: workoutId('wo-beginner-strength-a'),
        startedAt: new Date('2025-01-01T10:00:00Z'),
        exerciseLogs: [
          { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
          { authoredExerciseId: exerciseId('ex-015'), order: 2, prescription: duration(), restSeconds: 60 },
          {
            authoredExerciseId: exerciseId('ex-002'),
            order: 3,
            prescription: reps(),
            restSeconds: 45,
            source: OccurrenceSource.UserAdded,
          },
          {
            authoredExerciseId: exerciseId('ex-015'),
            order: 4,
            prescription: reps(),
            restSeconds: 60,
            isSkipped: true,
          },
        ],
      });
      if (!built.ok) throw new Error(built.error.message);

      // Substitution on the not-yet-logged occurrence 2: authored ex-015,
      // performed ex-010. Sets are logged on occurrence 1 only.
      const substituted = substituteSessionExercise(built.data, {
        exerciseOrder: 2,
        replacementExerciseId: exerciseId('ex-010'),
      });
      if (!substituted.ok) throw new Error(substituted.error.message);

      const withSets = withTwoRepSets(substituted.data);
      const done = completeWorkoutSession(withSets, new Date('2025-01-01T12:00:00Z'));
      if (!done.ok) throw new Error(done.error.message);
      await workoutSessionRepository.save(done.data);

      const listed = await listedBy('enrollment-test-a');

      expect(listed).toHaveLength(1);
      const found = listed[0];
      expect(found?.completedAt).toEqual(new Date('2025-01-01T12:00:00Z'));
      expect(found?.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3, 4]);

      const [first, second, third, fourth] = found!.exerciseLogs;

      // Fully hydrated set logs survive the batched read with their values.
      expect(first?.sets).toEqual([
        { type: 'reps', setNumber: 1, reps: 10, weightKg: 20, rpe: 7 },
        { type: 'reps', setNumber: 2, reps: 12, weightKg: 22.5, rpe: 8 },
      ]);
      // Prescription/rest snapshots survive untouched by the read.
      expect(first?.prescription).toEqual(reps());
      expect(first?.restSeconds).toBe(90);

      // Substitution provenance: authored identity kept, performed rewritten,
      // prescription unchanged by the substitution.
      expect(second?.authoredExerciseId).toBe('ex-015');
      expect(second?.performedExerciseId).toBe('ex-010');
      expect(second?.source).toBe(OccurrenceSource.Template);
      expect(second?.prescription).toEqual(duration());
      expect(second?.restSeconds).toBe(60);

      // User-added provenance survives.
      expect(third?.source).toBe(OccurrenceSource.UserAdded);
      expect(third?.authoredExerciseId).toBe('ex-002');
      expect(third?.performedExerciseId).toBe('ex-002');
      expect(third?.restSeconds).toBe(45);

      // Skip truth survives: the decision rides the occurrence, which keeps
      // its full authored contract and zero sets.
      expect(fourth?.isSkipped).toBe(true);
      expect(fourth?.sets).toEqual([]);
      expect(fourth?.authoredExerciseId).toBe('ex-015');
      expect(fourth?.prescription).toEqual(reps());

      // Occurrence keys survive distinctly per occurrence.
      expect(new Set(found!.exerciseLogs.map((log) => log.occurrenceKey)).size).toBe(4);
    });

    it('returns [] for an enrollment with no completed sessions', async () => {
      // Another enrollment has data, so this emptiness is scoped — not an
      // artifact of an empty database.
      await workoutSessionRepository.save(completed(makeSession('session-somewhere')));

      expect(await listedBy('enrollment-test-empty')).toEqual([]);
    });

    it('issues a fixed three statements regardless of session count (no N+1)', async () => {
      await workoutSessionRepository.save(completed(makeSession('session-batch-1')));
      await workoutSessionRepository.save(
        completed(
          makeSession('session-batch-2', {
            scheduledWorkoutId: 'fit40-beginner-strength-w1-2',
            workoutId: 'wo-beginner-strength-b',
          }),
        ),
      );
      await workoutSessionRepository.save(
        completed(
          makeSession('session-batch-3', {
            scheduledWorkoutId: 'fit40-beginner-strength-w1-3',
            workoutId: 'wo-beginner-strength-c',
          }),
        ),
      );

      // A dedicated counting client: postgres.js' debug hook fires once per
      // executed statement, so the read's statement count is observable.
      let statements = 0;
      const countingClient = postgres(getTestDatabaseUrl(), {
        max: 1,
        debug: () => {
          statements += 1;
        },
      });
      try {
        const countingDb = drizzle(countingClient, { schema });
        const countingRepo = new DrizzleWorkoutSessionRepository(countingDb);

        // Warm the connection first: a fresh postgres.js client runs a
        // one-time pg_catalog type-introspection statement on its very first
        // query — connection initialization, not part of the read. Measuring
        // the second invocation isolates the read's own statement count.
        await countingRepo.listCompletedByEnrollment(enrollmentId('enrollment-test-a'));
        statements = 0;

        const listed = await countingRepo.listCompletedByEnrollment(
          enrollmentId('enrollment-test-a'),
        );

        expect(listed).toHaveLength(3);
        // One session query + one batched exercise-log query + one batched
        // set-log query — exactly three statements for N sessions, never one
        // query per session.
        expect(statements).toBe(3);
      } finally {
        await countingClient.end();
      }
    });
  });
});

afterAll(async () => {
  await closeDatabase();
});
