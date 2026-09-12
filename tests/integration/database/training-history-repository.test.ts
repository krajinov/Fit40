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
  createWorkoutSessionId,
} from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';
import {
  moveSessionExercise,
  skipSessionExercise,
} from '@/domain/services/session-exercise-adjustment';
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
function workoutSessionId(value: string) {
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
  /**
   * The performed exercise when the occurrence was substituted; omit for
   * performed-as-authored. `exerciseId` remains the AUTHORED id.
   */
  readonly performedExerciseId?: string;
  /** Marks the occurrence explicitly skipped (M10) — never inferred. */
  readonly isSkipped?: boolean;
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
      authoredExerciseId: exerciseId(log.exerciseId),
      performedExerciseId: exerciseId(
        log.performedExerciseId ?? log.exerciseId,
      ),
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
    if (log.isSkipped === true) {
      const skipped = skipSessionExercise(session, { exerciseOrder: index + 1 });
      if (!skipped.ok) throw new Error(skipped.error.message);
      session = skipped.data;
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
    expect(logs?.map((log) => log.performedExerciseId)).toEqual(['ex-002', 'ex-002']);
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
    expect(result.data.entries[0]?.performedExerciseId).toBe('ex-002');
    expect(result.data.entries[1]?.performedExerciseId).toBe('ex-002');
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
    // Trend is chronological (oldest first) over the loaded occurrences,
    // each point carrying its (sessionId, exerciseOrder) identity.
    expect(result.data.trend).toEqual([
      {
        sessionId: 'session-occ-old',
        exerciseOrder: 1,
        completedAt: '2025-01-06T11:00:00.000Z',
        workingLoadKg: 20,
      },
      {
        sessionId: 'session-occ-new',
        exerciseOrder: 1,
        completedAt: '2025-02-03T11:00:00.000Z',
        workingLoadKg: 22.5,
      },
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
      {
        sessionId: 'session-occ-zero',
        exerciseOrder: 1,
        completedAt: '2025-01-06T11:00:00.000Z',
        workingLoadKg: 0,
      },
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

  // ─── Substitution truthfulness (M9) ─────────────────────────────────────
  // A substituted occurrence belongs to the PERFORMED exercise's history —
  // never to the authored template exercise's history.

  it('keeps a substituted occurrence in the PERFORMED exercise history only', async () => {
    // Authored Goblet Squat (ex-002), performed Dumbbell Bench Press
    // (ex-008): the completed occurrence belongs to ex-008's history and
    // must not appear under ex-002 merely because it authored the template.
    await saveAll(
      historySession({
        id: 'session-occ-subst',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            exerciseId: 'ex-002',
            performedExerciseId: 'ex-008',
            type: 'reps',
            sets: [{ reps: 10, weightKg: 30 }],
          },
        ],
      }),
      // A plain authored-and-performed ex-002 occurrence: the control that
      // ex-002's history still contains its own real work.
      historySession({
        id: 'session-occ-subst-control',
        occurrence: 1,
        startedAt: '2025-02-06T10:00:00Z',
        completedAt: '2025-02-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 16 }] }],
      }),
    );

    const performed = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'dumbbell-bench-press',
    });
    expect(performed.ok).toBe(true);
    if (!performed.ok) return;
    // Exactly ONE occurrence — no double-counting from the authored identity.
    expect(performed.data.entries.map((entry) => [entry.sessionId, entry.exerciseOrder])).toEqual([
      ['session-occ-subst', 1],
    ]);
    expect(performed.data.entries[0]?.workingLoadKg).toBe(30);

    const authored = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'goblet-squat',
    });
    expect(authored.ok).toBe(true);
    if (!authored.ok) return;
    // The substituted occurrence is NOT in the authored exercise history;
    // only the control session's own work is.
    expect(authored.data.entries.map((entry) => entry.sessionId)).toEqual([
      'session-occ-subst-control',
    ]);
  });

  it('keeps a detached substituted occurrence in the PERFORMED exercise history', async () => {
    // Detached (left-program) history stays the user's training past, and
    // substitution truthfulness is unaffected by detachment: the occurrence
    // remains under the performed exercise.
    await saveAll(
      historySession({
        id: 'session-occ-subst-detached',
        enrollmentId: null,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            exerciseId: 'ex-002',
            performedExerciseId: 'ex-008',
            type: 'reps',
            sets: [{ reps: 10, weightKg: 28 }],
          },
        ],
      }),
    );

    const performed = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'dumbbell-bench-press',
    });
    expect(performed.ok).toBe(true);
    if (!performed.ok) return;
    expect(performed.data.entries.map((entry) => entry.sessionId)).toEqual([
      'session-occ-subst-detached',
    ]);
    expect(performed.data.entries[0]?.programName).toBe('Fit40 Beginner Strength');
    expect(performed.data.entries[0]?.workoutName).toBe('Full Body A');

    const authored = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'goblet-squat',
    });
    expect(authored.ok).toBe(true);
    if (!authored.ok) return;
    expect(authored.data.entries).toEqual([]);
  });

  it('keeps duplicate occurrence identity when one of two same-authored occurrences is substituted', async () => {
    // Two occurrences authored as ex-002; only the first is substituted to
    // ex-008. Identity is (sessionId, exerciseOrder): each occurrence keeps
    // its own performed identity, ex-002's history keeps exactly one entry,
    // and ex-008's gains exactly one — never a split or double-count.
    await saveAll(
      historySession({
        id: 'session-occ-subst-dup',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            exerciseId: 'ex-002',
            performedExerciseId: 'ex-008',
            type: 'reps',
            sets: [{ reps: 10, weightKg: 30 }],
          },
          { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 16 }] },
        ],
      }),
    );

    const performed = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'dumbbell-bench-press',
    });
    expect(performed.ok).toBe(true);
    if (!performed.ok) return;
    expect(performed.data.entries.map((entry) => [entry.sessionId, entry.exerciseOrder])).toEqual([
      ['session-occ-subst-dup', 1],
    ]);

    const authored = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'goblet-squat',
    });
    expect(authored.ok).toBe(true);
    if (!authored.ok) return;
    expect(authored.data.entries.map((entry) => [entry.sessionId, entry.exerciseOrder])).toEqual([
      ['session-occ-subst-dup', 2],
    ]);
  });
});

describe('training history — progression performance windows', () => {
  it('returns an empty result for an empty exercise id list', async () => {
    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [],
      5,
    );
    expect(performances).toEqual([]);
  });

  it('returns empty windows for exercises the user has never performed', async () => {
    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-001'), exerciseId('ex-002')],
      5,
    );
    expect(performances).toEqual([]);
  });

  it('returns completed performances only, grouped by exercise id ascending, newest first per exercise', async () => {
    await saveAll(
      historySession({
        id: 'session-perf-2-old',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
      historySession({
        id: 'session-perf-1-new',
        occurrence: 1,
        startedAt: '2025-02-03T10:00:00Z',
        completedAt: '2025-02-03T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 22.5 }] }],
      }),
      historySession({
        id: 'session-perf-2-new',
        occurrence: 2,
        startedAt: '2025-02-10T10:00:00Z',
        completedAt: '2025-02-10T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 22.5 }] }],
      }),
      // In-progress and newest — current-session logs never enter the window.
      historySession({
        id: 'session-perf-2-progress',
        occurrence: 3,
        startedAt: '2025-03-01T10:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 12 }] }],
      }),
    );

    // Requested out of order on purpose: grouping follows exercise id asc.
    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-002'), exerciseId('ex-001')],
      5,
    );

    expect(performances.map((p) => [p.exerciseId, p.sessionId])).toEqual([
      ['ex-001', 'session-perf-1-new'],
      ['ex-002', 'session-perf-2-new'],
      ['ex-002', 'session-perf-2-old'],
    ]);
  });

  it('never lets a skipped exercise (zero logged sets) shadow an older real performance', async () => {
    await saveAll(
      historySession({
        id: 'session-perf-skip-real',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
      // Newer completed session in which the target exercise was skipped.
      historySession({
        id: 'session-perf-skip-newer',
        occurrence: 1,
        startedAt: '2025-02-03T10:00:00Z',
        completedAt: '2025-02-03T11:00:00Z',
        logs: [
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] },
          { exerciseId: 'ex-002', type: 'reps', sets: [] },
        ],
      }),
    );

    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-002')],
      5,
    );
    // The skipped log never enters candidacy, so the older real performance
    // surfaces instead of being shadowed.
    expect(performances.map((p) => [p.sessionId, p.exerciseOrder])).toEqual([
      ['session-perf-skip-real', 1],
    ]);
  });

  it('scopes windows to sessions owned by the requesting user', async () => {
    await saveAll(
      historySession({
        id: 'session-perf-own-a',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
      // Foreign user performing the same exercise more recently: recency
      // never leaks across ownership. OWNER_B has no enrollment, so the
      // session is detached (NULL enrollment).
      historySession({
        id: 'session-perf-own-b',
        userId: OWNER_B,
        enrollmentId: null,
        startedAt: '2025-01-13T10:00:00Z',
        completedAt: '2025-01-13T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 22.5 }] }],
      }),
    );

    const forA = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-001'), exerciseId('ex-002')],
      5,
    );
    expect(forA.map((p) => [p.exerciseId, p.sessionId])).toEqual([['ex-001', 'session-perf-own-a']]);

    const forB = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_B),
      [exerciseId('ex-001'), exerciseId('ex-002')],
      5,
    );
    expect(forB.map((p) => [p.exerciseId, p.sessionId])).toEqual([['ex-001', 'session-perf-own-b']]);
  });

  it('treats duplicate same-exercise occurrences in one session as distinct window entries', async () => {
    await saveAll(
      // One session performing ex-001 twice (orders 1 and 2), newer than an
      // older single-occurrence session: with limit 2 the window fills with
      // the two in-session duplicates — occurrences, not sessions, are
      // counted, and neither duplicate is collapsed.
      historySession({
        id: 'session-perf-dup',
        occurrence: 1,
        startedAt: '2025-01-13T10:00:00Z',
        completedAt: '2025-01-13T11:00:00Z',
        logs: [
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] },
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 22.5 }] },
        ],
      }),
      historySession({
        id: 'session-perf-dup-old',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 18 }] }],
      }),
    );

    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-001')],
      2,
    );
    // Newest first; within one session the ladder resolves to the later
    // position (exercise order desc), and the older session's occurrence
    // falls outside the per-exercise bound.
    expect(performances.map((p) => [p.sessionId, p.exerciseOrder])).toEqual([
      ['session-perf-dup', 2],
      ['session-perf-dup', 1],
    ]);
  });

  it('breaks recency ties deterministically by startedAt, then session id', async () => {
    await saveAll(
      // Oldest completion: always last regardless of the ties below.
      historySession({
        id: 'session-perf-ladder-old',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
      // Same completion instant: the later START wins the newer rank.
      historySession({
        id: 'session-perf-ladder-start-late',
        occurrence: 1,
        startedAt: '2025-02-03T09:00:00Z',
        completedAt: '2025-02-03T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10 }] }],
      }),
      // Same completion AND start: the greater session id ranks newer.
      historySession({
        id: 'session-perf-ladder-tie-b',
        occurrence: 2,
        startedAt: '2025-02-03T08:00:00Z',
        completedAt: '2025-02-03T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 9 }] }],
      }),
      historySession({
        id: 'session-perf-ladder-tie-z',
        occurrence: 3,
        startedAt: '2025-02-03T08:00:00Z',
        completedAt: '2025-02-03T11:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 11 }] }],
      }),
    );

    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-001')],
      5,
    );

    expect(performances.map((p) => p.sessionId)).toEqual([
      'session-perf-ladder-start-late',
      'session-perf-ladder-tie-z',
      'session-perf-ladder-tie-b',
      'session-perf-ladder-old',
    ]);
  });

  it('bounds each exercise to its own limitPerExercise, never a global cap', async () => {
    // Five detached sessions performing BOTH exercises each: detached rows
    // never collide on the (enrollment, scheduled workout) uniqueness rule.
    const sessions: WorkoutSession[] = [];
    for (let i = 0; i < 5; i++) {
      sessions.push(
        historySession({
          id: `session-perf-limit-${i}`,
          enrollmentId: null,
          startedAt: new Date(Date.parse('2025-01-06T10:00:00Z') + i * 86_400_000).toISOString(),
          completedAt: new Date(Date.parse('2025-01-06T11:00:00Z') + i * 86_400_000).toISOString(),
          logs: [
            { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] },
            { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 16 }] },
          ],
        }),
      );
    }
    await saveAll(...sessions);

    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-002'), exerciseId('ex-001')],
      2,
    );

    // Two newest occurrences per exercise — four rows total, not two — so
    // the ceiling binds per exercise, never globally, and grouping still
    // follows exercise id ascending.
    expect(performances.map((p) => [p.exerciseId, p.sessionId])).toEqual([
      ['ex-001', 'session-perf-limit-4'],
      ['ex-001', 'session-perf-limit-3'],
      ['ex-002', 'session-perf-limit-4'],
      ['ex-002', 'session-perf-limit-3'],
    ]);
  });

  it('hydrates the full performance shape with explicit nulls for unlogged values', async () => {
    await saveAll(
      historySession({
        id: 'session-perf-full',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            exerciseId: 'ex-001',
            type: 'duration',
            sets: [
              { durationSeconds: 30, rpe: 6 },
              { durationSeconds: 45 },
            ],
          },
          {
            exerciseId: 'ex-002',
            type: 'reps',
            sets: [
              { reps: 10, weightKg: 20, rpe: 7 },
              { reps: 8, weightKg: 22.5, rpe: 8 },
              { reps: 12 },
            ],
          },
        ],
      }),
    );

    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-002'), exerciseId('ex-001')],
      5,
    );

    // Strict deep equality over the whole projection: every field, with
    // explicit nulls wherever load or RPE went unlogged — never undefined.
    expect(performances).toEqual([
      {
        exerciseId: exerciseId('ex-001'),
        sessionId: workoutSessionId('session-perf-full'),
        exerciseOrder: 1,
        completedAt: new Date('2025-01-06T11:00:00Z'),
        prescription: { type: 'duration', sets: 3, seconds: 30 },
        sets: [
          { type: 'duration', setNumber: 1, durationSeconds: 30, weightKg: null, rpe: 6 },
          { type: 'duration', setNumber: 2, durationSeconds: 45, weightKg: null, rpe: null },
        ],
      },
      {
        exerciseId: exerciseId('ex-002'),
        sessionId: workoutSessionId('session-perf-full'),
        exerciseOrder: 2,
        completedAt: new Date('2025-01-06T11:00:00Z'),
        prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
        sets: [
          { type: 'reps', setNumber: 1, reps: 10, weightKg: 20, rpe: 7 },
          { type: 'reps', setNumber: 2, reps: 8, weightKg: 22.5, rpe: 8 },
          { type: 'reps', setNumber: 3, reps: 12, weightKg: null, rpe: null },
        ],
      },
    ]);
  });

  it('keys progression windows on the PERFORMED exercise, never the authored one', async () => {
    // Substituted occurrence: authored Goblet Squat (ex-002), performed
    // Dumbbell Bench Press (ex-008). The performance must feed ex-008's
    // progression window only — never ex-002's, even though ex-002
    // authored the template row.
    await saveAll(
      historySession({
        id: 'session-perf-subst',
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            exerciseId: 'ex-002',
            performedExerciseId: 'ex-008',
            type: 'reps',
            sets: [{ reps: 10, weightKg: 30, rpe: 7 }],
          },
        ],
      }),
    );

    const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-002'), exerciseId('ex-008')],
      5,
    );

    // Exactly one performance, attributed to the PERFORMED exercise.
    expect(performances.map((p) => [p.exerciseId, p.sessionId, p.exerciseOrder])).toEqual([
      ['ex-008', 'session-perf-subst', 1],
    ]);
    // The window shape is fully hydrated for the performed exercise.
    expect(performances[0]?.sets).toEqual([
      { type: 'reps', setNumber: 1, reps: 10, weightKg: 30, rpe: 7 },
    ]);
  });

  // ─── Skipped occurrences and reordered sessions (M10 Slice 7) ─────────────
  //
  // Regression proof at the read-model layer: the explicit persisted
  // isSkipped flag keeps a zero-set occurrence out of per-exercise
  // performance history and progression inputs while completed-session
  // detail still shows it truthfully; a completed session that was
  // reordered before completion renders its persisted final order.

  describe('skipped occurrences and reordered sessions (M10)', () => {
    function skippedSubstitutedSession(
      id: string,
      occurrence: number,
    ): WorkoutSession {
      return historySession({
        id,
        occurrence,
        startedAt: '2025-01-06T10:00:00Z',
        completedAt: '2025-01-06T11:00:00Z',
        logs: [
          {
            // Authored ex-002, performed-as ex-008, skipped BEFORE
            // completion — substitution can validly precede skip.
            exerciseId: 'ex-002',
            performedExerciseId: 'ex-008',
            isSkipped: true,
            type: 'reps',
            sets: [],
          },
          // A genuine logged occurrence so the completion rule (>=1 logged
          // set somewhere) is satisfied alongside the skipped one.
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 20 }] },
        ],
      });
    }

    it('excludes a substituted+skipped zero-set occurrence from exercise performance history', async () => {
      await saveAll(
        skippedSubstitutedSession('session-m10-skipped', 0),
        // Genuine logged ex-008 work in a later session — must remain.
        historySession({
          id: 'session-m10-genuine',
          occurrence: 1,
          startedAt: '2025-02-06T10:00:00Z',
          completedAt: '2025-02-06T11:00:00Z',
          logs: [{ exerciseId: 'ex-008', type: 'reps', sets: [{ reps: 10, weightKg: 40 }] }],
        }),
      );

      const history = await exerciseHistoryUseCase.execute({
        userId: OWNER_A,
        slug: 'dumbbell-bench-press',
      });
      expect(history.ok).toBe(true);
      if (!history.ok) return;
      // Zero set_logs ⇒ no occurrence; the query relies on actual set_logs
      // existence and the skipped occurrence never fabricated one.
      expect(history.data.entries.map((entry) => entry.sessionId)).toEqual([
        'session-m10-genuine',
      ]);
      expect(history.data.trend.map((point) => point.sessionId)).toEqual([
        'session-m10-genuine',
      ]);
      // ...and it never leaked into ex-002 (authored) history either.
      const authored = await exerciseHistoryUseCase.execute({
        userId: OWNER_A,
        slug: 'goblet-squat',
      });
      expect(authored.ok).toBe(true);
      if (!authored.ok) return;
      expect(authored.data.entries).toEqual([]);
    });

    it('keeps skipped occurrences out of progression-history inputs', async () => {
      await saveAll(
        skippedSubstitutedSession('session-m10-prog-skipped', 0),
        historySession({
          id: 'session-m10-prog-genuine',
          occurrence: 1,
          startedAt: '2025-02-06T10:00:00Z',
          completedAt: '2025-02-06T11:00:00Z',
          logs: [{ exerciseId: 'ex-008', type: 'reps', sets: [{ reps: 10, weightKg: 40 }] }],
        }),
      );

      // The M8 progression input read — only genuine performed work.
      const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
        userId(OWNER_A),
        [exerciseId('ex-008')],
        5,
      );
      expect(performances.map((performance) => performance.sessionId)).toEqual([
        'session-m10-prog-genuine',
      ]);
      expect(performances[0]?.sets).toEqual([
        { type: 'reps', setNumber: 1, reps: 10, weightKg: 40, rpe: null },
      ]);
    });

    it('renders a reordered completed session in its persisted final order', async () => {
      // Final order after "move B up": B(1), A(2) — persisted as-is; the
      // authored template order (A first) is NOT reconstructed.
      await saveAll(
        historySession({
          id: 'session-m10-reordered',
          startedAt: '2025-01-06T10:00:00Z',
          completedAt: '2025-01-06T11:00:00Z',
          logs: [
            // order 1 — ex-002 (goblet squat), 1 logged set
            { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 16 }] },
            // order 2 — ex-001 (bodyweight squat), 1 logged set
            { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12, weightKg: null }] },
          ],
        }),
      );

      const result = await detailUseCase.execute({
        userId: OWNER_A,
        sessionId: 'session-m10-reordered',
      });
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.data.entries.map((entry) => entry.exerciseOrder)).toEqual([1, 2]);
      expect(result.data.entries.map((entry) => entry.performedExerciseId)).toEqual([
        'ex-002',
        'ex-001',
      ]);
      // Each set stayed with its own occurrence after the move.
      expect(result.data.entries[0]?.sets[0]?.weightKg).toBe(16);
      const movedSet = result.data.entries[1]?.sets[0];
      if (movedSet === undefined || movedSet.type !== 'reps') {
        throw new Error('expected a reps set');
      }
      expect(movedSet.reps).toBe(12);
    });
  });
});

describe('training history — skipped and reordered occurrences (M10)', () => {
  it('keeps a skipped occurrence in completed detail but out of exercise history and progression inputs', async () => {
    await saveAll(
      // Completed session: genuine squat occurrence plus a
      // substituted-then-skipped bench occurrence (valid M10 state:
      // substitution is blocked only WHILE skipped, so it can happen before).
      historySession({
        id: 'session-skip-det',
        occurrence: 1,
        startedAt: '2025-02-01T10:00:00Z',
        completedAt: '2025-02-01T11:00:00Z',
        logs: [
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 20 }] },
          {
            exerciseId: 'ex-002',
            performedExerciseId: 'ex-008',
            type: 'reps',
            sets: [],
            isSkipped: true,
          },
        ],
      }),
      // A later genuine bench performance drives history/progression normally.
      historySession({
        id: 'session-skip-genuine',
        occurrence: 3,
        startedAt: '2025-03-01T10:00:00Z',
        completedAt: '2025-03-01T11:00:00Z',
        logs: [{ exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 24 }] }],
      }),
    );

    // Skipped zero-set occurrences are absent from per-exercise history —
    // for BOTH identities (authored ex-002 and performed ex-008).
    const skippedHistory = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'dumbbell-bench-press',
    });
    expect(skippedHistory.ok).toBe(true);
    if (!skippedHistory.ok) return;
    expect(skippedHistory.data.entries).toEqual([]);

    const genuineHistory = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'goblet-squat',
    });
    expect(genuineHistory.ok).toBe(true);
    if (!genuineHistory.ok) return;
    expect(genuineHistory.data.entries.map((entry) => entry.sessionId)).toEqual([
      'session-skip-genuine',
    ]);

    // Progression inputs (M8 previous-performance lookup) exclude the skipped
    // occurrence: the next bench recommendation cannot anchor to zero work.
    const progressionInputs = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
      userId(OWNER_A),
      [exerciseId('ex-002'), exerciseId('ex-008')],
      5,
    );
    expect(progressionInputs.map((p) => [p.exerciseId, p.sessionId])).toEqual([
      ['ex-002', 'session-skip-genuine'],
    ]);

    // The completed-session DETAIL still contains the skipped occurrence,
    // with explicit persisted skip state and truthful identities.
    const detail = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-skip-det',
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    const skippedEntry = detail.data.entries[1];
    expect(skippedEntry).toMatchObject({
      authoredExerciseId: 'ex-002',
      performedExerciseId: 'ex-008',
      isSubstituted: true,
      isSkipped: true,
      exerciseOrder: 2,
      sets: [],
    });
    expect(detail.data.entries).toHaveLength(2);
  });

  it('renders a reordered completed session in final persisted order with sets attached to movers', async () => {
    const built = historySession({
      id: 'session-move-det',
      occurrence: 1,
      startedAt: '2025-02-01T10:00:00Z',
      logs: [
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] },
        { exerciseId: 'ex-002', type: 'reps', sets: [{ reps: 10, weightKg: 24 }] },
        // Duplicate of ex-001: distinguished by (sessionId, exerciseOrder).
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12, weightKg: 30 }] },
      ],
    });
    // B (order 2) moves up BEFORE completion: final persisted order B, A, C.
    const moved = moveSessionExercise(built, { exerciseOrder: 2, direction: 'up' });
    if (!moved.ok) throw new Error(moved.error.message);
    const completedSession = completeWorkoutSession(moved.data, new Date('2025-02-01T11:00:00Z'));
    if (!completedSession.ok) throw new Error(completedSession.error.message);
    await workoutSessionRepositorySave(completedSession.data);

    const detail = await detailUseCase.execute({
      userId: OWNER_A,
      sessionId: 'session-move-det',
    });
    expect(detail.ok).toBe(true);
    if (!detail.ok) return;
    // History renders the persisted final order — never the template order.
    expect(
      detail.data.entries.map((entry) => [entry.exerciseOrder, entry.performedExerciseId]),
    ).toEqual([
      [1, 'ex-002'],
      [2, 'ex-001'],
      [3, 'ex-001'],
    ]);
    // Every occurrence kept its own sets through the move and the
    // whole-aggregate delete/reinsert: B keeps 24, A keeps 20, C keeps 30.
    expect(detail.data.entries[0]?.sets.map((set) => set.weightKg)).toEqual([24]);
    expect(detail.data.entries[1]?.sets.map((set) => set.weightKg)).toEqual([20]);
    expect(detail.data.entries[2]?.sets.map((set) => set.weightKg)).toEqual([30]);

    // Occurrence identity is (sessionId, exerciseOrder): the moved squat
    // occurrences appear as two entries under their NEW orders, weights intact.
    const squatHistory = await exerciseHistoryUseCase.execute({
      userId: OWNER_A,
      slug: 'bodyweight-squat',
    });
    expect(squatHistory.ok).toBe(true);
    if (!squatHistory.ok) return;
    expect(
      squatHistory.data.entries.map((entry) => [entry.sessionId, entry.exerciseOrder]),
    ).toEqual([
      ['session-move-det', 3],
      ['session-move-det', 2],
    ]);
    expect(squatHistory.data.entries.map((entry) => entry.workingLoadKg)).toEqual([30, 20]);
  });

  it('counts a completed session with skips toward program progress, detached excluded, reorder-neutral', async () => {
    const { workoutSessionRepository } = await import('./setup');

    // Reorder BEFORE completion, then complete: session identity is what
    // program progress consumes — not its exercise mix or order.
    const built = historySession({
      id: 'session-prog-skip',
      occurrence: 1,
      startedAt: '2025-02-01T10:00:00Z',
      logs: [
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 20 }] },
        { exerciseId: 'ex-002', type: 'reps', sets: [], isSkipped: true },
      ],
    });
    const moved = moveSessionExercise(built, { exerciseOrder: 1, direction: 'down' });
    if (!moved.ok) throw new Error(moved.error.message);
    const completed = completeWorkoutSession(moved.data, new Date('2025-02-01T11:00:00Z'));
    if (!completed.ok) throw new Error(completed.error.message);
    await workoutSessionRepositorySave(completed.data);

    const scheduledIds = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId('enrollment-hist-a'),
    );
    // Completed WITH a skipped occurrence and after a reorder — still counts.
    expect(scheduledIds.map(String)).toContain('fit40-beginner-strength-w1-2');

    // Detached completed session with a skip: never program progress.
    const detached = historySession({
      id: 'session-prog-detached',
      occurrence: 2,
      enrollmentId: null,
      startedAt: '2025-02-02T10:00:00Z',
      completedAt: '2025-02-02T11:00:00Z',
      logs: [
        { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8 }] },
        { exerciseId: 'ex-002', type: 'reps', sets: [], isSkipped: true },
      ],
    });
    await workoutSessionRepositorySave(detached);
    const afterDetached = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentId('enrollment-hist-a'),
    );
    expect(afterDetached.map(String)).not.toContain('fit40-beginner-strength-w2-1');
  });
});

afterAll(async () => {
  await closeDatabase();
});
