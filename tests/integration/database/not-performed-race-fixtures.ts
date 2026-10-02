/**
 * Real-PostgreSQL helpers for the M17 Slice 12 concurrency/lifecycle suites.
 *
 * Not a test file. Three things live here, deliberately shared instead of
 * copied per suite:
 *
 * 1. **A dedicated pool.** The shared integration client is `max: 1`, so every
 *    overlap in these suites runs on its own pool with real parallel
 *    connections: nothing fakes concurrency with sequential calls.
 * 2. **Deterministic gates.** `holdEnrollmentLock` / `holdSessionWork` keep a
 *    real transaction past a chosen statement until the test releases it, so an
 *    interleaving is decided by the test rather than by scheduling luck. No
 *    sleep is ever used as synchronization.
 * 3. **Raw statement shapes of PEER writers**, used only inside a holder to
 *    reproduce what a concurrent operation commits (a settlement fact, the M14
 *    replacement, a logged set). They exist because a test cannot pause a
 *    production transaction mid-flight; the operations themselves are always
 *    exercised through the real use cases and repositories alongside.
 */

import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { createWorkoutSession, completeWorkoutSession, logSessionSet } from '@/domain/entities/workout-session';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import {
  createEnrollmentId,
  createScheduledWorkoutId,
  createWorkoutId,
  type EnrollmentId,
  type ScheduledWorkoutId,
  type WorkoutId,
} from '@/domain/types/ids';
import type { Database } from '@/infrastructure/database/client';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { mapSetToRow } from '@/infrastructure/database/mappers/session-mapper';
import { DrizzleNotPerformedOccurrenceRepository } from '@/infrastructure/database/repositories/drizzle-not-performed-occurrence-repository';
import { DrizzlePlannedWorkoutRepository } from '@/infrastructure/database/repositories/drizzle-planned-workout-repository';
import { DrizzleProgramEnrollmentRepository } from '@/infrastructure/database/repositories/drizzle-program-enrollment-repository';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { DrizzleRunOccurrenceWrites } from '@/infrastructure/database/repositories/drizzle-run-occurrence-writes';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import type { Transaction } from '@/infrastructure/database/repositories/workout-session-writes';
import * as schema from '@/infrastructure/database/schema';
import {
  exerciseLogs,
  notPerformedWorkouts,
  programEnrollments,
  setLogs,
  workoutSessions,
} from '@/infrastructure/database/schema';

import { exerciseId, reps, userId } from './personal-record-fixtures';
import {
  listOccurrences,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import { insertSession } from './session-fixtures';
import { db } from './setup';
import { getTestDatabaseUrl } from './test-env';

/**
 * Holds a dedicated transaction that has taken the run's parent enrollment lock
 * (the same statement every run-scoped writer issues) until `release()` is
 * called. `work` runs AFTER the lock, so a test can reproduce the rows a peer
 * writer would have committed inside its own transaction.
 */
export async function holdEnrollmentLock(input: {
  readonly db: Database;
  readonly enrollmentId: EnrollmentId;
  readonly work?: (tx: Transaction) => Promise<void>;
}): Promise<{ readonly release: () => Promise<void> }> {
  const held = createGate();
  const released = createGate();

  const done = input.db.transaction(async (tx) => {
    await tx
      .select({ id: programEnrollments.id })
      .from(programEnrollments)
      .where(eq(programEnrollments.id, input.enrollmentId))
      .for('no key update');

    if (input.work !== undefined) {
      await input.work(tx);
    }

    held.open();
    await released.opened;
  });

  await held.opened;

  return {
    release: async () => {
      released.open();
      await done;
    },
  };
}

/**
 * Holds a dedicated transaction that owns the occurrence's SESSION ROW lock via
 * the statement shape of a committed whole-aggregate save (row lock, version
 * bump, logged set) until `release()` is called.
 *
 * This is the tightest window M17 has to defend: `WorkoutSessionRepository.save`
 * is an UPDATE-only CAS that does NOT take the enrollment lock, so a settlement
 * decision made under the enrollment lock can be overtaken by work that commits
 * before the guarded DELETE re-checks its predicate.
 */
export async function holdSessionWork(input: {
  readonly db: Database;
  readonly sessionId: string;
}): Promise<{ readonly release: () => Promise<void> }> {
  const held = createGate();
  const released = createGate();

  const done = input.db.transaction(async (tx) => {
    // The row lock a save takes first (its UPDATE), then the work it persists.
    const rows = await tx
      .select({ version: workoutSessions.version, exerciseOrder: exerciseLogs.exerciseOrder })
      .from(workoutSessions)
      .innerJoin(exerciseLogs, eq(exerciseLogs.sessionId, workoutSessions.id))
      .where(eq(workoutSessions.id, input.sessionId))
      .orderBy(exerciseLogs.exerciseOrder)
      .limit(1)
      .for('update', { of: workoutSessions });

    const row = rows[0];
    if (row === undefined) throw new Error('holder found no session row to lock');

    await tx
      .update(workoutSessions)
      .set({ version: row.version + 1 })
      .where(eq(workoutSessions.id, input.sessionId));

    await tx
      .insert(setLogs)
      .values(
        mapSetToRow(input.sessionId, row.exerciseOrder, {
          setNumber: 1,
          type: 'reps',
          reps: 8,
          weightKg: 20,
          rpe: null,
        }),
      );

    held.open();
    await released.opened;
  });

  await held.opened;

  return {
    release: async () => {
      released.open();
      await done;
    },
  };
}

/** The statement shape of a peer settlement commit: insert the fact. */
export async function insertFactRaw(
  tx: Transaction,
  input: {
    readonly enrollmentId: EnrollmentId;
    readonly scheduledWorkoutId: string;
    readonly recordedAt?: string;
  },
): Promise<void> {
  await tx.insert(notPerformedWorkouts).values({
    enrollmentId: input.enrollmentId,
    scheduledWorkoutId: input.scheduledWorkoutId,
    recordedAt: new Date(input.recordedAt ?? '2026-09-28T18:30:00Z'),
  });
}

/**
 * The statement shape of M14's restart replacement: delete the EXPECTED
 * enrollment (cascading its facts, detaching its sessions) and insert the fresh
 * run in ONE transaction, exactly as `replaceExpectedWithNew` does.
 */
export async function replaceEnrollmentRaw(
  tx: Transaction,
  input: {
    readonly expectedId: EnrollmentId;
    readonly nextId: string;
    readonly owner: string;
    readonly programId: string;
  },
): Promise<void> {
  await tx.delete(programEnrollments).where(eq(programEnrollments.id, input.expectedId));
  await tx.insert(programEnrollments).values({
    id: input.nextId,
    userId: input.owner,
    programId: input.programId,
    enrolledAt: new Date('2026-10-01T00:00:00Z'),
  });
}

/** The statement shape of a peer leave: delete the run, detaching its history. */
export async function deleteEnrollmentRaw(
  tx: Transaction,
  enrollmentId: EnrollmentId,
): Promise<void> {
  await tx.delete(programEnrollments).where(eq(programEnrollments.id, enrollmentId));
}

/** A one-shot gate: created closed, opened once by its owner. */
export function createGate(): { readonly opened: Promise<void>; readonly open: () => void } {
  let open: (() => void) | null = null;
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });

  return {
    opened,
    open: () => {
      if (open !== null) open();
    },
  };
}

/** Tables a snapshot gate may lock (a compile-time closed set). */
export type SnapshotGateTable = 'workout_sessions' | 'not_performed_workouts';

/**
 * A test-only gate: a dedicated transaction whose `LOCK TABLE … IN ACCESS
 * EXCLUSIVE MODE` request makes any plain read of that table queue behind it
 * (PostgreSQL grants locks in request order). Its REQUEST is verified through
 * `waitForPendingLock` by the caller before anything is allowed to proceed.
 */
export function holdTableWriteGate(
  db: Database,
  table: SnapshotGateTable,
): {
  readonly granted: Promise<void>;
  readonly release: () => Promise<void>;
} {
  const granted = createGate();
  const released = createGate();
  const done = db.transaction(async (tx) => {
    // `table` is a closed union of literal table names, never user input.
    await tx.execute(sql`LOCK TABLE ${sql.raw(table)} IN ACCESS EXCLUSIVE MODE`);
    granted.open();
    await released.opened;
  });
  return {
    granted: granted.opened,
    release: async () => {
      released.open();
      await done;
    },
  };
}

/**
 * Waits until a PENDING (ungranted) lock request of `mode` on `table` is
 * visible in `pg_locks` — the gate is armed. Deterministic: the request was
 * already dispatched, so the database MUST publish it; each poll is a
 * database round-trip, never a sleep.
 */
export async function waitForPendingLock(
  client: postgres.Sql,
  table: SnapshotGateTable,
  mode: 'AccessExclusiveLock' | 'AccessShareLock',
): Promise<void> {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const rows = await client<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pg_locks
      WHERE granted = false AND mode = ${mode} AND relation = ${table}::regclass
    `;
    if (Number.parseInt(rows[0]?.count ?? '0', 10) >= 1) return;
  }
  throw new Error(`no pending ${mode} on ${table}: the gate never armed`);
}

export const PENDING = 'pending' as const;

/**
 * Waits up to `ms` for `observed`. Resolving with `PENDING` proves the promise
 * is still blocked; any rejection surfaces through the awaits that follow.
 */
export async function settleWithin<T>(
  observed: Promise<T>,
  ms: number,
): Promise<T | typeof PENDING> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<typeof PENDING>((resolve) => {
    timer = setTimeout(() => resolve(PENDING), ms);
  });

  try {
    return await Promise.race([observed, timeout]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** Whole-table row count, for orphan/leak assertions. */
export async function countRows(
  sql: postgres.Sql,
  table:
    | 'workout_sessions'
    | 'exercise_logs'
    | 'set_logs'
    | 'not_performed_workouts'
    | 'planned_workouts',
): Promise<number> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM ${sql(table)}
  `;
  const [row] = rows;
  if (row === undefined) throw new Error('count(*) returned no row');
  return Number.parseInt(row.count, 10);
}

/** The persisted session row itself, or null — never a guess from a count. */
export async function sessionRowFor(
  sql: postgres.Sql,
  enrollmentId: EnrollmentId,
  scheduledWorkoutId: string,
): Promise<{ readonly id: string; readonly enrollmentId: string | null } | null> {
  const rows = await sql<{ id: string; enrollment_id: string | null }[]>`
    SELECT id, enrollment_id FROM workout_sessions
    WHERE enrollment_id = ${enrollmentId} AND scheduled_workout_id = ${scheduledWorkoutId}
  `;
  const [row] = rows;
  return row === undefined ? null : { id: row.id, enrollmentId: row.enrollment_id };
}

/** The child rows of one session, read straight from their tables. */
export async function childRowCounts(
  sql: postgres.Sql,
  sessionId: string,
): Promise<{ readonly exerciseLogs: number; readonly setLogs: number }> {
  const logs = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM exercise_logs WHERE session_id = ${sessionId}
  `;
  const sets = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM set_logs WHERE session_id = ${sessionId}
  `;

  return {
    exerciseLogs: Number.parseInt(logs[0]?.count ?? '0', 10),
    setLogs: Number.parseInt(sets[0]?.count ?? '0', 10),
  };
}

/** Every session row id attached to a run, sorted — no orphan can hide. */
export async function sessionIdsForRun(
  sql: postgres.Sql,
  enrollmentId: EnrollmentId,
): Promise<ReadonlyArray<string>> {
  const rows = await sql<{ id: string }[]>`
    SELECT id FROM workout_sessions WHERE enrollment_id = ${enrollmentId} ORDER BY id
  `;
  return rows.map((row) => row.id);
}
/** Child rows whose parent no longer exists — the orphan definition. */
export async function orphanChildRows(
  sql: postgres.Sql,
): Promise<{ readonly exerciseLogs: number; readonly setLogs: number }> {
  const logs = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM exercise_logs l
    WHERE NOT EXISTS (SELECT 1 FROM workout_sessions s WHERE s.id = l.session_id)
  `;
  const sets = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM set_logs x
    WHERE NOT EXISTS (
      SELECT 1 FROM exercise_logs l
      WHERE l.session_id = x.session_id AND l.exercise_order = x.exercise_order
    )
  `;

  return {
    exerciseLogs: Number.parseInt(logs[0]?.count ?? '0', 10),
    setLogs: Number.parseInt(sets[0]?.count ?? '0', 10),
  };
}

/**
 * A brand-new, NOT persisted aggregate for one authored occurrence, in the exact
 * shape the start path builds. Used by authority-level tests that need a valid
 * aggregate to hand to `createSessionForOccurrence`.
 */
export function buildOccurrenceSession(input: {
  readonly id: string;
  readonly owner: string;
  readonly enrollmentId: EnrollmentId;
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly workoutId: WorkoutId;
}): WorkoutSession {
  const created = createWorkoutSession({
    id: input.id,
    userId: userId(input.owner),
    enrollmentId: input.enrollmentId,
    scheduledWorkoutId: input.scheduledWorkoutId,
    workoutId: input.workoutId,
    startedAt: new Date('2026-09-21T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
    ],
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.data;
}

/**
 * Seeds ONE in-progress session for an occurrence: one exercise log, and either
 * zero logged sets (the abandoned shape a settlement may delete) or one logged
 * set (work that must be respected).
 */
export async function seedInProgressOccurrenceSession(input: {
  readonly id: string;
  readonly owner: string;
  readonly enrollmentId: EnrollmentId;
  readonly scheduledWorkoutId: string;
  readonly workoutId: string;
  readonly withLoggedSet?: boolean;
}): Promise<WorkoutSession> {
  const scheduledWorkout = createScheduledWorkoutId(input.scheduledWorkoutId);
  if (!scheduledWorkout.ok) throw new Error(scheduledWorkout.error.message);
  const workout = createWorkoutId(input.workoutId);
  if (!workout.ok) throw new Error(workout.error.message);

  const created = createWorkoutSession({
    id: input.id,
    userId: userId(input.owner),
    enrollmentId: input.enrollmentId,
    scheduledWorkoutId: scheduledWorkout.data,
    workoutId: workout.data,
    startedAt: new Date('2026-09-21T10:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
    ],
  });
  if (!created.ok) throw new Error(created.error.message);

  const session = input.withLoggedSet === true ? withOneSet(created.data) : created.data;
  await insertSession(session);

  return session;
}

/** The aggregate with its first exercise carrying one real logged set. */
function withOneSet(session: WorkoutSession): WorkoutSession {
  const logged = logSessionSet(session, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 8,
    weightKg: 20,
    rpe: null,
  });
  if (!logged.ok) throw new Error(logged.error.message);
  return logged.data;
}

/** `true` when a fact exists for the run/occurrence, read straight from SQL. */
export async function factExists(
  sql: postgres.Sql,
  enrollmentId: EnrollmentId,
  scheduledWorkoutId: string,
): Promise<boolean> {
  const rows = await sql<{ count: string }[]>`
    SELECT count(*)::text AS count FROM not_performed_workouts
    WHERE enrollment_id = ${enrollmentId} AND scheduled_workout_id = ${scheduledWorkoutId}
  `;
  return Number.parseInt(rows[0]?.count ?? '0', 10) > 0;
}

/** `occurrence@instant` lines of a run's facts, for before/after comparisons. */
export async function factInstants(
  sql: postgres.Sql,
  enrollmentId: EnrollmentId,
): Promise<ReadonlyArray<string>> {
  // `to_char` rather than the raw column: drizzle's postgres-js driver installs
  // a transparent parser for the timestamp OIDs on the pool it wraps, so a raw
  // read on the SAME pool hands back the server's text, not a `Date`.
  const rows = await sql<{ scheduled_workout_id: string; recorded_at: string }[]>`
    SELECT scheduled_workout_id,
           to_char(recorded_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS recorded_at
    FROM not_performed_workouts
    WHERE enrollment_id = ${enrollmentId}
    ORDER BY scheduled_workout_id
  `;
  return rows.map((row) => `${row.scheduled_workout_id}@${row.recorded_at}`);
}

/**
 * A run that is RESTARTABLE by construction: every authored occurrence is
 * settled except the last, which carries a not-performed fact instead of a
 * completed session. The domain rule (`isRunRestartable` over
 * `isRunConcluded`) is what makes this run eligible for the M14 replacement
 * paths, so the restart/leave races below need real restartable state.
 */
export interface ConcludedRunFixture extends PlannedRunFixture {
  /** The one occurrence settled by a fact rather than by a completed session. */
  readonly settledOccurrenceId: string;
  readonly completedSessionIds: ReadonlyArray<string>;
}

export async function seedConcludedRun(input: {
  readonly owner: string;
  readonly programSlug: string;
  readonly enrollmentId: string;
}): Promise<ConcludedRunFixture> {
  const run = await seedEnrolledRun(input);
  const occurrences = listOccurrences(run.program);
  const settled = occurrences[occurrences.length - 1];
  if (settled === undefined) throw new Error('the seeded program authors no occurrences');

  const enrollment = createEnrollmentId(input.enrollmentId);
  if (!enrollment.ok) throw new Error(enrollment.error.message);

  const completedSessionIds: string[] = [];

  for (const [index, occurrence] of occurrences.slice(0, -1).entries()) {
    const scheduledWorkout = createScheduledWorkoutId(occurrence.id);
    if (!scheduledWorkout.ok) throw new Error(scheduledWorkout.error.message);

    const session = completedOccurrenceSession({
      id: `${input.enrollmentId}-concluded-session-${index + 1}`,
      owner: input.owner,
      enrollmentId: enrollment.data,
      scheduledWorkoutId: scheduledWorkout.data,
      workoutId: occurrence.workoutId,
    });
    await insertSession(session);
    completedSessionIds.push(session.id);
  }

  await db.transaction((tx) =>
    insertFactRaw(tx, { enrollmentId: enrollment.data, scheduledWorkoutId: settled.id }),
  );

  return { ...run, settledOccurrenceId: settled.id, completedSessionIds };
}

/**
 * Seeds ONE completed, one-set session for an occurrence. Used to prove that a
 * run's history survives a concurrent leave/restart as detached rows.
 */
export async function seedCompletedOccurrenceSession(input: {
  readonly id: string;
  readonly owner: string;
  readonly enrollmentId: EnrollmentId;
  readonly scheduledWorkoutId: string;
  readonly workoutId: string;
}): Promise<WorkoutSession> {
  const scheduledWorkout = createScheduledWorkoutId(input.scheduledWorkoutId);
  if (!scheduledWorkout.ok) throw new Error(scheduledWorkout.error.message);
  const workout = createWorkoutId(input.workoutId);
  if (!workout.ok) throw new Error(workout.error.message);

  const session = completedOccurrenceSession({
    id: input.id,
    owner: input.owner,
    enrollmentId: input.enrollmentId,
    scheduledWorkoutId: scheduledWorkout.data,
    workoutId: workout.data,
  });
  await insertSession(session);

  return session;
}

/** One completed, one-set session for an authored occurrence. */
export function completedOccurrenceSession(input: {
  readonly id: string;
  readonly owner: string;
  readonly enrollmentId: EnrollmentId;
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly workoutId: WorkoutId;
}): WorkoutSession {
  const created = createWorkoutSession({
    id: input.id,
    userId: userId(input.owner),
    enrollmentId: input.enrollmentId,
    scheduledWorkoutId: input.scheduledWorkoutId,
    workoutId: input.workoutId,
    startedAt: new Date('2026-09-20T09:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 60 },
    ],
  });
  if (!created.ok) throw new Error(created.error.message);

  const logged = logSessionSet(created.data, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 8,
    weightKg: 20,
    rpe: null,
  });
  if (!logged.ok) throw new Error(logged.error.message);

  const completed = completeWorkoutSession(logged.data, new Date('2026-09-20T10:00:00Z'));
  if (!completed.ok) throw new Error(completed.error.message);

  return completed.data;
}

/**
 * How many exercise logs the START path writes for one authored occurrence:
 * exactly the number of exercises the occurrence's workout template authors.
 * Used to assert a created session's child rows without hard-coding a number.
 */
export function authoredExerciseCount(program: TrainingProgram, occurrenceId: string): number {
  for (const week of program.weeks) {
    for (const scheduled of week.scheduledWorkouts) {
      if (scheduled.id === occurrenceId) {
        const workout = program.workouts.find((candidate) => candidate.id === scheduled.workoutId);
        if (workout === undefined) throw new Error('occurrence references a missing workout');
        return workout.exercises.length;
      }
    }
  }
  throw new Error(`occurrence "${occurrenceId}" is not authored by the program`);
}

/** A dedicated pool plus the production repositories bound to that pool. */
export interface RaceHarness {
  readonly sql: postgres.Sql;
  readonly db: Database;
  readonly writes: DrizzleRunOccurrenceWrites;
  readonly sessions: DrizzleWorkoutSessionRepository;
  readonly planned: DrizzlePlannedWorkoutRepository;
  readonly enrollments: DrizzleProgramEnrollmentRepository;
  readonly notPerformed: DrizzleNotPerformedOccurrenceRepository;
  readonly programs: DrizzleProgramRepository;
  /** Real parallel connections, unlike the shared `max: 1` client. */
  end: () => Promise<void>;
}

export function createRaceHarness(max = 4): RaceHarness {
  const sql = postgres(getTestDatabaseUrl(), { max });
  const db = drizzle(sql, { schema });

  return {
    sql,
    db,
    writes: new DrizzleRunOccurrenceWrites(db),
    sessions: new DrizzleWorkoutSessionRepository(db),
    planned: new DrizzlePlannedWorkoutRepository(db),
    enrollments: new DrizzleProgramEnrollmentRepository(db),
    notPerformed: new DrizzleNotPerformedOccurrenceRepository(db),
    programs: new DrizzleProgramRepository(db),
    end: async () => {
      await sql.end();
    },
  };
}