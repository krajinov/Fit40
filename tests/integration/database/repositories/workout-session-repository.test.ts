import { beforeEach, describe, expect, it } from 'vitest';

import { INITIAL_SESSION_VERSION } from '@/domain/entities/workout-session';
import { createWorkoutSessionId, type WorkoutSessionId } from '@/domain/types/ids';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import {
  durationExercise,
  loadOccurrence,
  repsExercise,
  startSession,
  withCompletion,
  withDeletedSet,
  withLoggedSet,
  withUpdatedSet,
} from '../fixtures';
import { resetDatabase, setupTestDb, testDb } from '../setup';

function sessionId(value: string): WorkoutSessionId {
  const result = createWorkoutSessionId(value);
  if (!result.ok) {
    throw new Error(result.error.message);
  }
  return result.data;
}

describe('DrizzleWorkoutSessionRepository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  const repository = () => new DrizzleWorkoutSessionRepository(testDb);

  it('saves and retrieves the full session aggregate', async () => {
    const occurrence = await loadOccurrence();
    const first = repsExercise(occurrence);
    const session = withCompletion(
      withLoggedSet(startSession('session-full', occurrence), {
        exerciseOrder: first.order,
        type: 'reps',
        reps: 8,
        weightKg: 20,
        rpe: 8,
      }),
      new Date('2026-08-27T11:00:00.000Z'),
    );

    expect((await repository().save(session)).ok).toBe(true);

    const loaded = await repository().findById(session.id);
    expect(loaded).not.toBeNull();
    expect(loaded?.scheduledWorkoutId).toBe(occurrence.scheduledWorkoutId);
    expect(loaded?.workoutId).toBe(occurrence.workoutId);
    expect(loaded?.startedAt.toISOString()).toBe('2026-08-27T10:00:00.000Z');
    expect(loaded?.completedAt?.toISOString()).toBe('2026-08-27T11:00:00.000Z');
    expect(loaded?.exerciseLogs.map((log) => log.order)).toEqual([1, 2, 3, 4, 5]);
    expect(loaded?.exerciseLogs.map((log) => log.exerciseId)).toEqual(
      occurrence.exercises.map((exercise) => exercise.exerciseId),
    );
    expect(loaded?.exerciseLogs[0]?.restSeconds).toBe(first.restSeconds);
    expect(loaded?.exerciseLogs[0]?.prescription).toEqual(first.prescription);
    expect(loaded?.exerciseLogs[0]?.sets).toEqual([
      { type: 'reps', setNumber: 1, reps: 8, weightKg: 20, rpe: 8 },
    ]);
  });

  it('round-trips duration sets and absent optional fields', async () => {
    const occurrence = await loadOccurrence();
    const held = durationExercise(occurrence);
    const session = withLoggedSet(startSession('session-duration', occurrence), {
      exerciseOrder: held.order,
      type: 'duration',
      durationSeconds: 30,
      weightKg: null,
      rpe: null,
    });

    expect((await repository().save(session)).ok).toBe(true);

    const loaded = await repository().findById(session.id);
    expect(loaded?.exerciseLogs.find((log) => log.order === held.order)?.sets).toEqual([
      { type: 'duration', setNumber: 1, durationSeconds: 30, weightKg: null, rpe: null },
    ]);
  });

  it('finds a session by scheduled workout id', async () => {
    const occurrence = await loadOccurrence();
    const session = startSession('session-by-occurrence', occurrence);

    await repository().save(session);

    const loaded = await repository().findByScheduledWorkoutId(occurrence.scheduledWorkoutId);
    expect(loaded?.id).toBe(session.id);
  });

  it('returns null when no session matches the requested id', async () => {
    const occurrence = await loadOccurrence();

    expect(await repository().findById(sessionId('missing'))).toBeNull();
    expect(await repository().findByScheduledWorkoutId(occurrence.scheduledWorkoutId)).toBeNull();
  });

  it('updates the stored session in place instead of appending', async () => {
    const occurrence = await loadOccurrence();
    const first = repsExercise(occurrence);
    const initial = withLoggedSet(startSession('session-update', occurrence), {
      exerciseOrder: first.order,
      type: 'reps',
      reps: 8,
      weightKg: 20,
      rpe: 8,
    });

    await repository().save(initial);
    const extended = withLoggedSet(initial, {
      exerciseOrder: first.order,
      type: 'reps',
      reps: 10,
      weightKg: 22.5,
      rpe: 9,
    });
    expect((await repository().save(extended)).ok).toBe(true);

    const loaded = await repository().findById(initial.id);
    expect(loaded?.exerciseLogs[0]?.sets).toEqual([
      { type: 'reps', setNumber: 1, reps: 8, weightKg: 20, rpe: 8 },
      { type: 'reps', setNumber: 2, reps: 10, weightKg: 22.5, rpe: 9 },
    ]);
  });

  it('persists set updates and renumbering after a deletion', async () => {
    const occurrence = await loadOccurrence();
    const first = repsExercise(occurrence);
    let session = startSession('session-renumber', occurrence);

    for (const reps of [8, 10, 12]) {
      session = withLoggedSet(session, {
        exerciseOrder: first.order,
        type: 'reps',
        reps,
        weightKg: 20,
        rpe: 8,
      });
    }

    session = withUpdatedSet(session, {
      exerciseOrder: first.order,
      setNumber: 2,
      type: 'reps',
      reps: 20,
      weightKg: 30,
      rpe: 9,
    });
    session = withDeletedSet(session, { exerciseOrder: first.order, setNumber: 1 });

    await repository().save(session);

    const loaded = await repository().findById(session.id);
    expect(loaded?.exerciseLogs[0]?.sets).toEqual([
      { type: 'reps', setNumber: 1, reps: 20, weightKg: 30, rpe: 9 },
      { type: 'reps', setNumber: 2, reps: 12, weightKg: 20, rpe: 8 },
    ]);
  });

  it('lists completed sessions oldest first', async () => {
    const monday = await loadOccurrence(1, 1);
    const tuesday = await loadOccurrence(1, 2);

    await repository().save(
      withCompletion(
        withLoggedSet(
          startSession('session-newer', monday, new Date('2026-08-27T10:00:00.000Z')),
          {
            exerciseOrder: repsExercise(monday).order,
            type: 'reps',
            reps: 8,
            weightKg: null,
            rpe: null,
          },
        ),
        new Date('2026-08-27T11:00:00.000Z'),
      ),
    );
    await repository().save(
      withCompletion(
        withLoggedSet(
          startSession('session-older', tuesday, new Date('2026-08-26T10:00:00.000Z')),
          {
            exerciseOrder: repsExercise(tuesday).order,
            type: 'reps',
            reps: 8,
            weightKg: null,
            rpe: null,
          },
        ),
        new Date('2026-08-26T11:00:00.000Z'),
      ),
    );
    const wednesday = await loadOccurrence(1, 3);
    await repository().save(startSession('session-in-progress', wednesday, new Date()));

    const completed = await repository().listCompleted();

    expect(completed.map((session) => session.id)).toEqual(['session-older', 'session-newer']);
  });

  it('keeps sessions of different scheduled occurrences independent', async () => {
    const monday = await loadOccurrence(1, 1);
    const tuesday = await loadOccurrence(1, 2);

    await repository().save(startSession('session-monday', monday));
    await repository().save(startSession('session-tuesday', tuesday));

    const loadedMonday = await repository().findByScheduledWorkoutId(monday.scheduledWorkoutId);
    const loadedTuesday = await repository().findByScheduledWorkoutId(
      tuesday.scheduledWorkoutId,
    );

    expect(loadedMonday?.id).toBe('session-monday');
    expect(loadedTuesday?.id).toBe('session-tuesday');
  });

  it('reports a conflict when a second session claims the same scheduled workout', async () => {
    const occurrence = await loadOccurrence();
    const winner = startSession('session-winner', occurrence);
    expect((await repository().save(winner)).ok).toBe(true);

    const loser = startSession('session-loser', occurrence);
    const result = await repository().save(loser);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      reason: 'scheduled-workout-conflict',
      scheduledWorkoutId: occurrence.scheduledWorkoutId,
    });

    expect(await repository().findById(loser.id)).toBeNull();
    expect(
      await repository().findByScheduledWorkoutId(occurrence.scheduledWorkoutId),
    ).toMatchObject({ id: 'session-winner' });
  });

  it('round-trips the concurrency token and advances it on every accepted save', async () => {
    const occurrence = await loadOccurrence();
    const first = repsExercise(occurrence);
    const created = startSession('session-revisions', occurrence);
    expect(created.version).toBe(INITIAL_SESSION_VERSION);

    const inserted = await repository().save(created);
    expect(inserted).toEqual({ ok: true, data: INITIAL_SESSION_VERSION });
    expect((await repository().findById(created.id))?.version).toBe(INITIAL_SESSION_VERSION);

    // Writing from the revision the previous save reported moves the row forward.
    const stored = await repository().findById(created.id);
    if (stored === null) throw new Error('Expected the session to be stored');
    const logged = withLoggedSet(stored, {
      exerciseOrder: first.order,
      type: 'reps',
      reps: 10,
      weightKg: null,
      rpe: null,
    });

    const updated = await repository().save(logged);
    expect(updated).toEqual({ ok: true, data: INITIAL_SESSION_VERSION + 1 });
    expect((await repository().findById(created.id))?.version).toBe(INITIAL_SESSION_VERSION + 1);
  });

  it('refuses a save built from a revision that is no longer stored', async () => {
    const occurrence = await loadOccurrence();
    const first = repsExercise(occurrence);
    const created = startSession('session-stale', occurrence);
    await repository().save(created);

    // Two requests load the same revision. Whichever reaches storage last would
    // silently discard the other's set, so it must be refused instead.
    const winner = withLoggedSet(created, {
      exerciseOrder: first.order,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: 8,
    });
    expect((await repository().save(winner)).ok).toBe(true);

    const loser = withLoggedSet(created, {
      exerciseOrder: first.order,
      type: 'reps',
      reps: 1,
      weightKg: null,
      rpe: null,
    });
    const result = await repository().save(loser);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toEqual({
      reason: 'concurrent-modification',
      sessionId: 'session-stale',
      expectedVersion: INITIAL_SESSION_VERSION,
    });

    // The rejected save wrote nothing: neither the parent row nor its sets moved.
    const stored = await repository().findById(created.id);
    expect(stored?.version).toBe(INITIAL_SESSION_VERSION + 1);
    expect(stored?.exerciseLogs[0]?.sets).toEqual([
      { type: 'reps', setNumber: 1, reps: 10, weightKg: 20, rpe: 8 },
    ]);
  });

  it('refuses to complete a session another request already completed', async () => {
    const occurrence = await loadOccurrence();
    const first = repsExercise(occurrence);
    const inProgress = withLoggedSet(startSession('session-double-complete', occurrence), {
      exerciseOrder: first.order,
      type: 'reps',
      reps: 8,
      weightKg: null,
      rpe: null,
    });
    await repository().save(inProgress);

    const stored = await repository().findById(inProgress.id);
    if (stored === null) throw new Error('Expected the session to be stored');

    const firstCompletion = withCompletion(stored, new Date('2026-08-27T11:00:00.000Z'));
    expect((await repository().save(firstCompletion)).ok).toBe(true);

    const secondCompletion = withCompletion(stored, new Date('2026-08-27T12:00:00.000Z'));
    const result = await repository().save(secondCompletion);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.reason).toBe('concurrent-modification');

    const kept = await repository().findById(inProgress.id);
    expect(kept?.completedAt?.toISOString()).toBe('2026-08-27T11:00:00.000Z');
  });
});
