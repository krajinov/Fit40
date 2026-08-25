import { beforeEach, describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  deleteSessionSet,
  logSessionSet,
  updateSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createWorkoutId,
} from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';

import { WorkoutSessionConflictError } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';

import { resetAndSeed, workoutSessionRepository } from './setup';

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

function makeSession(id = 'session-test-1'): WorkoutSession {
  const result = createWorkoutSession({
    id,
    scheduledWorkoutId: scheduledWorkoutId('fit40-beginner-strength-w1-1'),
    workoutId: workoutId('wo-beginner-strength-a'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
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

describe('DrizzleWorkoutSessionRepository', () => {
  beforeEach(async () => {
    await resetAndSeed();
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

    const edited = updateSessionSet(withSet, {
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

  it('findByScheduledWorkoutId() returns the session', async () => {
    const session = makeSession();
    await workoutSessionRepository.save(session);

    const loaded = await workoutSessionRepository.findByScheduledWorkoutId(
      session.scheduledWorkoutId,
    );
    expect(loaded?.id).toBe(session.id);
  });

  it('enforces at most one session per scheduled workout', async () => {
    const first = makeSession('session-test-1');
    await workoutSessionRepository.save(first);

    const second = makeSession('session-test-2');

    await expect(workoutSessionRepository.save(second)).rejects.toBeInstanceOf(
      WorkoutSessionConflictError,
    );
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
});
