import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  deleteSessionSet,
  logSessionSet,
  updateSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
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
  SessionEnrollmentNotFoundError,
  SessionStaleVersionError,
} from '@/application/ports/workout-session-repository';
import { users, workoutSessions } from '@/infrastructure/database/schema';

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
      { exerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
      { exerciseId: exerciseId('ex-015'), order: 2, prescription: duration(), restSeconds: 60 },
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
    await expect(workoutSessionRepository.save(second)).resolves.toBeUndefined();

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

  it('persists and returns the session version', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const inserted = await workoutSessionRepository.findById(session.id);
    expect(inserted?.version).toBe(0);

    await workoutSessionRepository.save(withOneRepSet(session));

    const updated = await workoutSessionRepository.findById(session.id);
    expect(updated?.version).toBe(1);
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
});

afterAll(async () => {
  await closeDatabase();
});
