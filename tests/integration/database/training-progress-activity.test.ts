/**
 * M18 Slice 2 — real-PostgreSQL progress activity read
 * (`docs/training-progress.md` §4.1–§4.3, §5, §6.3).
 *
 * The SQL projection is verified against the Domain oracle
 * (`calculateSessionMetrics`) rather than trusted: every session's external
 * load must equal the hydrated-aggregate volume when the session logged an
 * eligible loaded set, and must be `null` — not `0` — when it did not.
 * Datasets B, C, K, L and M from the memo's acceptance matrix are pinned
 * here, plus user scoping, the inclusive `since` edge, and the bounded
 * statement count (never one query per session).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { PROGRESS_HORIZON_WEEK_COUNT } from '@/application/dto/training-progress';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import { GetTrainingProgressActivityUseCase } from '@/application/use-cases/get-training-progress-activity';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { calculateSessionMetrics } from '@/domain/services/session-metrics';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import { listRecentTrainingWeekWindows } from '@/domain/services/training-week';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
} from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';
import { DrizzleTrainingHistoryRepository } from '@/infrastructure/database/repositories/drizzle-training-history-repository';
import * as schema from '@/infrastructure/database/schema';
import { users } from '@/infrastructure/database/schema';

import { insertFact } from './not-performed-fixtures';
import { insertSession } from './session-fixtures';
import {
  closeDatabase,
  db,
  programEnrollmentRepository,
  resetAndSeed,
  trainingHistoryRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER_A = 'user-progress-a';
const OWNER_B = 'user-progress-b';

/** A Thursday: the current UTC week starts 2026-09-21. */
const NOW = new Date('2026-09-24T10:00:00.000Z');
const HORIZON = listRecentTrainingWeekWindows(NOW, PROGRESS_HORIZON_WEEK_COUNT);

function item<T>(items: ReadonlyArray<T>, index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`missing item at index ${index}`);
  return value;
}

/** The inclusive lower bound of the read: the oldest window's Monday 00:00. */
const SINCE = item(HORIZON, 0).weekStart;

/** The ISO start of the horizon window at `index` (0 = oldest). */
function weekStart(index: number): string {
  return item(HORIZON, index).weekStart.toISOString();
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

/** Distinct seeded occurrences of the beginner-strength program. */
const OCCURRENCES = [
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-3', workoutId: 'wo-beginner-strength-c' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-3', workoutId: 'wo-beginner-strength-c' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w3-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w3-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w3-3', workoutId: 'wo-beginner-strength-c' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w4-1', workoutId: 'wo-beginner-strength-a' },
] as const;

interface SetSpec {
  readonly reps?: number;
  readonly durationSeconds?: number;
  readonly weightKg?: number | null;
}

interface LogSpec {
  readonly exerciseId: string;
  readonly type: 'reps' | 'duration';
  readonly sets: ReadonlyArray<SetSpec>;
  /** Marks the occurrence explicitly skipped (M10) — requires zero sets. */
  readonly isSkipped?: boolean;
}

/**
 * Builds a session with explicit per-exercise logged sets on a seeded
 * occurrence. Omitting `completedAt` leaves the session in progress.
 */
function progressSession(spec: {
  id: string;
  userId?: string;
  enrollmentId?: string | null;
  occurrence?: number;
  startedAt: string;
  completedAt?: string;
  logs: ReadonlyArray<LogSpec>;
}): WorkoutSession {
  const occurrence = item(OCCURRENCES, spec.occurrence ?? 0);

  const created = createWorkoutSession({
    id: spec.id,
    userId: userId(spec.userId ?? OWNER_A),
    enrollmentId:
      spec.enrollmentId === undefined
        ? enrollmentId('enrollment-progress-a')
        : spec.enrollmentId === null
          ? null
          : enrollmentId(spec.enrollmentId),
    scheduledWorkoutId: scheduledWorkoutId(occurrence.scheduledWorkoutId),
    workoutId: workoutId(occurrence.workoutId),
    startedAt: new Date(spec.startedAt),
    exerciseLogs: spec.logs.map((log, index) => ({
      authoredExerciseId: exerciseId(log.exerciseId),
      performedExerciseId: exerciseId(log.exerciseId),
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
        rpe: null,
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

async function saveAll(...sessions: WorkoutSession[]): Promise<void> {
  for (const session of sessions) {
    await insertSession(session);
  }
}

/**
 * A second, isolated connection pool whose driver reports every statement it
 * executes, so the progress read's statement count is observable. The
 * repository under test is the production class.
 */
async function withCountingRepository<T>(
  run: (repository: TrainingHistoryRepository, queries: string[]) => Promise<T>,
): Promise<T> {
  const queries: string[] = [];
  const countingClient = postgres(getTestDatabaseUrl(), {
    max: 1,
    // Simple protocol: one driver callback per executed statement.
    prepare: false,
    debug: (_connection, query) => {
      queries.push(query);
    },
  });

  try {
    const repository = new DrizzleTrainingHistoryRepository(
      drizzle(countingClient, { schema }),
    );
    return await run(repository, queries);
  } finally {
    await countingClient.end();
  }
}

const progressUseCase = new GetTrainingProgressActivityUseCase(trainingHistoryRepository);

beforeEach(async () => {
  await resetAndSeed();
  await seedUser(OWNER_A);
  await seedUser(OWNER_B);
  await seedEnrollment('enrollment-progress-a', OWNER_A, 'prog-beginner-strength');
  await seedEnrollment('enrollment-progress-b', OWNER_B, 'prog-beginner-strength');
});

// ─── SQL projection vs the Domain oracle ────────────────────────────────────

describe('progress activity — external load matches the Domain oracle', () => {
  it('equals calculateSessionMetrics per session, keeping null and genuine 0 apart (B, C)', async () => {
    const loaded = progressSession({
      id: 'pg-loaded',
      occurrence: 0,
      startedAt: '2026-06-30T09:00:00Z',
      completedAt: '2026-06-30T10:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 20 }] }],
    });
    const zero = progressSession({
      id: 'pg-zero',
      occurrence: 1,
      startedAt: '2026-07-01T09:00:00Z',
      completedAt: '2026-07-01T10:00:00Z',
      logs: [
        {
          exerciseId: 'ex-001',
          type: 'reps',
          sets: [
            { reps: 5, weightKg: 0 },
            { reps: 5, weightKg: 0 },
          ],
        },
      ],
    });
    const bodyweight = progressSession({
      id: 'pg-bodyweight',
      occurrence: 2,
      startedAt: '2026-07-02T09:00:00Z',
      completedAt: '2026-07-02T10:00:00Z',
      logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12, weightKg: null }] }],
    });
    const durationLoaded = progressSession({
      id: 'pg-duration-loaded',
      occurrence: 3,
      startedAt: '2026-07-03T09:00:00Z',
      completedAt: '2026-07-03T10:00:00Z',
      logs: [
        {
          exerciseId: 'ex-014',
          type: 'duration',
          sets: [{ durationSeconds: 45, weightKg: 10 }],
        },
      ],
    });
    const mixed = progressSession({
      id: 'pg-mixed',
      occurrence: 4,
      startedAt: '2026-07-04T09:00:00Z',
      completedAt: '2026-07-04T10:00:00Z',
      logs: [
        {
          exerciseId: 'ex-001',
          type: 'reps',
          sets: [
            { reps: 10, weightKg: null },
            { reps: 10, weightKg: 30 },
          ],
        },
      ],
    });
    await saveAll(loaded, zero, bodyweight, durationLoaded, mixed);

    const rows = await trainingHistoryRepository.listProgressSessionActivity(
      userId(OWNER_A),
      SINCE,
    );
    const byId = new Map(rows.map((row) => [String(row.sessionId), row]));

    expect(rows).toHaveLength(5);

    // Positive volumes: exactly the Domain's `reps × weightKg` sum.
    expect(byId.get('pg-loaded')?.externalLoadVolume).toBe(
      calculateSessionMetrics(loaded).volume,
    );
    expect(byId.get('pg-loaded')?.externalLoadVolume).toBe(200);
    expect(byId.get('pg-mixed')?.externalLoadVolume).toBe(
      calculateSessionMetrics(mixed).volume,
    );
    // The unloaded set contributes nothing; only the 10 × 30 set counts.
    expect(byId.get('pg-mixed')?.externalLoadVolume).toBe(300);

    // Genuine zero: eligible 0 kg sets — a real `0`, never null (§6.3).
    expect(calculateSessionMetrics(zero).volume).toBe(0);
    expect(byId.get('pg-zero')?.externalLoadVolume).toBe(0);

    // No eligible loaded rep set: null, never 0 — bodyweight reps ...
    expect(byId.get('pg-bodyweight')?.externalLoadVolume).toBeNull();
    // ... and a LOADED TIMED SET: the oracle excludes duration sets from
    // volume, so the session has no eligible data even though a weight was
    // logged — the SQL predicate must agree.
    expect(calculateSessionMetrics(durationLoaded).volume).toBe(0);
    expect(byId.get('pg-duration-loaded')?.externalLoadVolume).toBeNull();

    // Set counts match the oracle for every session.
    for (const session of [loaded, zero, bodyweight, durationLoaded, mixed]) {
      expect(byId.get(session.id)?.loggedSets).toBe(calculateSessionMetrics(session).totalSets);
    }
  });
});

// ─── The use case over the real database ────────────────────────────────────

describe('progress activity — horizon aggregation', () => {
  it('buckets by completedAt across the 13 weeks, with totals and the anchored average (B, C, K)', async () => {
    await saveAll(
      // Week 0 (2026-06-29): a loaded session and a genuine-0 session.
      progressSession({
        id: 'pg-w0-loaded',
        occurrence: 0,
        startedAt: '2026-06-30T09:00:00Z',
        completedAt: '2026-06-30T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 20 }] }],
      }),
      progressSession({
        id: 'pg-w0-zero',
        occurrence: 1,
        startedAt: '2026-07-01T09:00:00Z',
        completedAt: '2026-07-01T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 5, weightKg: 0 }] }],
      }),
      // Week 2 (2026-07-13): bodyweight-only and duration-only — no load data.
      progressSession({
        id: 'pg-w2-bodyweight',
        occurrence: 2,
        startedAt: '2026-07-15T09:00:00Z',
        completedAt: '2026-07-15T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 12 }] }],
      }),
      progressSession({
        id: 'pg-w2-duration',
        occurrence: 3,
        startedAt: '2026-07-15T11:00:00Z',
        completedAt: '2026-07-15T12:00:00Z',
        logs: [{ exerciseId: 'ex-014', type: 'duration', sets: [{ durationSeconds: 45 }] }],
      }),
      // Week 5 (2026-08-03): DETACHED completed history (no enrollment) counts.
      progressSession({
        id: 'pg-w5-detached',
        occurrence: 4,
        enrollmentId: null,
        startedAt: '2026-08-05T09:00:00Z',
        completedAt: '2026-08-05T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
      }),
      // Week 12: the current partial week.
      progressSession({
        id: 'pg-current',
        occurrence: 5,
        startedAt: '2026-09-22T09:00:00Z',
        completedAt: '2026-09-22T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 12.5 }] }],
      }),
    );

    const result = await progressUseCase.execute({ userId: OWNER_A, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = result.data;

    expect(dto.weeks).toHaveLength(PROGRESS_HORIZON_WEEK_COUNT);
    expect(dto.weeks[0]).toEqual({
      weekStart: weekStart(0),
      completedWorkouts: 2,
      loggedSets: 2,
      externalLoadVolumeKgReps: 200,
    });
    // Untouched week: an authoritative zero with no external-load data.
    expect(dto.weeks[1]).toEqual({
      weekStart: weekStart(1),
      completedWorkouts: 0,
      loggedSets: 0,
      externalLoadVolumeKgReps: null,
    });
    // Bodyweight-only + duration-only: trained, but no eligible load data.
    expect(dto.weeks[2]).toEqual({
      weekStart: weekStart(2),
      completedWorkouts: 2,
      loggedSets: 2,
      externalLoadVolumeKgReps: null,
    });
    expect(dto.weeks[5]).toEqual({
      weekStart: weekStart(5),
      completedWorkouts: 1,
      loggedSets: 1,
      externalLoadVolumeKgReps: 320,
    });
    expect(dto.weeks[12]).toEqual({
      weekStart: weekStart(12),
      completedWorkouts: 1,
      loggedSets: 1,
      externalLoadVolumeKgReps: 100,
    });

    // Totals include the current partial week; the average excludes it.
    expect(dto.totals).toEqual({
      completedWorkouts: 6,
      loggedSets: 6,
      externalLoadVolumeKgReps: 620,
    });
    expect(dto.average).toEqual({ workoutsPerWeek: 5 / 12, denominatorWeeks: 12 });
  });
});

// ─── Boundaries, scope and settlement truth (M, K, L) ───────────────────────

describe('progress activity — boundaries and scope', () => {
  it('includes a session completed exactly at the inclusive `since` edge and excludes earlier ones (M)', async () => {
    await saveAll(
      progressSession({
        id: 'pg-at-since',
        occurrence: 0,
        startedAt: '2026-06-28T23:00:00Z',
        completedAt: SINCE.toISOString(),
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 12.5 }] }],
      }),
      progressSession({
        id: 'pg-before-since',
        occurrence: 1,
        startedAt: '2026-06-28T09:00:00Z',
        completedAt: '2026-06-28T23:59:59.999Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 99 }] }],
      }),
    );

    const rows = await trainingHistoryRepository.listProgressSessionActivity(
      userId(OWNER_A),
      SINCE,
    );

    expect(rows.map((row) => String(row.sessionId))).toEqual(['pg-at-since']);
    expect(rows[0]?.externalLoadVolume).toBe(100);

    // The at-since session lands in the OLDEST window: `completedAt` is the
    // window start, which is inclusive.
    const result = await progressUseCase.execute({ userId: OWNER_A, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.weeks[0]).toEqual({
      weekStart: weekStart(0),
      completedWorkouts: 1,
      loggedSets: 1,
      externalLoadVolumeKgReps: 100,
    });
  });

  it('counts detached history and ignores in-progress, other users, skipped and not-performed facts (K, L)', async () => {
    await saveAll(
      // A completed session containing one logged occurrence and one
      // explicitly SKIPPED occurrence (zero sets): the skip contributes no
      // set, no volume and no workout of its own.
      progressSession({
        id: 'pg-l-skipped',
        occurrence: 0,
        startedAt: '2026-08-12T09:00:00Z',
        completedAt: '2026-08-12T10:00:00Z',
        logs: [
          { exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 30 }] },
          { exerciseId: 'ex-002', type: 'reps', sets: [], isSkipped: true },
        ],
      }),
      // Detached completed history: the enrollment was left, the training stays.
      progressSession({
        id: 'pg-k-detached',
        occurrence: 1,
        enrollmentId: null,
        startedAt: '2026-08-05T09:00:00Z',
        completedAt: '2026-08-05T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
      }),
      // Started inside the horizon, never completed.
      progressSession({
        id: 'pg-in-progress',
        occurrence: 2,
        startedAt: '2026-09-22T09:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 60 }] }],
      }),
      // Another user's completed session with the same occurrences.
      progressSession({
        id: 'pg-other-user',
        userId: OWNER_B,
        enrollmentId: 'enrollment-progress-b',
        occurrence: 0,
        startedAt: '2026-08-12T09:00:00Z',
        completedAt: '2026-08-12T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 10, weightKg: 99 }] }],
      }),
    );

    const before = await trainingHistoryRepository.listProgressSessionActivity(
      userId(OWNER_A),
      SINCE,
    );

    // An M17 not-performed fact for an occurrence that has NO session: the
    // user attested they did not train it. It is settlement truth, not
    // training, and must change no progress metric.
    await insertFact({
      enrollmentId: 'enrollment-progress-a',
      scheduledWorkoutId: 'fit40-beginner-strength-w4-1',
      recordedAt: '2026-08-10T12:00:00Z',
    });

    const after = await trainingHistoryRepository.listProgressSessionActivity(
      userId(OWNER_A),
      SINCE,
    );

    expect(after.map((row) => String(row.sessionId))).toEqual([
      'pg-l-skipped',
      'pg-k-detached',
    ]);
    expect(after).toEqual(before);

    const result = await progressUseCase.execute({ userId: OWNER_A, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const dto = result.data;

    // Week 5: the detached session counts like any other completed workout.
    expect(dto.weeks[5]).toEqual({
      weekStart: weekStart(5),
      completedWorkouts: 1,
      loggedSets: 1,
      externalLoadVolumeKgReps: 320,
    });
    // Week 6: one workout, one logged set and 300 kg × reps — the skipped
    // occurrence and the not-performed fact contribute nothing.
    expect(dto.weeks[6]).toEqual({
      weekStart: weekStart(6),
      completedWorkouts: 1,
      loggedSets: 1,
      externalLoadVolumeKgReps: 300,
    });
    expect(dto.totals).toEqual({
      completedWorkouts: 2,
      loggedSets: 2,
      externalLoadVolumeKgReps: 620,
    });
    // Anchor at the first trained completed week (index 5) → 12 − 5 = 7.
    expect(dto.average).toEqual({ workoutsPerWeek: 2 / 7, denominatorWeeks: 7 });
  });
});

// ─── Bounded statement count ────────────────────────────────────────────────

describe('progress activity — bounded statements', () => {
  it('answers an empty window with one statement and any window size with two', async () => {
    await saveAll(
      progressSession({
        id: 'pg-count-1',
        occurrence: 0,
        startedAt: '2026-06-30T09:00:00Z',
        completedAt: '2026-06-30T10:00:00Z',
        logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
    );

    await withCountingRepository(async (repository, queries) => {
      // Warm up: a driver's first statement is its own type discovery.
      await repository.listProgressSessionActivity(userId(OWNER_A), SINCE);

      const beforeEmpty = queries.length;
      await repository.listProgressSessionActivity(userId('user-progress-empty'), SINCE);
      const emptyWindow = queries.length - beforeEmpty;

      const beforeOne = queries.length;
      await repository.listProgressSessionActivity(userId(OWNER_A), SINCE);
      const oneSession = queries.length - beforeOne;

      await saveAll(
        progressSession({
          id: 'pg-count-2',
          occurrence: 1,
          startedAt: '2026-07-01T09:00:00Z',
          completedAt: '2026-07-01T10:00:00Z',
          logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
        }),
        progressSession({
          id: 'pg-count-3',
          occurrence: 2,
          startedAt: '2026-07-02T09:00:00Z',
          completedAt: '2026-07-02T10:00:00Z',
          logs: [{ exerciseId: 'ex-001', type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
        }),
      );

      const beforeMany = queries.length;
      await repository.listProgressSessionActivity(userId(OWNER_A), SINCE);
      const threeSessions = queries.length - beforeMany;

      // An empty window is answered by Q1 alone; any window size costs exactly
      // one session query plus one grouped per-session aggregation — never one
      // statement per session.
      expect(emptyWindow).toBe(1);
      expect(oneSession).toBe(2);
      expect(threeSessions).toBe(2);
    });
  });
});

afterAll(async () => {
  await closeDatabase();
});
