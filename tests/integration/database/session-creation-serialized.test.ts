/**
 * M17 Slice 6 — enrollment-serialized workout-session creation, on real
 * PostgreSQL.
 *
 * Proves that starting a session joined the SAME mutation authority as the
 * not-performed settlement: one transaction, the run's enrollment row locked
 * `FOR NO KEY UPDATE` FIRST, the occurrence's fact read under that lock, and only
 * then an INSERT. Nothing is read before the lock and nothing is written before
 * the fact check, so a settled occurrence is refused with ZERO writes instead of
 * being detected after a doomed insert.
 *
 * Nothing here fakes concurrency: the race proofs run a peer transaction that
 * takes the very same enrollment lock and holds it until the test releases it,
 * so the repository's wait is real and the two orderings (record first, start
 * first) are both pinned.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import {
  SessionAlreadyExistsError,
  SessionOccurrenceKeyConflictError,
} from '@/application/ports/workout-session-repository';
import {
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
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
import { insertSession } from './session-fixtures';
import { client, closeDatabase, resetAndSeed, runOccurrenceWrites, workoutSessionRepository } from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'session-creation-owner';
const OTHER_OWNER = 'session-creation-other-owner';
const PROGRAM_SLUG = 'fit40-beginner-strength';
const RUN = enrollmentIdValue('enr-session-creation-a');
const OTHER_RUN = enrollmentIdValue('enr-session-creation-b');

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

/** A brand-new aggregate for one authored occurrence, as the start path builds it. */
function buildSession(
  fixture: PlannedRunFixture,
  id: string,
  occurrence: string,
  enrollmentId: EnrollmentId,
  owner = OWNER,
  options: { readonly secondLog?: boolean } = {},
): WorkoutSession {
  const created = createWorkoutSession({
    id,
    userId: ownerId(owner),
    enrollmentId,
    scheduledWorkoutId: scheduledWorkoutId(occurrence),
    workoutId: workoutId(workoutIdFor(fixture, occurrence)),
    startedAt: new Date('2026-09-21T10:00:00Z'),
    exerciseLogs: options.secondLog
      ? [
          { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
          { authoredExerciseId: exerciseId('ex-015'), order: 2, prescription: reps(), restSeconds: 60 },
        ]
      : [
          { authoredExerciseId: exerciseId('ex-002'), order: 1, prescription: reps(), restSeconds: 90 },
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

/** The persisted aggregate, read through the port's own hydration. */
function findSession(id: string) {
  const sessionId = createWorkoutSessionId(id);
  if (!sessionId.ok) throw new Error(sessionId.error.message);
  return workoutSessionRepository.findById(sessionId.data);
}

afterAll(async () => {
  await closeDatabase();
});

describe('RunOccurrenceWrites.createSessionForOccurrence', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('creates the aggregate with its children and the snapshot version', async () => {
    const [first] = occurrencesOf(run);
    const session = buildSession(run, 'session-created', first, RUN);

    const outcome = await runOccurrenceWrites.createSessionForOccurrence({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      session,
    });

    expect(outcome.kind).toBe('created');
    if (outcome.kind !== 'created') return;

    // A first INSERT stores the snapshot's own version — the Application built
    // this aggregate, and creation does not advance a version that never was.
    expect(outcome.session.version).toBe(session.version);
    expect(outcome.session.id).toBe(session.id);

    expect(await countRows('workout_sessions')).toBe(1);
    expect(await countRows('exercise_logs')).toBe(1);
    expect(await countRows('set_logs')).toBe(0);

    // The persisted aggregate is the snapshot: same ownership and authored
    // identity, same prescription snapshot, no logged work yet.
    const hydrated = await findSession('session-created');
    expect(hydrated).not.toBeNull();
    expect(hydrated?.enrollmentId).toBe(RUN);
    expect(hydrated?.scheduledWorkoutId).toBe(first);
    expect(hydrated?.version).toBe(session.version);
    expect(hydrated?.exerciseLogs).toHaveLength(1);
    expect(hydrated?.exerciseLogs[0]?.occurrenceKey).toBe(1);
    expect(hydrated?.exerciseLogs[0]?.prescription).toEqual(session.exerciseLogs[0]?.prescription);
    expect(hydrated?.nextOccurrenceKey).toBe(session.nextOccurrenceKey);
  });

  it('inserts every child row of a session that already carries logged work', async () => {
    const [first] = occurrencesOf(run);
    const session = buildSession(run, 'session-with-set', first, RUN, OWNER, { secondLog: true });
    const logged = logSessionSet(session, {
      exerciseOrder: 2,
      type: 'reps',
      reps: 8,
      weightKg: 30,
      rpe: 7,
    });
    if (!logged.ok) throw new Error(logged.error.message);

    const outcome = await runOccurrenceWrites.createSessionForOccurrence({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      session: logged.data,
    });

    expect(outcome.kind).toBe('created');
    expect(await countRows('exercise_logs')).toBe(2);
    expect(await countRows('set_logs')).toBe(1);

    const hydrated = await findSession('session-with-set');
    expect(hydrated?.exerciseLogs[1]?.sets).toHaveLength(1);
    expect(hydrated?.exerciseLogs[1]?.sets[0]).toMatchObject({ reps: 8, weightKg: 30, rpe: 7 });
  });

  it('refuses a settled occurrence with ZERO writes', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({
      enrollmentId: RUN,
      scheduledWorkoutId: first,
      recordedAt: '2026-09-28T18:30:00.000Z',
    });

    const outcome = await runOccurrenceWrites.createSessionForOccurrence({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      session: buildSession(run, 'session-blocked', first, RUN),
    });

    expect(outcome).toEqual({ kind: 'recorded-not-performed' });
    expect(await countRows('workout_sessions')).toBe(0);
    expect(await countRows('exercise_logs')).toBe(0);
    expect(await countRows('set_logs')).toBe(0);
    expect(await countFacts(RUN)).toBe(1);
  });

  it('returns run-vanished for a missing enrollment with zero writes', async () => {
    const [first] = occurrencesOf(run);
    const missing = enrollmentIdValue('enr-session-creation-missing');

    const outcome = await runOccurrenceWrites.createSessionForOccurrence({
      enrollmentId: missing,
      scheduledWorkoutId: scheduledWorkoutId(first),
      session: buildSession(run, 'session-orphan', first, missing),
    });

    expect(outcome).toEqual({ kind: 'run-vanished' });
    expect(await countRows('workout_sessions')).toBe(0);
    expect(await countRows('exercise_logs')).toBe(0);
  });
});


describe('RunOccurrenceWrites.createSessionForOccurrence — constraint outcomes and isolation', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('keeps the established duplicate-session outcome and leaves the first session intact', async () => {
    const [first] = occurrencesOf(run);
    const existing = await insertSession(buildSession(run, 'session-existing', first, RUN));

    await expect(
      runOccurrenceWrites.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: buildSession(run, 'session-duplicate', first, RUN),
      }),
    ).rejects.toBeInstanceOf(SessionAlreadyExistsError);

    // The duplicate wrote nothing: one session, one child log, same version and
    // start instant as the row that already existed.
    expect(await countRows('workout_sessions')).toBe(1);
    expect(await countRows('exercise_logs')).toBe(1);
    const stored = await findSession('session-existing');
    expect(stored?.version).toBe(existing.version);
    expect(stored?.startedAt.toISOString()).toBe(existing.startedAt.toISOString());
    expect(await findSession('session-duplicate')).toBeNull();
  });

  it('keeps the established occurrence-key conflict outcome and rolls the insert back', async () => {
    const [first] = occurrencesOf(run);
    const session = buildSession(run, 'session-key-conflict', first, RUN, OWNER, {
      secondLog: true,
    });
    // A collision the Domain factory would never build: only a hand-built
    // aggregate can reach the database with two equal non-null occurrence keys.
    const conflicted: WorkoutSession = {
      ...session,
      exerciseLogs: session.exerciseLogs.map((log) => ({ ...log, occurrenceKey: 1 })),
    };

    await expect(
      runOccurrenceWrites.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: conflicted,
      }),
    ).rejects.toBeInstanceOf(SessionOccurrenceKeyConflictError);

    // One transaction: the parent INSERT is rolled back with its children.
    expect(await countRows('workout_sessions')).toBe(0);
    expect(await countRows('exercise_logs')).toBe(0);
  });

  it("another enrollment's fact does not block this run", async () => {
    const [first] = occurrencesOf(run);
    await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    await insertFact({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: first,
      recordedAt: '2026-09-28T18:30:00.000Z',
    });

    const outcome = await runOccurrenceWrites.createSessionForOccurrence({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      session: buildSession(run, 'session-cross-run', first, RUN),
    });

    expect(outcome.kind).toBe('created');
    expect(await countFacts(OTHER_RUN)).toBe(1);
    expect(await findSession('session-cross-run')).not.toBeNull();
  });

  it("another occurrence's fact does not block this occurrence", async () => {
    const [first, second] = occurrencesOf(run);
    await insertFact({
      enrollmentId: RUN,
      scheduledWorkoutId: second,
      recordedAt: '2026-09-28T18:30:00.000Z',
    });

    const outcome = await runOccurrenceWrites.createSessionForOccurrence({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      session: buildSession(run, 'session-other-occurrence', first, RUN),
    });

    expect(outcome.kind).toBe('created');
    expect(await countRows('workout_sessions')).toBe(1);
  });

  it("another enrollment's session for the same occurrence does not block this run", async () => {
    const [first] = occurrencesOf(run);
    await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    await insertSession(buildSession(run, 'session-other-run', first, OTHER_RUN, OTHER_OWNER));

    const outcome = await runOccurrenceWrites.createSessionForOccurrence({
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutId(first),
      session: buildSession(run, 'session-own-run', first, RUN),
    });

    expect(outcome.kind).toBe('created');
    expect(await countRows('workout_sessions')).toBe(2);
  });

  it('rejects an aggregate that does not belong to the locked run and occurrence', async () => {
    const [first, second] = occurrencesOf(run);

    await expect(
      runOccurrenceWrites.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: buildSession(run, 'session-mismatch', second, RUN),
      }),
    ).rejects.toThrow(/not /);

    expect(await countRows('workout_sessions')).toBe(0);
  });
});


describe('RunOccurrenceWrites.createSessionForOccurrence — bounded statement shapes', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  /**
   * Runs `observe` against a dedicated counting client. Only data statements are
   * counted (transaction control is excluded) and the connection is warmed
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
      const missing = enrollmentIdValue('enr-warmup-does-not-exist');
      const warmup = await writes.createSessionForOccurrence({
        enrollmentId: missing,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: buildSession(run, 'session-warmup', first, missing),
      });
      expect(warmup).toEqual({ kind: 'run-vanished' });
      queries.length = 0;
      return await observe(writes, queries);
    } finally {
      await countingClient.end();
    }
  }

  it('locks the enrollment first, then reads the fact, then inserts', async () => {
    const [first] = occurrencesOf(run);

    await withQueryLog(async (writes, queries) => {
      const outcome = await writes.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: buildSession(run, 'session-budget', first, RUN),
      });

      expect(outcome.kind).toBe('created');
      expect(queries).toHaveLength(4);
      // Parent-first: the enrollment row is locked BEFORE anything else — no
      // session and no fact is read before it.
      expect(queries[0]).toContain('from "program_enrollments"');
      expect(queries[0]).toContain('for no key update');
      expect(queries[0]?.includes('workout_sessions')).toBe(false);
      expect(queries[0]?.includes('not_performed_workouts')).toBe(false);
      // ONE explicit fact read, under the lock, before any write.
      expect(queries[1]?.startsWith('select')).toBe(true);
      expect(queries[1]).toContain('not_performed_workouts');
      // Then the INSERT, with no upsert and no conflict clause: a duplicate is
      // refused by the database rather than merged.
      expect(queries[2]?.startsWith('insert into "workout_sessions"')).toBe(true);
      expect(queries[2]).toContain('returning');
      expect(queries[2]).not.toContain('on conflict');
      expect(queries[3]?.startsWith('insert into "exercise_logs"')).toBe(true);
    });
  });

  it('refuses a settled occurrence with the lock and the fact read only', async () => {
    const [first] = occurrencesOf(run);
    await insertFact({
      enrollmentId: RUN,
      scheduledWorkoutId: first,
      recordedAt: '2026-09-28T18:30:00.000Z',
    });

    await withQueryLog(async (writes, queries) => {
      const outcome = await writes.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: buildSession(run, 'session-refused-budget', first, RUN),
      });

      expect(outcome).toEqual({ kind: 'recorded-not-performed' });
      expect(queries).toHaveLength(2);
      expect(queries[0]).toContain('for no key update');
      expect(queries[1]).toContain('not_performed_workouts');
    });
  });

  it('budgets statements by the aggregate it persists, never by the run size', async () => {
    const [first, second] = occurrencesOf(run);

    const oneChild = await withQueryLog(async (writes, queries) => {
      const outcome = await writes.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: buildSession(run, 'session-budget-one', first, RUN),
      });
      expect(outcome.kind).toBe('created');
      return queries.length;
    });

    const twoChildrenAndASet = await withQueryLog(async (writes, queries) => {
      const session = buildSession(run, 'session-budget-two', second, RUN, OWNER, {
        secondLog: true,
      });
      const logged = logSessionSet(session, {
        exerciseOrder: 2,
        type: 'reps',
        reps: 8,
        weightKg: 30,
        rpe: 7,
      });
      if (!logged.ok) throw new Error(logged.error.message);

      const outcome = await writes.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(second),
        session: logged.data,
      });
      expect(outcome.kind).toBe('created');
      return queries.length;
    });

    // lock + fact read + parent INSERT + one INSERT per log + one per set: the
    // occurrence count of the run never enters the budget.
    expect(oneChild).toBe(4);
    expect(twoChildrenAndASet).toBe(6);
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
 * (the very statement both mutation authorities issue) until `release()` is
 * called. `work` runs after the lock is acquired, so a test can reproduce what a
 * peer writer would have committed inside its own transaction.
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
 * The cross-table race this slice closes: START SESSION vs RECORD NOT PERFORMED.
 *
 * Both writers serialize on the run's enrollment row, so the loser always
 * observes the winner's committed state. Both orderings are pinned against a
 * real PostgreSQL lock — not by calling the methods sequentially, but by making
 * the second writer wait on a peer transaction that holds the lock.
 */
describe('START vs RECORD — one serialization point', () => {
  let run: PlannedRunFixture;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
  });

  it('record wins first: start sees the fact and inserts zero session rows', async () => {
    const [first] = occurrencesOf(run);
    const pool = postgres(getTestDatabaseUrl(), { max: 4 });

    try {
      // The peer is a settlement writer that records the fact and commits it
      // first, while holding the enrollment lock.
      const holder = await holdEnrollmentLock({
        sql: pool,
        enrollmentId: RUN,
        work: async (tx) => {
          await tx`
            INSERT INTO not_performed_workouts (enrollment_id, scheduled_workout_id, recorded_at)
            VALUES (${RUN}, ${first}, ${'2026-09-28T18:30:00Z'}::timestamptz)
          `;
        },
      });

      const writes = new DrizzleRunOccurrenceWrites(drizzle(pool, { schema }));
      const create = writes.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: buildSession(run, 'session-loses-race', first, RUN),
      });

      // It cannot even read yet: the start path queues behind the record.
      expect(await settleWithin(create, 300)).toBe(PENDING);

      await holder.release();

      expect(await create).toEqual({ kind: 'recorded-not-performed' });
      expect(await countFacts(RUN)).toBe(1);
      expect(await countRows('workout_sessions')).toBe(0);
      expect(await countRows('exercise_logs')).toBe(0);
      expect(await countRows('set_logs')).toBe(0);
    } finally {
      await pool.end();
    }
  });

  it('start wins first: the later record deletes the zero-set session it finds', async () => {
    const [first] = occurrencesOf(run);
    const pool = postgres(getTestDatabaseUrl(), { max: 4 });

    try {
      const holder = await holdEnrollmentLock({ sql: pool, enrollmentId: RUN });
      const writes = new DrizzleRunOccurrenceWrites(drizzle(pool, { schema }));
      const create = writes.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        session: buildSession(run, 'session-wins-race', first, RUN),
      });

      expect(await settleWithin(create, 300)).toBe(PENDING);

      await holder.release();

      const created = await create;
      expect(created.kind).toBe('created');
      expect(await countRows('workout_sessions')).toBe(1);
      expect(await countRows('exercise_logs')).toBe(1);
      expect(await countFacts(RUN)).toBe(0);

      // The record now goes second and must decide on what the winner left
      // behind: an in-progress session with zero logged work.
      const outcome = await runOccurrenceWrites.recordNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutId(first),
        recordedAt: new Date('2026-09-28T19:00:00.000Z'),
      });

      expect(outcome).toEqual({ kind: 'record', deletesAbandonedSession: true });
      expect(await countFacts(RUN)).toBe(1);
      expect(await countRows('workout_sessions')).toBe(0);
      expect(await countRows('exercise_logs')).toBe(0);
      expect(await countRows('set_logs')).toBe(0);
    } finally {
      await pool.end();
    }
  });
});

