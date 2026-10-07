/**
 * M17 restart preflight — ONE coherent closure snapshot, on real PostgreSQL.
 *
 * The P2 finding this suite guards: the restart preflight gate used to read the
 * completed occurrence ids and the recorded not-performed facts through two
 * independent statements, so the settlement transition `Undo B → start B →
 * complete B` could manufacture a completed+recorded overlap the persisted
 * state never held and fail the gate with an unhandled contradiction BEFORE
 * the authoritative locked replacement check ran. The fix: the preflight now
 * reads the SAME one-snapshot closure-facts projection the summary read uses
 * (`DrizzleRunClosureFactsRepository`). The authoritative re-check under the
 * replacement's own enrollment lock is unchanged and remains decisive.
 *
 * Every interleaving here is decided by database state, never by a sleep: the
 * writer is held mid-transaction by a gate; the restart's blocked compare-and-
 * replace is proven through `pg_stat_activity` before the writer is allowed to
 * commit. Raw statements appear ONLY inside gate holders, to reproduce what
 * the peer transition commits — the restart itself is always the production
 * use case.
 */

import { eq } from 'drizzle-orm';
import type postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { isRunConcluded } from '@/domain/services/run-closure';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import { DrizzleRunClosureFactsRepository } from '@/infrastructure/database/repositories/drizzle-run-closure-facts-repository';
import { insertWorkoutSessionRows } from '@/infrastructure/database/repositories/workout-session-writes';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { notPerformedWorkouts } from '@/infrastructure/database/schema';

import {
  completedOccurrenceSession,
  createRaceHarness,
  holdEnrollmentLock,
  holdTableWriteGate,
  seedConcludedRun,
  waitForPendingLock,
  type ConcludedRunFixture,
  type RaceHarness,
} from './not-performed-race-fixtures';
import { enrollmentIdValue, scheduledWorkoutIdValue } from './planned-workout-fixtures';
import { closeDatabase, resetAndSeed } from './setup';

const OWNER = 'm17-restart-preflight-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-restart-preflight';
const RUN = enrollmentIdValue(RUN_ID);

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** The occurrence template's workout id, needed to build a real session. */
function workoutIdOf(program: ConcludedRunFixture['program'], occurrenceId: string) {
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

/** A dedicated pool with the production restart use case bound to it. */
async function withHarness(
  run: (harness: RaceHarness, restart: RestartProgramUseCase) => Promise<void>,
): Promise<void> {
  // The writer holder, the blocked restart and the observer each need their
  // own real parallel connection.
  const harness = createRaceHarness(5);
  try {
    const restart = new RestartProgramUseCase(
      harness.programs,
      harness.enrollments,
      new DrizzleRunClosureFactsRepository(harness.db),
      new NodeIdGenerator(),
    );
    await run(harness, restart);
  } finally {
    await harness.end();
  }
}

/**
 * Holds the peer settlement transition `Undo B → start B → complete B`
 * uncommitted until `release()` — the same shape the other snapshot suites use.
 */
async function holdUndoStartComplete(
  harness: RaceHarness,
  program: ConcludedRunFixture['program'],
  occurrenceId: string,
): Promise<{ readonly release: () => Promise<void> }> {
  return holdEnrollmentLock({
    db: harness.db,
    enrollmentId: RUN,
    work: async (tx) => {
      await tx
        .delete(notPerformedWorkouts)
        .where(eq(notPerformedWorkouts.scheduledWorkoutId, occurrenceId));
      await insertWorkoutSessionRows(
        tx,
        completedOccurrenceSession({
          id: `${RUN_ID}-transition`,
          owner: OWNER,
          enrollmentId: RUN,
          scheduledWorkoutId: scheduledWorkoutIdValue(occurrenceId),
          workoutId: workoutIdOf(program, occurrenceId),
        }),
      );
    },
  });
}

/**
 * Waits until a backend is BLOCKED on the restart compare-and-replace's
 * `FOR NO KEY UPDATE` enrollment lock — proof the preflight already read its
 * facts and the replacement is queued behind the writer. Deterministic: the
 * blocked statement was already dispatched, so PostgreSQL MUST publish it; each
 * poll is a database round-trip, never a sleep.
 */
async function waitForBlockedReplacement(client: postgres.Sql): Promise<void> {
  for (let attempt = 0; attempt < 2000; attempt += 1) {
    const rows = await client<{ count: string }[]>`
      SELECT count(*)::text AS count FROM pg_stat_activity
      WHERE datname = current_database()
        AND wait_event_type = 'Lock'
        AND query LIKE '%no key update%'
    `;
    if (Number.parseInt(rows[0]?.count ?? '0', 10) >= 1) return;
  }
  throw new Error('no blocked FOR NO KEY UPDATE found: the replacement never queued');
}

describe('M17 restart preflight — one coherent closure snapshot under a concurrent transition', () => {
  it('2. restarts through the transition without a manufactured contradiction, and the locked recheck stays decisive', async () => {
    const run = await seedRestartableRun();
    const occurrenceB = run.settledOccurrenceId;

    await withHarness(async (harness, restart) => {
      const writer = await holdUndoStartComplete(harness, run.program, occurrenceB);

      // The restart runs the PRODUCTION path while the transition is
      // uncommitted: the preflight reads the OLD facts (concluded), then the
      // compare-and-replace queues behind the writer's enrollment lock.
      const restartPromise = restart.execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
      await waitForBlockedReplacement(harness.sql);

      // The commit lands between the preflight and the replacement: the
      // authoritative re-check then evaluates the NEW facts under its own
      // lock — B completed, so the run is COMPLETE and still restartable.
      await writer.release();
      const result = await restartPromise;

      // No manufactured completed+recorded overlap ever failed the gate: the
      // restart either succeeded or was refused with a TYPED outcome.
      expect(result.ok).toBe(true);

      // The replacement was decisive: the old run is gone and the fresh one is
      // the only enrollment of the pair.
      const enrollmentIds = (
        await harness.sql<{ id: string }[]>`
          SELECT id FROM program_enrollments WHERE user_id = ${OWNER} AND program_id = ${run.program.id}
        `
      ).map((row) => row.id);
      expect(enrollmentIds).toHaveLength(1);
      expect(enrollmentIds[0]).not.toBe(RUN_ID);
    });
  });

  it('negative control: the retired two-statement preflight tears at the SAME gate', async () => {
    const run = await seedRestartableRun();
    const occurrenceB = run.settledOccurrenceId;

    await withHarness(async (harness) => {
      const writer = await holdUndoStartComplete(harness, run.program, occurrenceB);
      // The gate for THIS tear: it must land BETWEEN the retired reads, so the
      // completed read runs AFTER the commit and the fact read BEFORE it.
      const gate = holdTableWriteGate(harness.db, 'workout_sessions');
      await waitForPendingLock(harness.sql, 'workout_sessions', 'AccessExclusiveLock');

      // The pre-fix preflight: the completed read queues behind the gate; the
      // fact read runs immediately and still sees the record.
      const completedRead = harness.sessions.listCompletedScheduledWorkoutIds(RUN);
      await waitForPendingLock(harness.sql, 'workout_sessions', 'AccessShareLock');
      const factsBefore = await harness.notPerformed.listByEnrollment(RUN);
      expect(factsBefore.map((fact) => fact.scheduledWorkoutId)).toContain(occurrenceB);

      // The commit lands between the two reads: the completed read then sees
      // the state AFTER it — B has a completed session.
      await writer.release();
      await gate.release();
      const completedAfter = await completedRead;
      expect(completedAfter.map(String)).toContain(occurrenceB);

      // The forbidden composition: a FRESH completed session beside a STALE
      // record. `isRunConcluded` (correctly) rejects it — the exact false
      // contradiction the torn preflight could fail on before the locked
      // recheck ever ran.
      expect(() =>
        isRunConcluded(run.program, {
          completedIds: completedAfter,
          notPerformedIds: factsBefore.map((fact) => fact.scheduledWorkoutId),
        }),
      ).toThrow('Run closure contract violated');
    });
  });
});

/** A RESTARTABLE run: every authored occurrence completed except the last, which is recorded N. */
async function seedRestartableRun(): Promise<ConcludedRunFixture> {
  return seedConcludedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
}
