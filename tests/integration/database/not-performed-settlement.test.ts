/**
 * M17 Slice 5 — not-performed settlement writes on real PostgreSQL.
 *
 * Proves the ONE mutation authority end to end: the enrollment lock is taken
 * first, the authoritative facts are read under it, the pure Domain decision is
 * evaluated once, and only then does anything get written. Refusals write
 * nothing; a record with an abandoned zero-work session deletes that session and
 * inserts the fact in the SAME transaction; undo deletes the fact and nothing
 * else.
 *
 * Nothing here fakes concurrency: the lock proof runs a peer transaction that
 * takes the very same `FOR NO KEY UPDATE` lock on the enrollment row and holds
 * it until the test releases it, so the repository's wait is real.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  type EnrollmentId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { DrizzleRunOccurrenceWrites } from '@/infrastructure/database/repositories/drizzle-run-occurrence-writes';
import * as schema from '@/infrastructure/database/schema';

import { countFacts, insertFact } from './not-performed-fixtures';
import {
  enrollmentIdValue,
  listOccurrences,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import {
  client,
  closeDatabase,
  resetAndSeed,
  runOccurrenceWrites,
  workoutSessionRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';
import { insertSession } from './session-fixtures';

const OWNER = 'settlement-owner';
const OTHER_OWNER = 'settlement-other-owner';
const PROGRAM_SLUG = 'fit40-beginner-strength';
const RUN = enrollmentIdValue('enr-settlement-a');
const OTHER_RUN = enrollmentIdValue('enr-settlement-b');
const RECORDED_AT = '2026-09-28T18:30:00.000Z';

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

function ownerId(value: string) {
  const result = createUserId(value);
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

/** The first three authored occurrences of the seeded run. */
function occurrencesOf(fixture: PlannedRunFixture): readonly [string, string, string] {
  const [first, second, third] = fixture.occurrenceIds;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('expected at least three authored occurrences');
  }
  return [first, second, third];
}

/** The authored template of an occurrence, read from the seeded program. */
function workoutIdFor(fixture: PlannedRunFixture, scheduledWorkoutIdValue: string): string {
  const occurrence = listOccurrences(fixture.program).find(
    (candidate) => candidate.id === scheduledWorkoutIdValue,
  );
  if (occurrence === undefined) throw new Error(`occurrence "${scheduledWorkoutIdValue}" missing`);
  return occurrence.workoutId;
}

/** A real in-progress session for one authored occurrence of a run. */
function buildSession(
  fixture: PlannedRunFixture,
  id: string,
  occurrence: string,
  enrollmentId: EnrollmentId,
  owner = OWNER,
): WorkoutSession {
  const created = createWorkoutSession({
    id,
    userId: ownerId(owner),
    enrollmentId,
    scheduledWorkoutId: scheduledWorkoutId(occurrence),
    workoutId: workoutId(workoutIdFor(fixture, occurrence)),
    startedAt: new Date('2026-09-21T10:00:00Z'),
    exerciseLogs: [
      {
        authoredExerciseId: exerciseId('ex-002'),
        order: 1,
        prescription: reps(),
        restSeconds: 90,
      },
    ],
  });
  if (!created.ok) throw new Error(created.error.message);
  return created.data;
}

async function countRows(
  table: 'workout_sessions' | 'exercise_logs' | 'set_logs',
): Promise<number> {
  const rows = await client<{ count: string }[]>`
    SELECT count(*)::text AS count FROM ${client(table)}
  `;
  const [row] = rows;
  if (row === undefined) throw new Error('count(*) returned no row');
  return Number.parseInt(row.count, 10);
}

afterAll(async () => {
  await closeDatabase();
});

describe('RunOccurrenceWrites.recordNotPerformed', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('records an occurrence with no session, without deleting anything', async () => {
    const [first] = occurrencesOf(run);

    const outcome = await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      recordedAt: new Date(RECORDED_AT),
    });

    expect(outcome).toEqual({ kind: 'record', deletesAbandonedSession: false });
    expect(await countFacts(RUN)).toBe(1);
    expect(await countRows('workout_sessions')).toBe(0);
  });

  it('persists exactly the supplied recorded instant', async () => {
    const [first] = occurrencesOf(run);
    const supplied = new Date('2026-10-02T05:04:03.123Z');

    await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      recordedAt: supplied,
    });

    const rows = await client<{ recorded_at: Date | string }[]>`
      SELECT recorded_at FROM not_performed_workouts
      WHERE enrollment_id = ${RUN} AND scheduled_workout_id = ${first}
    `;
    const [row] = rows;
    if (row === undefined) throw new Error('expected the fact');
    expect(new Date(row.recorded_at).toISOString()).toBe('2026-10-02T05:04:03.123Z');
  });

  it('deletes an abandoned zero-work session and records the fact in one transaction', async () => {
    const [first] = occurrencesOf(run);
    const abandoned = buildSession(run, 'session-abandoned', first, RUN);
    await insertSession(abandoned);
    expect(await countRows('workout_sessions')).toBe(1);
    expect(await countRows('exercise_logs')).toBe(1);

    const outcome = await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      recordedAt: new Date(RECORDED_AT),
    });

    expect(outcome).toEqual({ kind: 'record', deletesAbandonedSession: true });
    // The session and its session-owned children are gone…
    expect(await workoutSessionRepository.findById(abandoned.id)).toBeNull();
    expect(await countRows('workout_sessions')).toBe(0);
    expect(await countRows('exercise_logs')).toBe(0);
    expect(await countRows('set_logs')).toBe(0);
    // …and the fact is there, exactly once.
    expect(await countFacts(RUN)).toBe(1);
  });

  it('keeps the guarded delete defensive: performed work can never match it', async () => {
    const [first, second] = occurrencesOf(run);

    // A session with logged work…
    const trained = buildSession(run, 'session-guard-work', first, RUN);
    const logged = logSessionSet(trained, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 30,
      rpe: 8,
    });
    if (!logged.ok) throw new Error(logged.error.message);
    await insertSession(logged.data);

    // …and an abandoned one with no work at all.
    const abandoned = buildSession(run, 'session-guard-empty', second, RUN);
    await insertSession(abandoned);

    // The exact predicate the settlement DELETE carries, executed directly: it
    // is a safety assertion, so it must match the zero-work session and never
    // the trained one — even if a future decision were wrong about the facts.
    const guardedDelete = async (
      sessionId: string,
      occurrence: string,
    ): Promise<ReadonlyArray<{ id: string }>> =>
      client<{ id: string }[]>`
        DELETE FROM workout_sessions
        WHERE id = ${sessionId}
          AND enrollment_id = ${RUN}
          AND scheduled_workout_id = ${occurrence}
          AND completed_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM set_logs WHERE set_logs.session_id = workout_sessions.id)
        RETURNING id
      `;

    expect(await guardedDelete(trained.id, first)).toHaveLength(0);
    expect(await countRows('set_logs')).toBe(1);

    expect(await guardedDelete(abandoned.id, second)).toHaveLength(1);
    expect(await countRows('workout_sessions')).toBe(1);
  });

  it('refuses a session that holds logged work, leaving every row untouched', async () => {
    const [first] = occurrencesOf(run);
    const session = buildSession(run, 'session-logged', first, RUN);
    const logged = logSessionSet(session, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: 7,
    });
    if (!logged.ok) throw new Error(logged.error.message);
    const persisted = await insertSession(logged.data);

    const outcome = await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      recordedAt: new Date(RECORDED_AT),
    });

    expect(outcome).toEqual({ kind: 'refuse', reason: 'has-logged-work' });
    expect(await countFacts(RUN)).toBe(0);
    const stored = await workoutSessionRepository.findById(session.id);
    expect(stored?.version).toBe(persisted.version);
    expect(stored?.exerciseLogs[0]?.sets).toHaveLength(1);
    expect(await countRows('set_logs')).toBe(1);
  });

  it('refuses a completed session as already performed, leaving every row untouched', async () => {
    const [first] = occurrencesOf(run);
    const session = buildSession(run, 'session-completed', first, RUN);
    const logged = logSessionSet(session, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: null,
    });
    if (!logged.ok) throw new Error(logged.error.message);
    const done = completeWorkoutSession(logged.data, new Date('2026-09-21T11:00:00Z'));
    if (!done.ok) throw new Error(done.error.message);
    await insertSession(done.data);

    const outcome = await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      recordedAt: new Date(RECORDED_AT),
    });

    expect(outcome).toEqual({ kind: 'refuse', reason: 'already-performed' });
    expect(await countFacts(RUN)).toBe(0);
    const stored = await workoutSessionRepository.findById(session.id);
    expect(stored?.completedAt?.toISOString()).toBe('2026-09-21T11:00:00.000Z');
    expect(stored?.exerciseLogs[0]?.sets).toHaveLength(1);
  });

  it('refuses an occurrence that is already recorded, without touching its instant', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({
      enrollmentId: RUN,
      scheduledWorkoutId: first,
      recordedAt: '2026-09-01T08:00:00.000Z',
    });

    const outcome = await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      recordedAt: new Date(RECORDED_AT),
    });

    expect(outcome).toEqual({ kind: 'refuse', reason: 'already-recorded' });
    expect(await countFacts(RUN)).toBe(1);
    const rows = await client<{ recorded_at: Date | string }[]>`
      SELECT recorded_at FROM not_performed_workouts WHERE enrollment_id = ${RUN}
    `;
    const [row] = rows;
    if (row === undefined) throw new Error('expected the fact');
    expect(new Date(row.recorded_at).toISOString()).toBe('2026-09-01T08:00:00.000Z');
  });

  it('reports run-vanished when the enrollment does not exist, writing nothing', async () => {
    const [first] = occurrencesOf(run);

    const outcome = await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: enrollmentIdValue('enr-does-not-exist'),
      scheduledWorkoutId: scheduledWorkoutId(first),
      recordedAt: new Date(RECORDED_AT),
    });

    expect(outcome).toEqual({ kind: 'run-vanished' });
    expect(await countRows('workout_sessions')).toBe(0);
    expect(await countFacts(RUN)).toBe(0);
  });

  it('touches only the addressed run and occurrence', async () => {
    const [first, second] = occurrencesOf(run);
    await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    await insertFact({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: first,
      recordedAt: '2026-09-05T09:00:00.000Z',
    });

    const outcome = await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(second),
      recordedAt: new Date(RECORDED_AT),
    });

    expect(outcome).toEqual({ kind: 'record', deletesAbandonedSession: false });
    // The other run keeps exactly its own fact, with its own instant…
    expect(await countFacts(OTHER_RUN)).toBe(1);
    const otherRows = await client<{ recorded_at: Date | string }[]>`
      SELECT recorded_at FROM not_performed_workouts WHERE enrollment_id = ${OTHER_RUN}
    `;
    const [otherRow] = otherRows;
    if (otherRow === undefined) throw new Error('expected the other run fact');
    expect(new Date(otherRow.recorded_at).toISOString()).toBe('2026-09-05T09:00:00.000Z');
    // …and the addressed run holds only the fact for the addressed occurrence.
    expect(await countFacts(RUN)).toBe(1);
    const runRows = await client<{ scheduled_workout_id: string }[]>`
      SELECT scheduled_workout_id FROM not_performed_workouts WHERE enrollment_id = ${RUN}
    `;
    expect(runRows.map((row) => row.scheduled_workout_id)).toEqual([second]);
  });

  it('leaves completed and detached historical sessions untouched', async () => {
    const [first, second, third] = occurrencesOf(run);

    // A completed session for one occurrence…
    const completed = buildSession(run, 'session-history', first, RUN);
    const loggedCompleted = logSessionSet(completed, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 10,
      weightKg: 20,
      rpe: null,
    });
    if (!loggedCompleted.ok) throw new Error(loggedCompleted.error.message);
    const done = completeWorkoutSession(loggedCompleted.data, new Date('2026-09-21T11:00:00Z'));
    if (!done.ok) throw new Error(done.error.message);
    await insertSession(done.data);

    // …and a detached one (a leftover of a leave) for another occurrence.
    const detached = buildSession(run, 'session-detached', second, RUN);
    await insertSession(detached);
    await client`UPDATE workout_sessions SET enrollment_id = NULL WHERE id = ${detached.id}`;

    const outcome = await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(third),
      recordedAt: new Date(RECORDED_AT),
    });

    expect(outcome).toEqual({ kind: 'record', deletesAbandonedSession: false });
    const storedCompleted = await workoutSessionRepository.findById(completed.id);
    expect(storedCompleted?.completedAt?.toISOString()).toBe('2026-09-21T11:00:00.000Z');
    const storedDetached = await workoutSessionRepository.findById(detached.id);
    expect(storedDetached?.enrollmentId).toBeNull();
    expect(await countRows('workout_sessions')).toBe(2);
    expect(await countFacts(RUN)).toBe(1);
  });
});

describe('RunOccurrenceWrites.undoNotPerformed', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('deletes the fact and nothing else', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    const outcome = await runOccurrenceWrites.undoNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
    });

    expect(outcome).toEqual({ kind: 'undo' });
    expect(await countFacts(RUN)).toBe(0);
    // Undo never recreates a session (record may have deleted one).
    expect(await countRows('workout_sessions')).toBe(0);
  });

  it('does not resurrect a session that recording deleted', async () => {
    const [first] = occurrencesOf(run);
    const abandoned = buildSession(run, 'session-undo', first, RUN);
    await insertSession(abandoned);
    await runOccurrenceWrites.recordNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      recordedAt: new Date(RECORDED_AT),
    });

    const outcome = await runOccurrenceWrites.undoNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
    });

    expect(outcome).toEqual({ kind: 'undo' });
    expect(await countFacts(RUN)).toBe(0);
    expect(await workoutSessionRepository.findById(abandoned.id)).toBeNull();
    expect(await countRows('workout_sessions')).toBe(0);
  });

  it('refuses an occurrence with no fact, writing nothing', async () => {
    const [first, second] = occurrencesOf(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    const outcome = await runOccurrenceWrites.undoNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(second),
    });

    expect(outcome).toEqual({ kind: 'refuse', reason: 'not-recorded' });
    expect(await countFacts(RUN)).toBe(1);
  });

  it('reports run-vanished when the enrollment does not exist', async () => {
    const [first] = occurrencesOf(run);

    const outcome = await runOccurrenceWrites.undoNotPerformed({
      enrollmentId: enrollmentIdValue('enr-does-not-exist'),
      scheduledWorkoutId: scheduledWorkoutId(first),
    });

    expect(outcome).toEqual({ kind: 'run-vanished' });
    expect(await countFacts(RUN)).toBe(0);
  });

  it('leaves another run’s fact alone', async () => {
    const [first] = occurrencesOf(run);
    await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });
    await insertFact({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: first,
      recordedAt: '2026-09-06T09:00:00.000Z',
    });

    const outcome = await runOccurrenceWrites.undoNotPerformed({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
    });

    expect(outcome).toEqual({ kind: 'undo' });
    expect(await countFacts(RUN)).toBe(0);
    expect(await countFacts(OTHER_RUN)).toBe(1);
  });
});

describe('RunOccurrenceWrites — bounded statement shapes', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  /**
   * Runs `observe` against a dedicated counting client. Only data statements
   * are counted (transaction control is excluded) and the connection is warmed
   * first, so postgres.js' one-time introspection is not part of any count.
   */
  async function withQueryLog<T>(
    observe: (writes: DrizzleRunOccurrenceWrites, queries: string[]) => Promise<T>,
  ): Promise<T> {
    const queries: string[] = [];
    const countingClient = postgres(getTestDatabaseUrl(), {
      max: 1,
      debug: (_connection: number, query: string) => {
        const normalized = query.trim().toLowerCase();
        if (/^(select|insert|update|delete)/.test(normalized)) {
          queries.push(normalized);
        }
      },
    });

    try {
      const writes = new DrizzleRunOccurrenceWrites(drizzle(countingClient, { schema }));
      const [first] = occurrencesOf(run);
      // Warm the connection with a call that touches no state at all: an
      // unknown enrollment returns `run-vanished` before any read of the run.
      const warmup = await writes.recordNotPerformed({
        enrollmentId: enrollmentIdValue('enr-warmup-does-not-exist'),
        scheduledWorkoutId: scheduledWorkoutId(first),
        recordedAt: new Date(RECORDED_AT),
      });
      expect(warmup).toEqual({ kind: 'run-vanished' });
      queries.length = 0;
      return await observe(writes, queries);
    } finally {
      await countingClient.end();
    }
  }

  it('refuses with the lock and the diagnostic read only', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    await withQueryLog(async (writes, queries) => {
      const outcome = await writes.recordNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        recordedAt: new Date(RECORDED_AT),
      });

      expect(outcome).toEqual({ kind: 'refuse', reason: 'already-recorded' });
      expect(queries).toHaveLength(2);
      // Parent-first: the enrollment row is locked BEFORE anything else.
      expect(queries[0]).toContain('from "program_enrollments"');
      expect(queries[0]).toContain('for no key update');
      expect(queries[0]?.includes('workout_sessions')).toBe(false);
      expect(queries[0]?.includes('not_performed_workouts')).toBe(false);
      // ONE diagnostic statement brings back both sides.
      expect(queries[1]?.startsWith('select')).toBe(true);
      expect(queries[1]).toContain('not_performed_workouts');
      expect(queries[1]).toContain('workout_sessions');
      expect(queries[1]).toContain('set_logs');
    });
  });

  it('records without a session with lock, diagnostic and insert', async () => {
    const [first] = occurrencesOf(run);

    await withQueryLog(async (writes, queries) => {
      const outcome = await writes.recordNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        recordedAt: new Date(RECORDED_AT),
      });

      expect(outcome).toEqual({ kind: 'record', deletesAbandonedSession: false });
      expect(queries).toHaveLength(3);
      expect(queries[0]).toContain('for no key update');
      expect(queries[2]?.startsWith('insert into "not_performed_workouts"')).toBe(true);
      expect(queries[2]).toContain('on conflict do nothing');
    });
  });

  it('records an abandoned session with lock, diagnostic, guarded delete and insert', async () => {
    const [first] = occurrencesOf(run);
    await insertSession(buildSession(run, 'session-budget', first, RUN));

    await withQueryLog(async (writes, queries) => {
      const outcome = await writes.recordNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        recordedAt: new Date(RECORDED_AT),
      });

      expect(outcome).toEqual({ kind: 'record', deletesAbandonedSession: true });
      expect(queries).toHaveLength(4);
      expect(queries[0]).toContain('for no key update');
      // The guarded delete carries its safety predicate (not completed, no
      // logged work) — the SQL can only confirm the decision.
      expect(queries[2]?.startsWith('delete from "workout_sessions"')).toBe(true);
      expect(queries[2]).toContain('completed_at" is null');
      expect(queries[2]).toContain('not exists');
      expect(queries[3]?.startsWith('insert into "not_performed_workouts"')).toBe(true);
    });
  });

  it('undoes with lock, existence read and the fact delete only', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({ enrollmentId: RUN, scheduledWorkoutId: first, recordedAt: RECORDED_AT });

    await withQueryLog(async (writes, queries) => {
      const outcome = await writes.undoNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
      });

      expect(outcome).toEqual({ kind: 'undo' });
      expect(queries).toHaveLength(3);
      expect(queries[0]).toContain('for no key update');
      expect(queries[1]?.startsWith('select')).toBe(true);
      expect(queries[1]).toContain('not_performed_workouts');
      expect(queries[2]?.startsWith('delete from "not_performed_workouts"')).toBe(true);
    });
  });

  it('refuses an undo with the lock and the existence read only', async () => {
    const [first] = occurrencesOf(run);

    await withQueryLog(async (writes, queries) => {
      const outcome = await writes.undoNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
      });

      expect(outcome).toEqual({ kind: 'refuse', reason: 'not-recorded' });
      expect(queries).toHaveLength(2);
    });
  });
});

/** A one-shot gate: created closed, opened once by its owner. */
function createGate(): { readonly opened: Promise<void>; readonly open: () => void } {
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

const PENDING = 'pending' as const;

/**
 * Waits up to `ms` for `observed`. Resolving with `PENDING` proves the promise
 * is still blocked; any rejection surfaces through the awaits that follow.
 */
async function settleWithin<T>(observed: Promise<T>, ms: number): Promise<T | typeof PENDING> {
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

/**
 * Holds a dedicated transaction that has taken the run's parent enrollment lock
 * (the very statement the repository issues) until `release()` is called. `work`
 * runs after the lock is acquired, so a test can reproduce what a peer
 * settlement writer would have committed inside its own transaction.
 */
async function holdEnrollmentLock(input: {
  readonly sql: postgres.Sql;
  readonly enrollmentId: EnrollmentId;
  readonly work?: (tx: postgres.TransactionSql) => Promise<void>;
}): Promise<{ readonly release: () => Promise<void> }> {
  const held = createGate();
  const released = createGate();

  const done = input.sql.begin(async (tx) => {
    await tx`SELECT id FROM program_enrollments WHERE id = ${input.enrollmentId} FOR NO KEY UPDATE`;
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
 * The lock proof: the settlement transaction genuinely queues behind the
 * enrollment row lock, and it reads its facts AFTER acquiring it.
 *
 * This is deliberately the smallest real-database proof of the lock itself. The
 * full cross-table race matrix (record vs start, restart, leave, regenerate,
 * complete, log-set) belongs to the M17 verification slice, which can only run
 * once `createSessionForOccurrence` joins this same lock in the next slice.
 */
describe('RunOccurrenceWrites — the enrollment lock is real', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('waits for a peer holding the enrollment lock, then records', async () => {
    const [first] = occurrencesOf(run);
    const pool = postgres(getTestDatabaseUrl(), { max: 4 });

    try {
      const holder = await holdEnrollmentLock({ sql: pool, enrollmentId: RUN });
      const writes = new DrizzleRunOccurrenceWrites(drizzle(pool, { schema }));

      const call = writes.recordNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        recordedAt: new Date(RECORDED_AT),
      });

      // Nothing has happened yet: the transaction cannot even read.
      expect(await settleWithin(call, 300)).toBe(PENDING);
      expect(await countFacts(RUN)).toBe(0);

      await holder.release();

      expect(await call).toEqual({ kind: 'record', deletesAbandonedSession: false });
      expect(await countFacts(RUN)).toBe(1);
    } finally {
      await pool.end();
    }
  });

  it('reads its facts under the lock: a fact the peer committed is refused', async () => {
    const [first] = occurrencesOf(run);
    const pool = postgres(getTestDatabaseUrl(), { max: 4 });

    try {
      // The peer holds the lock and records the same occurrence, uncommitted.
      const holder = await holdEnrollmentLock({
        sql: pool,
        enrollmentId: RUN,
        work: async (tx) => {
          await tx`
            INSERT INTO not_performed_workouts (enrollment_id, scheduled_workout_id, recorded_at)
            VALUES (${RUN}, ${first}, ${'2026-09-07T00:00:00Z'}::timestamptz)
          `;
        },
      });

      const writes = new DrizzleRunOccurrenceWrites(drizzle(pool, { schema }));
      const call = writes.recordNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        recordedAt: new Date(RECORDED_AT),
      });

      expect(await settleWithin(call, 300)).toBe(PENDING);

      await holder.release();

      // The repository decided on the facts it read AFTER taking the lock, so
      // it sees the peer's committed fact and refuses instead of recording a
      // second one or acting on a pre-lock read.
      expect(await call).toEqual({ kind: 'refuse', reason: 'already-recorded' });
      expect(await countFacts(RUN)).toBe(1);
    } finally {
      await pool.end();
    }
  });
});