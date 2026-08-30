import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';

import { users } from '@/infrastructure/database/schema';
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

/** reps of a set, narrowed for assertions (undefined for duration sets). */
function repsOf(set: { type: 'reps' | 'duration'; reps?: number } | undefined): number | undefined {
  return set?.type === 'reps' ? set.reps : undefined;
}

/** Creates a real user row so session ownership FKs are satisfiable. */
async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@example.test`, passwordHash: 'x' });
}

/** Creates a real enrollment row so session enrollment FKs are satisfiable. */
async function seedEnrollment(id: string, uid: string, programId: string): Promise<void> {
  const result = createProgramEnrollment({
    id,
    userId: uid,
    programId,
    enrolledAt: new Date('2026-01-01T00:00:00Z'),
  });
  if (!result.ok) throw new Error(result.error.message);
  await programEnrollmentRepository.create(result.data);
}

/**
 * Valid (scheduled_workout_id, workout_id) occurrence pairs from the seeded
 * beginner-strength program, so the composite occurrence/template FK is
 * satisfied and multiple sessions can coexist under one enrollment.
 */
const OCCURRENCES = [
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-3', workoutId: 'wo-beginner-strength-c' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-1', workoutId: 'wo-beginner-strength-a' },
] as const;

interface HistorySetSpec {
  readonly reps?: number;
  readonly durationSeconds?: number;
  readonly weightKg?: number | null;
  readonly rpe?: number | null;
}

interface HistoryLogSpec {
  readonly exerciseId: string;
  readonly type: 'reps' | 'duration';
  readonly sets: ReadonlyArray<HistorySetSpec>;
}

/**
 * Builds a session with explicit per-exercise logged sets on a seeded
 * occurrence. Omitting `completedAt` leaves the session in progress. Exercise
 * orders are assigned sequentially from 1 in the order the logs are given.
 */
function historySession(spec: {
  id: string;
  userId?: string;
  enrollmentId?: string | null;
  occurrence?: number;
  startedAt: string;
  completedAt?: string;
  logs: ReadonlyArray<HistoryLogSpec>;
}): WorkoutSession {
  const occurrence = OCCURRENCES[spec.occurrence ?? 0];
  if (occurrence === undefined) {
    throw new Error(`Unknown occurrence index ${spec.occurrence ?? 0}`);
  }

  const created = createWorkoutSession({
    id: spec.id,
    userId: userId(spec.userId ?? 'user-test-a'),
    enrollmentId:
      spec.enrollmentId === undefined
        ? enrollmentId('enrollment-test-a')
        : spec.enrollmentId === null
          ? null
          : enrollmentId(spec.enrollmentId),
    scheduledWorkoutId: scheduledWorkoutId(occurrence.scheduledWorkoutId),
    workoutId: workoutId(occurrence.workoutId),
    startedAt: new Date(spec.startedAt),
    exerciseLogs: spec.logs.map((log, index) => ({
      exerciseId: exerciseId(log.exerciseId),
      order: index + 1,
      prescription: log.type === 'reps' ? reps() : duration(),
      restSeconds: 90,
    })),
  });
  if (!created.ok) throw new Error(created.error.message);
  let session = created.data;
  for (const [index, log] of spec.logs.entries()) {
    for (const set of log.sets) {
      const logged =
        log.type === 'reps'
          ? logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'reps',
              reps: set.reps ?? 10,
              weightKg: set.weightKg ?? null,
              rpe: set.rpe ?? null,
            })
          : logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'duration',
              durationSeconds: set.durationSeconds ?? 30,
              weightKg: set.weightKg ?? null,
              rpe: set.rpe ?? null,
            });
      if (!logged.ok) throw new Error(logged.error.message);
      session = logged.data;
    }
  }

  if (spec.completedAt === undefined) {
    return session;
  }
  const done = completeWorkoutSession(session, new Date(spec.completedAt));
  if (!done.ok) throw new Error(done.error.message);
  return done.data;
}

describe('DrizzleWorkoutSessionRepository.listLatestCompletedExercisePerformances', () => {
  beforeEach(async () => {
    await resetAndSeed();
    await seedUser('user-test-a');
    await seedUser('user-test-b');
    await seedEnrollment('enrollment-test-a', 'user-test-a', 'prog-beginner-strength');
    await seedEnrollment('enrollment-test-b', 'user-test-b', 'prog-beginner-strength');
  });

  it('returns an empty result for an empty exercise id list', async () => {
    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [],
    );
    expect(result).toEqual([]);
  });

  it('returns an empty result when only in-progress sessions exist', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-open',
      startedAt: '2025-01-06T10:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] }],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toEqual([]);
  });

  it('returns an empty result when the user has no completed history for the exercises', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-none',
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] }],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-404')],
    );
    expect(result).toEqual([]);
  });

  it('ignores in-progress sessions even when started more recently', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-done',
      occurrence: 0,
      startedAt: '2025-01-06T09:00:00Z',
      completedAt: '2025-01-06T10:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8 }] }],
    }));
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-open2',
      occurrence: 1,
      startedAt: '2025-06-01T09:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 9 }] }],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('session-hist-done');
  });

  it('returns only the latest completed performance per exercise', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-jan',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
    }));
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-feb',
      occurrence: 2,
      startedAt: '2025-02-03T10:00:00Z',
      completedAt: '2025-02-03T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 50 }] }],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('session-hist-feb');
    expect(result[0]?.completedAt).toEqual(new Date('2025-02-03T11:00:00Z'));
    expect(result[0]?.sets[0]?.weightKg).toBe(50);
  });

  it('breaks a completed_at tie by the later started_at', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-a',
      occurrence: 0,
      startedAt: '2025-01-06T08:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8 }] }],
    }));
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-b',
      occurrence: 2,
      startedAt: '2025-01-06T09:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 12 }] }],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('session-hist-b');
    expect(repsOf(result[0]?.sets[0])).toBe(12);
  });

  it('breaks a full completed_at and started_at tie by the greater session id', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-tie-a',
      occurrence: 0,
      startedAt: '2025-01-06T08:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 9 }] }],
    }));
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-tie-z',
      occurrence: 2,
      startedAt: '2025-01-06T08:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 11 }] }],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('session-hist-tie-z');
    expect(repsOf(result[0]?.sets[0])).toBe(11);
  });

  it('resolves a repeated exercise within one session to the later exercise order', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-repeat',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 9 }] },
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 12 }] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.exerciseOrder).toBe(2);
    expect(repsOf(result[0]?.sets[0])).toBe(12);
  });

  it('falls back to an older real performance when the newest session skipped the exercise', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-skip-old',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
    }));
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-skip-new',
      occurrence: 2,
      startedAt: '2025-02-03T10:00:00Z',
      completedAt: '2025-02-03T11:00:00Z',
      logs: [
        // ex-002 skipped; ex-005 has a set so the session completes legally.
        { exerciseId: 'ex-002', type: 'reps', sets: [] },
        { exerciseId: 'ex-005', type: 'reps', sets: [{ reps: 10 }] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('session-hist-skip-old');
    expect(result[0]?.sets[0]?.weightKg).toBe(40);
  });


  it('returns an empty result when the only history for an exercise is a skipped log', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-skip-only',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-005')],
    );
    expect(result).toEqual([]);
  });


  it('returns the performed exercise but not the skipped one from the same completed session', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-skip-mixed',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002'), exerciseId('ex-005')],
    );
    expect(result.map((p) => p.exerciseId)).toEqual(['ex-002']);
    expect(result[0]?.sessionId).toBe('session-hist-skip-mixed');
  });


  it('keeps the performed occurrence when a repeated exercise is skipped later in the same session', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-skip-repeat-tail',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8 }] },
        { exerciseId: 'ex-002', type: 'reps', sets: [] },
        { exerciseId: 'ex-005', type: 'reps', sets: [{ reps: 10 }] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.exerciseOrder).toBe(1);
    expect(repsOf(result[0]?.sets[0])).toBe(8);
  });

  it('resolves to the performed occurrence when an earlier repeat of the exercise was skipped', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-skip-repeat-head',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [] },
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 12 }] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.exerciseOrder).toBe(2);
    expect(repsOf(result[0]?.sets[0])).toBe(12);
  });


  it('falls back per exercise in a batch when the newest session skipped one of them', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-skip-batch-old',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [{ reps: 10 }] },
      ],
    }));
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-skip-batch-new',
      occurrence: 2,
      startedAt: '2025-02-03T10:00:00Z',
      completedAt: '2025-02-03T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 50 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [] },
        { exerciseId: 'ex-009', type: 'reps', sets: [{ reps: 12 }] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-005'), exerciseId('ex-009'), exerciseId('ex-002')],
    );
    expect(result.map((p) => p.exerciseId)).toEqual(['ex-002', 'ex-005', 'ex-009']);

    const squat = result.find((p) => p.exerciseId === 'ex-002');
    expect(squat?.sessionId).toBe('session-hist-skip-batch-new');
    expect(squat?.sets[0]?.weightKg).toBe(50);

    const press = result.find((p) => p.exerciseId === 'ex-005');
    expect(press?.sessionId).toBe('session-hist-skip-batch-old');
    expect(repsOf(press?.sets[0])).toBe(10);

    const row = result.find((p) => p.exerciseId === 'ex-009');
    expect(row?.sessionId).toBe('session-hist-skip-batch-new');
    expect(repsOf(row?.sets[0])).toBe(12);
  });


  it('scopes to the owning user, not to the enrollment', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-ua',
      userId: 'user-test-a',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8 }] }],
    }));
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-ub',
      userId: 'user-test-b',
      occurrence: 1,
      startedAt: '2025-02-10T10:00:00Z',
      completedAt: '2025-02-10T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 12 }] }],
    }));

    const forA = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(forA).toHaveLength(1);
    expect(forA[0]?.sessionId).toBe('session-hist-ua');

    const forB = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-b'),
      [exerciseId('ex-002')],
    );
    expect(forB).toHaveLength(1);
    expect(forB[0]?.sessionId).toBe('session-hist-ub');
  });

  it('includes detached (left-program) sessions as history', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-enrolled',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8 }] }],
    }));
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-detached',
      enrollmentId: null,
      occurrence: 2,
      startedAt: '2025-02-03T10:00:00Z',
      completedAt: '2025-02-03T11:00:00Z',
      logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] }],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002')],
    );
    expect(result).toHaveLength(1);
    expect(result[0]?.sessionId).toBe('session-hist-detached');
  });

  it('projects the prescription snapshot and ordered sets of the winning log, ignoring other exercises in the same sessions', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-proj',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 40, rpe: 7 }, { reps: 10, weightKg: 45, rpe: 8 }] },
        { exerciseId: 'ex-015', type: 'duration', sets: [{ durationSeconds: 30 }] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-002'), exerciseId('ex-015')],
    );
    expect(result).toHaveLength(2);

    const squat = result.find((p) => p.exerciseId === 'ex-002');
    expect(squat?.exerciseOrder).toBe(1);
    expect(squat?.prescription).toEqual({ type: 'reps', sets: 3, minReps: 8, maxReps: 10 });
    expect(squat?.sets.map((s) => (s.type === 'reps' ? s.reps : null))).toEqual([8, 10]);

    const hold = result.find((p) => p.exerciseId === 'ex-015');
    expect(hold?.exerciseOrder).toBe(2);
    expect(hold?.prescription).toEqual({ type: 'duration', sets: 3, seconds: 30 });
    expect(hold?.sets[0]).toMatchObject({ type: 'duration', durationSeconds: 30 });
  });

  it('orders the result by exercise id ascending', async () => {
    await workoutSessionRepository.save(historySession({
      id: 'session-hist-order',
      occurrence: 0,
      startedAt: '2025-01-06T10:00:00Z',
      completedAt: '2025-01-06T11:00:00Z',
      logs: [
        { exerciseId: 'ex-009', type: 'reps', sets: [{ reps: 8 }] },
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10 }] },
        { exerciseId: 'ex-005', type: 'reps', sets: [{ reps: 12 }] },
      ],
    }));

    const result = await workoutSessionRepository.listLatestCompletedExercisePerformances(
      userId('user-test-a'),
      [exerciseId('ex-009'), exerciseId('ex-002'), exerciseId('ex-005')],
    );
    expect(result.map((p) => p.exerciseId)).toEqual(['ex-002', 'ex-005', 'ex-009']);
  });
});

afterAll(async () => {
  await closeDatabase();
});

