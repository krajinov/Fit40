import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
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
import { ListTrainingHistoryUseCase } from '@/application/use-cases/list-training-history';
import { GetTrainingTotalsUseCase } from '@/application/use-cases/get-training-totals';
import { GetCompletedSessionUseCase } from '@/application/use-cases/get-completed-session';
import {
  EXERCISE_HISTORY_OCCURRENCE_LIMIT,
  GetExerciseHistoryUseCase,
} from '@/application/use-cases/get-exercise-history';
import type { CompletedSessionDto } from '@/application/dto/completed-session';
import { users } from '@/infrastructure/database/schema';

import {
  closeDatabase,
  db,
  exerciseRepository,
  programEnrollmentRepository,
  resetAndSeed,
  trainingHistoryRepository,
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

/** Valid (scheduled_workout_id, workout_id) pairs from the seeded programs. */
const OCCURRENCES = [
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'strong-at-home-w1-1', workoutId: 'wo-home-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-3', workoutId: 'wo-beginner-strength-c' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w3-1', workoutId: 'wo-beginner-strength-a' },
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
 * orders are assigned sequentially from 1 in the order the logs are given;
 * set numbers follow the domain rule (1-based, sequential per exercise).
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
    userId: userId(spec.userId ?? 'user-hist-a'),
    enrollmentId:
      spec.enrollmentId === undefined
        ? enrollmentId('enrollment-hist-a')
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
      const base =
        log.type === 'reps'
          ? { type: 'reps' as const, reps: set.reps ?? 10 }
          : { type: 'duration' as const, durationSeconds: set.durationSeconds ?? 30 };
      const logged = logSessionSet(session, {
        exerciseOrder: index + 1,
        ...base,
        weightKg: set.weightKg ?? null,
        rpe: set.rpe ?? null,
      });
      if (!logged.ok) throw new Error(logged.error.message);
      session = logged.data;
    }
  }
  if (spec.completedAt !== undefined) {
    const completed = completeWorkoutSession(session, new Date(spec.completedAt));
    if (!completed.ok) throw new Error(completed.error.message);
    session = completed.data;
  }
  return session;
}
// ─── tests ────────────────────────────────────────────────────────────────────

const OWNER_A = 'user-hist-a';
const OWNER_B = 'user-hist-b';

const listUseCase = new ListTrainingHistoryUseCase(trainingHistoryRepository);
const totalsUseCase = new GetTrainingTotalsUseCase(trainingHistoryRepository);
const detailUseCase = new GetCompletedSessionUseCase(
  trainingHistoryRepository,
  exerciseRepository,
);
const exerciseHistoryUseCase = new GetExerciseHistoryUseCase(
  trainingHistoryRepository,
  exerciseRepository,
);

beforeEach(async () => {
  await resetAndSeed();
  await seedUser(OWNER_A);
  await seedUser(OWNER_B);
  await seedEnrollment('enrollment-hist-a', OWNER_A, 'prog-beginner-strength');
});

async function saveAll(...sessions: WorkoutSession[]): Promise<void> {
  for (const session of sessions) {
    await workoutSessionRepositorySave(session);
  }
}

/** Saving via the write port exercises the real write path. */
async function workoutSessionRepositorySave(session: WorkoutSession): Promise<void> {
  const { workoutSessionRepository } = await import('./setup');
  await workoutSessionRepository.save(session);
}

describe('training history — listing', () => {
  it('returns an empty first page for a user with no completed history', async () => {
    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions).toEqual([]);
    expect(result.data.nextCursor).toBeNull();
  });

  it('returns only completed sessions, newest first', async () => {
    await saveAll(
      historySession({
        id: 'session-hist-old',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
      historySession({
        id: 'session-hist-new',
        occurrence: 1,
        startedAt: '2025-02-03T10:00:00Z',
        completedAt: '2025-02-03T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 22.5 }] }],
      }),
      historySession({
        id: 'session-hist-inprogress',
        occurrence: 2,
        startedAt: '2025-03-03T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 9 }] }],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.sessionId)).toEqual([
      'session-hist-new',
      'session-hist-old',
    ]);
  });

  it('breaks identical completedAt ties via startedAt, then session id', async () => {
    await saveAll(
      historySession({
        id: 'session-tie-started-early',
        startedAt: '2025-01-06T09:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
      historySession({
        id: 'session-tie-started-late',
        occurrence: 1,
        startedAt: '2025-01-06T09:30:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same completedAt: later start is more recent history.
    expect(result.data.sessions.map((s) => s.sessionId)).toEqual([
      'session-tie-started-late',
      'session-tie-started-early',
    ]);
  });

  it('breaks identical (completedAt, startedAt) ties via descending session id', async () => {
    await saveAll(
      historySession({
        id: 'session-tie-id-a',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
      historySession({
        id: 'session-tie-id-b',
        occurrence: 1,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
      historySession({
        id: 'session-tie-id-c',
        occurrence: 2,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.sessionId)).toEqual([
      'session-tie-id-c',
      'session-tie-id-b',
      'session-tie-id-a',
    ]);
  });

  it('resolves program and workout display names via joins', async () => {
    await saveAll(
      historySession({
        id: 'session-hist-names',
        occurrence: 3,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions[0]?.programName).toBe('Strong at Home');
    expect(result.data.sessions[0]?.workoutName).toBe('Home Full Body A');
  });
});
describe('training history — pagination integrity', () => {
  /**
   * 7 completed sessions with intentional ties so the page walk must cross
   * every kind of keyset boundary, each on a distinct occurrence (one session
   * per enrollment per occurrence). 0-2 share completedAt (startedAt and id
   * decide), 3-4 share completedAt and startedAt (id decides), 5-6 are fully
   * distinct. Expected ladder: within the 03-01 tie, page-2 then page-1 (same
   * startedAt, id desc) then page-0 (older start); within the 02-01 tie,
   * page-4 then page-3 (id desc); then 5, 6 by completedAt.
   */
  function seedTieSessions(): Promise<void> {
    const logs = [{ exerciseId: 'ex-001', type: 'reps' as const, sets: [{ reps: 8 }] }];
    return saveAll(
      historySession({
        id: 'session-page-0',
        occurrence: 0,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-03-01T11:00:00Z',
        logs,
      }),
      historySession({
        id: 'session-page-1',
        occurrence: 1,
        startedAt: '2025-01-13T10:00:00Z',
        completedAt: '2025-03-01T11:00:00Z',
        logs,
      }),
      historySession({
        id: 'session-page-2',
        occurrence: 2,
        startedAt: '2025-01-13T10:00:00Z',
        completedAt: '2025-03-01T11:00:00Z',
        logs,
      }),
      historySession({
        id: 'session-page-3',
        occurrence: 3,
        startedAt: '2025-02-06T10:00:00Z',
        completedAt: '2025-02-01T11:00:00Z',
        logs,
      }),
      historySession({
        id: 'session-page-4',
        occurrence: 4,
        startedAt: '2025-02-06T10:00:00Z',
        completedAt: '2025-02-01T11:00:00Z',
        logs,
      }),
      historySession({
        id: 'session-page-5',
        occurrence: 5,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-01T11:00:00Z',
        logs,
      }),
      historySession({
        id: 'session-page-6',
        occurrence: 6,
        startedAt: '2025-01-05T10:00:00Z',
        completedAt: '2025-01-01T10:30:00Z',
        logs,
      }),
    );
  }

  it('walks every page without duplicates or gaps, exactly exhausting the history', async () => {
    await seedTieSessions();

    const walked: string[] = [];
    let cursor: string | null = null;
    for (let page = 0; page < 10; page++) {
      const result = await listUseCase.execute({ userId: OWNER_A, limit: 3, cursor });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      walked.push(...result.data.sessions.map((s) => s.sessionId));
      if (result.data.nextCursor === null) break;
      cursor = result.data.nextCursor;
    }

    expect(walked).toHaveLength(7);
    expect(new Set(walked).size).toBe(7);
    // The deterministic ladder: the completedAt tie resolves by startedAt
    // then id (both descending); the second tie by id; then distinct dates.
    expect(walked).toEqual([
      'session-page-2',
      'session-page-1',
      'session-page-0',
      'session-page-4',
      'session-page-3',
      'session-page-5',
      'session-page-6',
    ]);
  });

  it('never emits a phantom trailing empty page (exact-limit last page ends the walk)', async () => {
    await saveAll(
      historySession({
        id: 'session-boundary-1',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
      historySession({
        id: 'session-boundary-2',
        occurrence: 1,
        startedAt: '2025-01-13T10:00:00Z',
        completedAt: '2025-01-13T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    const first = await listUseCase.execute({ userId: OWNER_A, limit: 1 });
    expect(first.ok).toBe(true);
    if (!first.ok) return;
    // boundary-2 completed later, so it is the newest history entry.
    expect(first.data.sessions.map((s) => s.sessionId)).toEqual(['session-boundary-2']);
    expect(first.data.nextCursor).not.toBeNull();

    const second = await listUseCase.execute({
      userId: OWNER_A,
      limit: 1,
      cursor: first.data.nextCursor,
    });
    expect(second.ok).toBe(true);
    if (!second.ok) return;
    expect(second.data.sessions.map((s) => s.sessionId)).toEqual(['session-boundary-1']);
    // The exact-limit last page carries no cursor: there is no next page.
    expect(second.data.nextCursor).toBeNull();
  });
});
describe('training history — isolation and detachment', () => {
  it('never returns another user\'s sessions', async () => {
    await saveAll(
      historySession({
        id: 'session-iso-a',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );
    await saveAll(
      historySession({
        id: 'session-iso-b',
        userId: OWNER_B,
        enrollmentId: null,
        occurrence: 1,
        startedAt: '2025-02-06T10:00:00Z',
        completedAt: '2025-02-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 9 }] }],
      }),
    );

    const forA = await listUseCase.execute({ userId: OWNER_A });
    expect(forA.ok).toBe(true);
    if (!forA.ok) return;
    expect(forA.data.sessions.map((s) => s.sessionId)).toEqual(['session-iso-a']);

    const forB = await listUseCase.execute({ userId: OWNER_B });
    expect(forB.ok).toBe(true);
    if (!forB.ok) return;
    expect(forB.data.sessions.map((s) => s.sessionId)).toEqual(['session-iso-b']);
  });

  it('keeps detached (left-program) sessions visible as history', async () => {
    await saveAll(
      historySession({
        id: 'session-detached',
        enrollmentId: null,
        occurrence: 3,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessions.map((s) => s.sessionId)).toEqual(['session-detached']);
    expect(result.data.sessions[0]?.programName).toBe('Strong at Home');
  });

  it('keeps history visible after leave and re-enroll', async () => {
    await seedEnrollment('enrollment-hist-leave', OWNER_A, 'prog-strong-at-home');
    await saveAll(
      historySession({
        id: 'session-reenroll',
        enrollmentId: 'enrollment-hist-leave',
        occurrence: 3,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    // Leave: the enrollment delete detaches the session (enrollment_id SET NULL).
    await programEnrollmentRepository.delete(enrollmentId('enrollment-hist-leave'));

    const afterLeave = await listUseCase.execute({ userId: OWNER_A });
    expect(afterLeave.ok).toBe(true);
    if (!afterLeave.ok) return;
    expect(afterLeave.data.sessions.map((s) => s.sessionId)).toEqual(['session-reenroll']);

    // Re-enroll with a fresh identity: the history is unchanged.
    await seedEnrollment('enrollment-hist-rejoin', OWNER_A, 'prog-strong-at-home');
    const afterRejoin = await listUseCase.execute({ userId: OWNER_A });
    expect(afterRejoin.ok).toBe(true);
    if (!afterRejoin.ok) return;
    expect(afterRejoin.data.sessions.map((s) => s.sessionId)).toEqual(['session-reenroll']);
  });
});
describe('training history — hydration and metrics mapping', () => {
  it('hydrates metrics from the domain service for mixed sets', async () => {
    await saveAll(
      historySession({
        id: 'session-metrics',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            exerciseId: 'ex-002',
            type: 'reps',
            sets: [{ reps: 10, weightKg: 40 }, { reps: 8, weightKg: 45 }],
          },
          { exerciseId: 'ex-015', type: 'duration', sets: [{ durationSeconds: 30 }] },
        ],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = result.data.sessions[0];
    expect(dto?.metrics).toEqual({
      totalSets: 3,
      totalReps: 18,
      totalDurationSeconds: 30,
      volume: 10 * 40 + 8 * 45,
    });
    expect(dto?.exerciseLogs.map((log) => log.order)).toEqual([1, 2]);
    const first = dto?.exerciseLogs[0];
    expect(first?.sets.map((s) => (s.type === 'reps' ? s.reps : null))).toEqual([10, 8]);
  });

  it('preserves nullable RPE and bodyweight (null weight) sets', async () => {
    await saveAll(
      historySession({
        id: 'session-nullable',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: null, rpe: null }] },
        ],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const set = result.data.sessions[0]?.exerciseLogs[0]?.sets[0];
    if (set === undefined || set.type !== 'reps') throw new Error('expected a reps set');
    expect(set.weightKg).toBeNull();
    expect(set.rpe).toBeNull();
    // Bodyweight set: no weight, no volume contribution.
    expect(result.data.sessions[0]?.metrics.volume).toBe(0);
  });

  it('hydrates duration sets distinctly from reps sets', async () => {
    await saveAll(
      historySession({
        id: 'session-duration',
        occurrence: 1,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-015', type: 'duration', sets: [{ durationSeconds: 45, rpe: 6 }] }],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const set = result.data.sessions[0]?.exerciseLogs[0]?.sets[0];
    if (set === undefined || set.type !== 'duration') throw new Error('expected a duration set');
    expect(set.durationSeconds).toBe(45);
    expect(set.rpe).toBe(6);
    expect(result.data.sessions[0]?.metrics.totalDurationSeconds).toBe(45);
    expect(result.data.sessions[0]?.metrics.totalSets).toBe(1);
  });

  it('presents duplicate occurrences of one exercise as distinct entries', async () => {
    await saveAll(
      historySession({
        id: 'session-duplicate-ex',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 40 }] },
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 12, weightKg: 42 }] },
        ],
      }),
    );

    const result = await listUseCase.execute({ userId: OWNER_A });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const logs = result.data.sessions[0]?.exerciseLogs;
    expect(logs).toHaveLength(2);
    expect(logs?.map((log) => log.exerciseId)).toEqual(['ex-002', 'ex-002']);
    expect(logs?.map((log) => log.order)).toEqual([1, 2]);
    expect(result.data.sessions[0]?.metrics.totalSets).toBe(2);
    expect(result.data.sessions[0]?.metrics.volume).toBe(10 * 40 + 12 * 42);
  });
});
describe('training history — completed-session detail', () => {
  it('resolves the full display context for one owned completed session', async () => {
    await saveAll(
      historySession({
        id: 'session-detail-1',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 50, rpe: 7 }] },
          { exerciseId: 'ex-015', type: 'duration', sets: [{ durationSeconds: 45 }] },
        ],
      }),
    );

    const result = await detailUseCase.execute({ userId: OWNER_A, sessionId: 'session-detail-1' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto: CompletedSessionDto = result.data;
    expect(dto.sessionId).toBe('session-detail-1');
    expect(dto.programName.length).toBeGreaterThan(0);
    expect(dto.workoutName.length).toBeGreaterThan(0);
    expect(dto.completedAt).toBe('2025-01-06T11:00:00.000Z');
    // Snapshot prescriptions persist independently of catalog state.
    expect(dto.entries[0]?.prescription).toEqual({ type: 'reps', sets: 3, minReps: 8, maxReps: 10 });
    expect(dto.entries[0]?.exerciseName).not.toBeNull();
    expect(dto.entries[0]?.sets[0]?.rpe).toBe(7);
    expect(dto.entries[1]?.prescription).toEqual({ type: 'duration', sets: 3, seconds: 30 });
    const durationSet = dto.entries[1]?.sets[0];
    if (durationSet === undefined || durationSet.type !== 'duration') {
      throw new Error('expected a duration set');
    }
    expect(durationSet.durationSeconds).toBe(45);
    expect(dto.metrics.totalSets).toBe(2);
  });

  it('returns SESSION_NOT_FOUND for a foreign or in-progress session', async () => {
    await saveAll(
      historySession({
        id: 'session-detail-foreign',
        userId: OWNER_B,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 50 }] }],
      }),
      historySession({
        id: 'session-detail-progress',
        occurrence: 1,
        startedAt: '2025-01-07T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 9 }] }],
      }),
    );

    const foreign = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-detail-foreign',
    });
    expect(foreign.ok).toBe(false);
    if (!foreign.ok) expect(foreign.error.code).toBe('SESSION_NOT_FOUND');

    // The owner cannot open their own still-in-progress session here either.
    const inProgress = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-detail-progress',
    });
    expect(inProgress.ok).toBe(false);
    if (!inProgress.ok) expect(inProgress.error.code).toBe('SESSION_NOT_FOUND');
  });

  it('returns SESSION_NOT_FOUND for a missing or malformed session id', async () => {
    const missing = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-detail-nope',
    });
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error.code).toBe('SESSION_NOT_FOUND');

    const malformed = await detailUseCase.execute({ userId: OWNER_A, sessionId: '' });
    expect(malformed.ok).toBe(false);
    if (!malformed.ok) expect(malformed.error.code).toBe('INVALID_INPUT');
  });

  it('orders entries by exercise order and sets by set number', async () => {
    await saveAll(
      historySession({
        id: 'session-detail-order',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            exerciseId: 'ex-001',
            type: 'reps',
            sets: [{ reps: 8, weightKg: 40 }, { reps: 10, weightKg: 42 }, { reps: 12, weightKg: 44 }],
          },
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 50 }] },
        ],
      }),
    );

    const result = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-detail-order',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries.map((entry) => entry.exerciseOrder)).toEqual([1, 2]);
    expect(result.data.entries[0]?.sets.map((set) => set.setNumber)).toEqual([1, 2, 3]);
  });

  it('renders duplicate occurrences of one exercise as distinct entries', async () => {
    await saveAll(
      historySession({
        id: 'session-detail-dup',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 40 }] },
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 12, weightKg: 42 }] },
        ],
      }),
    );

    const result = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-detail-dup',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toHaveLength(2);
    expect(result.data.entries[0]?.exerciseOrder).toBe(1);
    expect(result.data.entries[1]?.exerciseOrder).toBe(2);
    expect(result.data.entries[0]?.exerciseId).toBe('ex-002');
    expect(result.data.entries[1]?.exerciseId).toBe('ex-002');
  });

  it('preserves a logged 0 kg as distinct from no external load', async () => {
    await saveAll(
      historySession({
        id: 'session-detail-zero',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            exerciseId: 'ex-001',
            type: 'reps',
            sets: [{ reps: 10, weightKg: 0 }, { reps: 10, weightKg: null }],
          },
        ],
      }),
    );

    const result = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-detail-zero',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.sets[0]?.weightKg).toBe(0);
    expect(result.data.entries[0]?.sets[1]?.weightKg).toBeNull();
  });

  it('keeps detached sessions addressable by their owner', async () => {
    await saveAll(
      historySession({
        id: 'session-detail-detached',
        enrollmentId: null,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    const result = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-detail-detached',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.sessionId).toBe('session-detail-detached');
  });
});

describe('training history — totals', () => {
  it('returns zeros for a user with no history', async () => {
    const result = await totalsUseCase.execute(OWNER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ completedSessions: 0, loggedSets: 0 });
  });

  it('counts completed sessions and their logged sets, ignoring in-progress sessions', async () => {
    await saveAll(
      historySession({
        id: 'session-totals-1',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8 }, { reps: 8 }] },
          { exerciseId: 'ex-015', type: 'duration', sets: [{ durationSeconds: 30 }] },
        ],
      }),
      historySession({
        id: 'session-totals-2',
        occurrence: 3,
        startedAt: '2025-01-13T10:00:00Z',
        completedAt: '2025-01-13T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10 }] }],
      }),
      // In-progress sessions must not count.
      historySession({
        id: 'session-totals-progress',
        occurrence: 1,
        startedAt: '2025-02-13T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10 }] }],
      }),
    );

    const result = await totalsUseCase.execute(OWNER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ completedSessions: 2, loggedSets: 4 });
  });

  it('keeps detached sessions in totals', async () => {
    await saveAll(
      historySession({
        id: 'session-totals-detached',
        enrollmentId: null,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    const result = await totalsUseCase.execute(OWNER_A);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ completedSessions: 1, loggedSets: 1 });
  });
});

describe('training history — per-exercise occurrences', () => {
  it('returns an empty history for a seeded exercise never performed', async () => {
    const result = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'push-up',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toEqual([]);
    expect(result.data.trend).toEqual([]);
    expect(result.data.exercise.slug).toBe('push-up');
  });

  it('returns EXERCISE_NOT_FOUND for an unknown slug', async () => {
    const result = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'not-a-real-exercise',
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
  });

  it('returns only completed occurrences with at least one set, newest first', async () => {
    await saveAll(
      historySession({
        id: 'session-occ-new',
        startedAt: '2025-02-03T10:00:00Z',
        completedAt: '2025-02-03T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 22.5 }] }],
      }),
      // Skipped exercise in an otherwise completed session (the target
      // exercise has zero set logs) — not an occurrence.
      historySession({
        id: 'session-occ-skipped',
        occurrence: 1,
        startedAt: '2025-01-20T10:00:00Z',
        completedAt: '2025-01-20T11:00:00Z',
        logs: [
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] },
          { exerciseId: 'ex-002', type: 'reps', sets: [] },
        ],
      }),
      // In-progress session — never part of history.
      historySession({
        id: 'session-occ-progress',
        occurrence: 2,
        startedAt: '2025-03-01T10:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 20 }] }],
      }),
      historySession({
        id: 'session-occ-old',
        occurrence: 3,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
    );

    const result = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'goblet-squat',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries.map((entry) => entry.sessionId)).toEqual([
      'session-occ-new',
      'session-occ-old',
    ]);
    expect(result.data.entries[0]?.workingLoadKg).toBe(22.5);
    expect(result.data.entries[1]?.workingLoadKg).toBe(20);
    // Trend is chronological (oldest first) over the loaded occurrences.
    expect(result.data.trend).toEqual([
      { completedAt: '2025-01-06T11:00:00.000Z', workingLoadKg: 20 },
      { completedAt: '2025-02-03T11:00:00.000Z', workingLoadKg: 22.5 },
    ]);
  });

  it("never returns another user's occurrences", async () => {
    await saveAll(
      historySession({
        id: 'session-occ-a',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
      historySession({
        id: 'session-occ-b',
        userId: OWNER_B,
        enrollmentId: null,
        occurrence: 1,
        startedAt: '2025-02-06T10:00:00Z',
        completedAt: '2025-02-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 9 }] }],
      }),
    );

    const forA = await exerciseHistoryUseCase.execute({ userId: OWNER_A, slug: 'bodyweight-squat' });
    expect(forA.ok).toBe(true);
    if (!forA.ok) return;
    expect(forA.data.entries.map((entry) => entry.sessionId)).toEqual(['session-occ-a']);

    const forB = await exerciseHistoryUseCase.execute({ userId: OWNER_B, slug: 'bodyweight-squat' });
    expect(forB.ok).toBe(true);
    if (!forB.ok) return;
    expect(forB.data.entries.map((entry) => entry.sessionId)).toEqual(['session-occ-b']);
  });

  it('keeps detached occurrences visible with their display names', async () => {
    await saveAll(
      historySession({
        id: 'session-occ-detached',
        enrollmentId: null,
        occurrence: 3,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
      }),
    );

    const result = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'bodyweight-squat',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toHaveLength(1);
    expect(result.data.entries[0]?.programName).toBe('Strong at Home');
    expect(result.data.entries[0]?.workoutName).toBe('Home Full Body A');
  });

  it('keeps two occurrences in one session as two entries ordered by position', async () => {
    await saveAll(
      historySession({
        id: 'session-occ-dup',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] },
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 16 }] },
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12 }] },
        ],
      }),
    );

    const result = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'bodyweight-squat',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Same session, orders 1 and 3: two distinct occurrences, never collapsed.
    expect(result.data.entries.map((entry) => [entry.sessionId, entry.exerciseOrder])).toEqual([
      ['session-occ-dup', 3],
      ['session-occ-dup', 1],
    ]);
  });

  it('marks bodyweight and duration occurrences unloaded and excludes them from the trend', async () => {
    await saveAll(
      historySession({
        id: 'session-occ-bw',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: null }] },
        ],
      }),
      historySession({
        id: 'session-occ-duration',
        occurrence: 1,
        startedAt: '2025-01-13T10:00:00Z',
        completedAt: '2025-01-13T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'duration', sets: [{ durationSeconds: 30 }] }],
      }),
    );

    const result = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'goblet-squat',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toHaveLength(2);
    expect(result.data.entries.every((entry) => entry.workingLoadKg === null)).toBe(true);
    expect(result.data.trend).toEqual([]);
  });

  it('preserves a logged 0 kg as a real external load in entries and trend', async () => {
    await saveAll(
      historySession({
        id: 'session-occ-zero',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 0 }] }],
      }),
    );

    const result = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'goblet-squat',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries[0]?.workingLoadKg).toBe(0);
    expect(result.data.trend).toEqual([
      { completedAt: '2025-01-06T11:00:00.000Z', workingLoadKg: 0 },
    ]);
  });

  it('bounds the read to the fixed occurrence limit', async () => {
    // More distinct (session, occurrence) pairs than the limit. All are
    // detached (NULL enrollment): detached sessions never collide on the
    // (enrollment, scheduled workout) uniqueness rule, so every row saves.
    const sessions: WorkoutSession[] = [];
    for (let i = 0; i < EXERCISE_HISTORY_OCCURRENCE_LIMIT + 5; i++) {
      sessions.push(
        historySession({
          id: `session-occ-limit-${i}`,
          enrollmentId: null,
          startedAt: new Date(Date.parse('2025-01-06T10:00:00Z') + i * 86_400_000).toISOString(),
          completedAt: new Date(Date.parse('2025-01-06T11:00:00Z') + i * 86_400_000).toISOString(),
          logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] }],
        }),
      );
    }
    await saveAll(...sessions);

    const result = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'bodyweight-squat',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.entries).toHaveLength(EXERCISE_HISTORY_OCCURRENCE_LIMIT);
  });
});

afterAll(async () => {
  await closeDatabase();
});







