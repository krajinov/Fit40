/**
 * M17 closure projection — ONE coherent database snapshot, on real PostgreSQL.
 *
 * The P2 finding this suite guards: the run-closure read used to obtain the
 * completed occurrence ids and the recorded not-performed facts through TWO
 * independent statements. Under READ COMMITTED each statement takes its own
 * snapshot, so a legitimate concurrent transition (Undo B → start B → complete
 * B, committed between the two statements) could hand the use case B in BOTH
 * sets — a contradiction the persisted state never held, which
 * `resolveRunClosure` correctly rejects. The fix: one projection statement
 * (`DrizzleRunClosureFactsRepository`), which takes exactly one snapshot.
 *
 * Every interleaving here is decided by database state, never by a sleep: the
 * writer is held mid-transaction by a gate; the read's in-flight position is
 * proven through `pg_locks` before the writer is allowed to commit. Raw
 * statements appear ONLY inside gate holders, to reproduce what a peer
 * transition commits — the projection itself is always the production one.
 *
 * Test 3 is the negative control: the retired two-statement composition is
 * driven through the SAME armed gate and DOES produce the forbidden
 * contradiction, proving the gate reproduces the bug and that the fix — not
 * a vacuous interleaving — is what removes it.
 */

import { and, eq, sql } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { resolveRunClosure, type RunClosureFacts } from '@/domain/services/run-closure';
import type { TrainingProgram } from '@/domain/entities/training-program';
import type { Database } from '@/infrastructure/database/client';
import { DrizzleRunClosureFactsRepository } from '@/infrastructure/database/repositories/drizzle-run-closure-facts-repository';
import { insertWorkoutSessionRows } from '@/infrastructure/database/repositories/workout-session-writes';
import { notPerformedWorkouts } from '@/infrastructure/database/schema';

import {
  completedOccurrenceSession,
  countRows,
  createGate,
  createRaceHarness,
  holdEnrollmentLock,
  seedConcludedRun,
  sessionRowFor,
  type RaceHarness,
} from './not-performed-race-fixtures';
import { enrollmentIdValue, scheduledWorkoutIdValue } from './planned-workout-fixtures';
import { closeDatabase, resetAndSeed } from './setup';

const OWNER = 'm17-snapshot-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-snapshot';
const RUN = enrollmentIdValue(RUN_ID);

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** The occurrence template's workout id, needed to build a real session. */
function workoutIdFor(program: TrainingProgram, occurrenceId: string) {
  for (const week of program.weeks) {
    for (const scheduled of week.scheduledWorkouts) {
      if (scheduled.id === occurrenceId) {
        const workout = program.workouts.find((candidate) => candidate.id === scheduled.workoutId);
        if (workout === undefined) throw new Error('occurrence references a missing workout');
        return workout.id;
      }
    }
  }
  throw new Error(`occurrence "${occurrenceId}" is not authored by the program`);
}
/** A dedicated pool plus the production projection bound to that pool. */
async function withHarness(run: (harness: RaceHarness) => Promise<void>): Promise<void> {
  // W's holder, the gate holder, the in-flight reader and the pg_locks
  // observer each need their own real parallel connection.
  const harness = createRaceHarness(6);
  try {
    await run(harness);
  } finally {
    await harness.end();
  }
}

/**
 * Holds the peer transition `Undo B → start B → complete B` uncommitted until
 * `release()`: the enrollment lock FIRST (the writer-side serialization the
 * production authority uses), then the fact retraction and the completed
 * session insert. Committed at release, it is exactly one valid transition.
 */
async function holdUndoStartComplete(
  harness: RaceHarness,
  program: TrainingProgram,
  occurrenceId: string,
): Promise<{ readonly release: () => Promise<void> }> {
  return holdEnrollmentLock({
    db: harness.db,
    enrollmentId: RUN,
    work: async (tx) => {
      await tx
        .delete(notPerformedWorkouts)
        .where(
          and(
            eq(notPerformedWorkouts.enrollmentId, RUN),
            eq(notPerformedWorkouts.scheduledWorkoutId, occurrenceId),
          ),
        );
      await insertWorkoutSessionRows(
        tx,
        completedOccurrenceSession({
          id: `${RUN_ID}-transition`,
          owner: OWNER,
          enrollmentId: RUN,
          scheduledWorkoutId: scheduledWorkoutIdValue(occurrenceId),
          workoutId: workoutIdFor(program, occurrenceId),
        }),
      );
    },
  });
}

/**
 * A test-only gate: a dedicated transaction whose `LOCK TABLE workout_sessions
 * IN ACCESS EXCLUSIVE MODE` request makes any plain read of that table queue
 * behind it (PostgreSQL grants locks in request order). Its REQUEST is verified
 * through `pg_locks` by the caller before anything is allowed to proceed.
 */
function holdTableWriteGate(db: Database): {
  readonly granted: Promise<void>;
  readonly release: () => Promise<void>;
} {
  const granted = createGate();
  const released = createGate();
  const done = db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE workout_sessions IN ACCESS EXCLUSIVE MODE`);
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

/** The number of PENDING (ungranted) lock requests of one mode on the table. */
async function pendingLocks(
  client: postgres.Sql,
  mode: 'AccessExclusiveLock' | 'AccessShareLock',
): Promise<number> {
  const rows = await client<{ count: string }[]>`
    SELECT count(*)::text AS count FROM pg_locks
    WHERE granted = false AND mode = ${mode} AND relation = 'workout_sessions'::regclass
  `;
  return Number.parseInt(rows[0]?.count ?? '0', 10);
}

/**
 * Waits until the expected pending lock request is visible — the gate is
 * armed. Deterministic: the request was already dispatched, so the database
 * MUST publish it; each poll is a database round-trip, never a sleep.
 */
async function waitForPendingLock(
  client: postgres.Sql,
  mode: 'AccessExclusiveLock' | 'AccessShareLock',
): Promise<void> {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    if ((await pendingLocks(client, mode)) >= 1) return;
  }
  throw new Error(`no pending ${mode} on workout_sessions: the gate never armed`);
}

/** The exact membership of one occurrence in the two fact sets. */
function occurrencePlacement(
  facts: RunClosureFacts,
  occurrenceId: string,
): { readonly completed: boolean; readonly notPerformed: boolean } {
  return {
    completed: facts.completedIds.includes(scheduledWorkoutIdValue(occurrenceId)),
    notPerformed: facts.notPerformedIds.includes(scheduledWorkoutIdValue(occurrenceId)),
  };
}

describe('M17 closure projection — one coherent snapshot under a concurrent transition', () => {
  it('1. returns exactly one valid state while Undo→start→complete is in flight, then the committed one', async () => {
    const run = await seedConcludedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
    const occurrenceB = run.settledOccurrenceId;

    await withHarness(async (harness) => {
      const projection = new DrizzleRunClosureFactsRepository(harness.db);
      const writer = await holdUndoStartComplete(harness, run.program, occurrenceB);

      // The transition is genuinely in flight (uncommitted): the read must see
      // the state BEFORE it — B recorded as not performed, NOT completed.
      const duringFlight = await projection.listClosureFactsByEnrollment(RUN);
      expect(occurrencePlacement(duringFlight, occurrenceB)).toEqual({
        completed: false,
        notPerformed: true,
      });
      expect(() => resolveRunClosure(run.program, duringFlight)).not.toThrow();

      await writer.release();

      // After the commit: B completed, NOT not-performed. Never both.
      const afterCommit = await projection.listClosureFactsByEnrollment(RUN);
      expect(occurrencePlacement(afterCommit, occurrenceB)).toEqual({
        completed: true,
        notPerformed: false,
      });
      const closure = resolveRunClosure(run.program, afterCommit);
      expect(closure.isConcluded).toBe(true);
      expect(closure.completedWorkouts).toBe(closure.totalWorkouts);

      // The committed transition is the whole truth: the fact is gone and the
      // completed session is there.
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(0);
      expect(await sessionRowFor(harness.sql, RUN, occurrenceB)).not.toBeNull();
    });
  });

  it('2. a commit landing while the projection is in flight cannot split it', async () => {
    const run = await seedConcludedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
    const occurrenceB = run.settledOccurrenceId;

    await withHarness(async (harness) => {
      const projection = new DrizzleRunClosureFactsRepository(harness.db);
      const writer = await holdUndoStartComplete(harness, run.program, occurrenceB);

      // Arm the gate: an ACCESS EXCLUSIVE request on workout_sessions, pending
      // behind the writer's uncommitted insert — VERIFIED pending, so the
      // reader's plain SELECT is guaranteed to queue behind it.
      const gate = holdTableWriteGate(harness.db);
      await waitForPendingLock(harness.sql, 'AccessExclusiveLock');

      // The projection is dispatched and VERIFIED in flight: its single
      // statement is queued behind the gate before the writer may commit.
      const inFlight = projection.listClosureFactsByEnrollment(RUN);
      await waitForPendingLock(harness.sql, 'AccessShareLock');

      // The commit now lands strictly inside the projection's in-flight window.
      await writer.release();
      await gate.release();

      const facts = await inFlight;

      // Exactly ONE snapshot: the statement saw the committed transition whole —
      // B completed, NOT not-performed. The forbidden answer (B in both sets)
      // would throw here and fail the test.
      expect(occurrencePlacement(facts, occurrenceB)).toEqual({
        completed: true,
        notPerformed: false,
      });
      expect(() => resolveRunClosure(run.program, facts)).not.toThrow();
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(0);
    });
  });

  it('3. negative control: the retired two-statement composition tears at the SAME gate', async () => {
    const run = await seedConcludedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
    const occurrenceB = run.settledOccurrenceId;

    await withHarness(async (harness) => {
      const writer = await holdUndoStartComplete(harness, run.program, occurrenceB);
      const gate = holdTableWriteGate(harness.db);
      await waitForPendingLock(harness.sql, 'AccessExclusiveLock');

      // The pre-fix composition: completed ids and recorded facts as two
      // independent statements. The completed read queues behind the gate;
      // the fact read runs immediately and sees the state BEFORE the commit.
      const completedRead = harness.sessions.listCompletedScheduledWorkoutIds(RUN);
      await waitForPendingLock(harness.sql, 'AccessShareLock');
      const factsRead = await harness.notPerformed.listByEnrollment(RUN);
      expect(factsRead.map((fact) => fact.scheduledWorkoutId)).toContain(occurrenceB);

      // The commit lands between the two statements: the completed read then
      // sees the state AFTER it.
      await writer.release();
      await gate.release();
      const completedIds = await completedRead;
      expect(completedIds).toContain(scheduledWorkoutIdValue(occurrenceB));

      // B in BOTH sets: a contradiction the database never held at any instant.
      // The Domain's guard is correct and stays loud — this is the exact false
      // contradiction the torn projection could manufacture.
      expect(() =>
        resolveRunClosure(run.program, {
          completedIds,
          notPerformedIds: factsRead.map((fact) => fact.scheduledWorkoutId),
        }),
      ).toThrow('Run closure contract violated');
    });
  });
});

