import { asc, eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
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
  createWorkoutSessionId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { exerciseLogs, users } from '@/infrastructure/database/schema';

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

/**
 * A two-occurrence session (ex-002 order 1, ex-015 order 2) mirroring the
 * canonical repository-test fixture; the factory defaults performed :=
 * authored, so a plain session exercises the authored == performed path.
 */
function makeSession(id = 'session-subst-1'): WorkoutSession {
  const result = createWorkoutSession({
    id,
    userId: userId('user-test-a'),
    enrollmentId: enrollmentId('enrollment-test-a'),
    scheduledWorkoutId: scheduledWorkoutId('fit40-beginner-strength-w1-1'),
    workoutId: workoutId('wo-beginner-strength-a'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
      { authoredExerciseId: exerciseId('ex-015'), order: 2, prescription: reps(), restSeconds: 60 },
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

describe('DrizzleWorkoutSessionRepository authored/performed persistence', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-test-a');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
  });

  it('round-trips a normal session with authored == performed', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const rows = await loadLogRows(session.id);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.exerciseId).toBe('ex-002');
    expect(rows[0]?.authoredExerciseId).toBe('ex-002');
    expect(rows[1]?.exerciseId).toBe('ex-015');
    expect(rows[1]?.authoredExerciseId).toBe('ex-015');

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded?.exerciseLogs[0]?.authoredExerciseId).toBe('ex-002');
    expect(loaded?.exerciseLogs[0]?.performedExerciseId).toBe('ex-002');
  });

  it('round-trips a substituted session with authored != performed', async () => {
    const session = makeSession();
    const substituted = substituteSessionExercise(session, {
      exerciseOrder: 1,
      replacementExerciseId: exerciseId('ex-009'),
    });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    await workoutSessionRepository.save(substituted.data);

    // The persisted row keeps the authored identity while the performed id
    // is the replacement: the two identities are stored separately.
    const rows = await loadLogRows(session.id);
    expect(rows[0]?.exerciseId).toBe('ex-009');
    expect(rows[0]?.authoredExerciseId).toBe('ex-002');
    expect(rows[1]?.exerciseId).toBe('ex-015');
    expect(rows[1]?.authoredExerciseId).toBe('ex-015');

    const loaded = await workoutSessionRepository.findById(session.id);
    const first = loaded?.exerciseLogs[0];
    expect(first?.authoredExerciseId).toBe('ex-002');
    expect(first?.performedExerciseId).toBe('ex-009');
    // The authored prescription snapshot is untouched by the substitution.
    expect(first?.prescription).toEqual(reps());
    expect(first?.restSeconds).toBe(90);
    expect(first?.order).toBe(1);
  });

  it('hydrates a legacy row with NULL authored_exercise_id as authored == performed', async () => {
    const session = makeSession('session-subst-legacy');
    await workoutSessionRepository.save(session);

    // Simulate a pre-M9 row: authored_exercise_id was not written back then.
    await db
      .update(exerciseLogs)
      .set({ authoredExerciseId: null })
      .where(eq(exerciseLogs.sessionId, session.id));

    const loaded = await workoutSessionRepository.findById(session.id);
    expect(loaded).not.toBeNull();
    if (loaded === null) return;
    // NULL authored falls back to the performed id: legacy rows read as
    // performed-as-authored, never substituted.
    expect(loaded.exerciseLogs[0]?.authoredExerciseId).toBe('ex-002');
    expect(loaded.exerciseLogs[0]?.performedExerciseId).toBe('ex-002');
    expect(loaded.exerciseLogs[1]?.authoredExerciseId).toBe('ex-015');
    expect(loaded.exerciseLogs[1]?.performedExerciseId).toBe('ex-015');
  });

  it('writes an explicit authored_exercise_id when saving a legacy-hydrated session', async () => {
    const session = makeSession('session-subst-legacy-write');
    await workoutSessionRepository.save(session);
    await db
      .update(exerciseLogs)
      .set({ authoredExerciseId: null })
      .where(eq(exerciseLogs.sessionId, session.id));

    // Load (authored resolves from performed), mutate, and save: the write
    // path must persist an explicit authored id, not NULL again.
    const loaded = await workoutSessionRepository.findById(session.id);
    if (loaded === null) throw new Error('session not found');
    const substituted = substituteSessionExercise(loaded, {
      exerciseOrder: 2,
      replacementExerciseId: exerciseId('ex-010'),
    });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    await workoutSessionRepository.save(substituted.data);

    const rows = await loadLogRows(session.id);
    // Both occurrences now carry an explicit authored id (legacy NULL healed
    // by the first post-hydration save), performed ids rewritten correctly.
    expect(rows[0]?.authoredExerciseId).toBe('ex-002');
    expect(rows[0]?.exerciseId).toBe('ex-002');
    expect(rows[1]?.authoredExerciseId).toBe('ex-015');
    expect(rows[1]?.exerciseId).toBe('ex-010');
  });

  it('keeps duplicate occurrence identity intact when the same exercise appears twice', async () => {
    // Both occurrences authored as ex-002: occurrence identity is
    // (session_id, exercise_order), not the exercise id.
    const result = createWorkoutSession({
      id: 'session-subst-dup',
      userId: userId('user-test-a'),
      enrollmentId: enrollmentId('enrollment-test-a'),
      scheduledWorkoutId: scheduledWorkoutId('fit40-beginner-strength-w1-1'),
      workoutId: workoutId('wo-beginner-strength-a'),
      startedAt: new Date('2025-01-01T10:00:00Z'),
      exerciseLogs: [
        { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
        { authoredExerciseId: exerciseId('ex-002'), order: 2, prescription: reps(), restSeconds: 60 },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);

    // Substitute only the second occurrence: the first occurrence stays
    // ex-002 because identity is per-occurrence, not per-exercise.
    const substituted = substituteSessionExercise(result.data, {
      exerciseOrder: 2,
      replacementExerciseId: exerciseId('ex-009'),
    });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    await workoutSessionRepository.save(substituted.data);

    const rows = await loadLogRows('session-subst-dup');
    expect(rows).toHaveLength(2);
    expect(rows[0]?.exerciseOrder).toBe(1);
    expect(rows[0]?.exerciseId).toBe('ex-002');
    expect(rows[0]?.authoredExerciseId).toBe('ex-002');
    expect(rows[1]?.exerciseOrder).toBe(2);
    expect(rows[1]?.exerciseId).toBe('ex-009');
    expect(rows[1]?.authoredExerciseId).toBe('ex-002');

    const reloaded = await workoutSessionRepository.findById(sessionId('session-subst-dup'));
    expect(reloaded?.exerciseLogs[0]?.performedExerciseId).toBe('ex-002');
    expect(reloaded?.exerciseLogs[1]?.performedExerciseId).toBe('ex-009');
  });

  it('rejects a log whose authored_exercise_id does not reference a catalog exercise', async () => {
    // A real session so only the authored_exercise_id FK can be violated: a
    // raw insert with a dangling authored id (unreachable through the
    // repository, whose ids come from the catalog) is rejected by the FK.
    const session = makeSession('session-subst-fk');
    await workoutSessionRepository.save(session);

    await expect(
      db.insert(exerciseLogs).values({
        sessionId: session.id,
        exerciseOrder: 3,
        exerciseId: 'ex-002',
        authoredExerciseId: 'ex-does-not-exist',
        prescriptionType: 'reps',
        sets: 3,
        minReps: 8,
        maxReps: 10,
        restSeconds: 90,
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({
        code: '23503', // foreign_key_violation
        constraint_name: 'exercise_logs_authored_exercise_id_exercises_id_fk',
      }),
    });
  });

  it('still marks its scheduled workout completed when a session with a substituted exercise completes', async () => {
    // Program progress keys on (enrollmentId, scheduledWorkoutId) — never on
    // exercise identity. Completing a session whose exercise was substituted
    // (ex-002 → ex-010 here) must list that scheduled workout as completed,
    // same as any other completion.
    const session = makeSession('session-subst-completion');
    const substituted = substituteSessionExercise(session, {
      exerciseOrder: 1,
      replacementExerciseId: exerciseId('ex-010'),
    });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const withSet = logSessionSet(substituted.data, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: null,
    });
    expect(withSet.ok).toBe(true);
    if (!withSet.ok) return;
    const completedSession = completeWorkoutSession(
      withSet.data,
      new Date('2025-01-01T11:00:00Z'),
    );
    expect(completedSession.ok).toBe(true);
    if (!completedSession.ok) return;
    await workoutSessionRepository.save(completedSession.data);

    const completedIds = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );
    expect(completedIds).toContainEqual(scheduledWorkoutId('fit40-beginner-strength-w1-1'));
  });

  it('does not count an in-progress substituted session toward program progress', async () => {
    // The in-progress twin (saved, not completed) must not count toward
    // program progress just because it carries a substitution.
    const session = makeSession('session-subst-completion-progress');
    const substituted = substituteSessionExercise(session, {
      exerciseOrder: 1,
      replacementExerciseId: exerciseId('ex-010'),
    });
    expect(substituted.ok).toBe(true);
    if (!substituted.ok) return;
    const withSet = logSessionSet(substituted.data, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: null,
    });
    expect(withSet.ok).toBe(true);
    if (!withSet.ok) return;
    await workoutSessionRepository.save(withSet.data);

    const completedIds = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId('enrollment-test-a'),
    );
    expect(completedIds).toEqual([]);
  });
});

afterAll(async () => {
  await closeDatabase();
});

