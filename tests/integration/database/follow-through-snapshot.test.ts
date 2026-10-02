/**
 * M17 follow-through execution facts — ONE coherent database snapshot, on real
 * PostgreSQL.
 *
 * The P2 finding this suite guards: the follow-through read used to obtain the
 * completed activity, the in-progress sessions and the recorded not-performed
 * facts through independent statements. Under READ COMMITTED each statement
 * takes its own snapshot, so the settlement transition `Undo B → start B →
 * complete B` (delete fact + insert completed session, committed atomically)
 * could hand the Domain BOTH the old record and the new completed session for
 * the same occurrence — which `resolveFollowThroughOutcome` correctly rejects
 * as contradictory. The fix: one projection statement
 * (`DrizzleFollowThroughExecutionFactsRepository`) reading all three sets from
 * one snapshot.
 *
 * Every interleaving here is decided by database state, never by a sleep: the
 * writer is held mid-transaction by a gate; the read's in-flight position is
 * proven through `pg_locks` before the writer is allowed to commit. Raw
 * statements appear ONLY inside gate holders, to reproduce what the peer
 * transition commits — the read itself is always the production one.
 *
 * The negative control drives the retired three-statement composition through
 * the SAME armed gate and DOES produce the forbidden completed+recorded pair,
 * proving the gate reproduces the bug and that the fix — not a vacuous
 * interleaving — is what removes it.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GetEnrollmentFollowThroughUseCase } from '@/application/use-cases/get-enrollment-follow-through';
import { insertWorkoutSessionRows } from '@/infrastructure/database/repositories/workout-session-writes';
import { resolveFollowThroughOutcome } from '@/domain/services/plan-follow-through';
import { DrizzleFollowThroughExecutionFactsRepository } from '@/infrastructure/database/repositories/drizzle-follow-through-execution-facts-repository';
import { notPerformedWorkouts } from '@/infrastructure/database/schema';

import {
  completedOccurrenceSession,
  createRaceHarness,
  holdEnrollmentLock,
  holdTableWriteGate,
  insertFactRaw,
  waitForPendingLock,
  type RaceHarness,
} from './not-performed-race-fixtures';
import {
  enrollmentIdValue,
  plannedDate,
  plannedWorkout,
  scheduledWorkoutIdValue,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import {
  closeDatabase,
  db,
  plannedWorkoutRepository,
  resetAndSeed,
} from './setup';

const OWNER = 'm17-follow-snapshot-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-follow-snapshot';
const RUN = enrollmentIdValue(RUN_ID);
/** Wednesday 2026-09-23: the report clock. */
const NOW = new Date('2026-09-23T09:00:00.000Z');
const TODAY = '2026-09-23';

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** The first authored occurrence of the seeded run (the recorded one, B). */
async function seedRecordedRun(): Promise<{ fixture: PlannedRunFixture; occurrenceB: string }> {
  const fixture = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
  const [occurrenceB] = fixture.occurrenceIds;
  if (occurrenceB === undefined) throw new Error('expected at least one authored occurrence');
  await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
    plannedWorkout(RUN_ID, occurrenceB, TODAY),
  ]);
  await db.transaction((tx) => insertFactRaw(tx, { enrollmentId: RUN, scheduledWorkoutId: occurrenceB }));
  return { fixture, occurrenceB };
}

function workoutIdOf(program: PlannedRunFixture['program'], occurrenceId: string) {
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

/**
 * Holds the peer settlement transition `Undo B → start B → complete B`
 * uncommitted until `release()`: the enrollment lock FIRST (the writer-side
 * serialization the production authority uses), then the fact delete and the
 * completed session insert. Committed at release, it is exactly one valid
 * transition.
 */
async function holdUndoStartComplete(
  harness: RaceHarness,
  program: PlannedRunFixture['program'],
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

/** A dedicated pool with the production projection and use case bound to it. */
async function withHarness(
  run: (harness: RaceHarness, useCase: GetEnrollmentFollowThroughUseCase) => Promise<void>,
): Promise<void> {
  // The writer holder, the gate holder, the in-flight reader and the pg_locks
  // observer each need their own real parallel connection.
  const harness = createRaceHarness(6);
  try {
    const useCase = new GetEnrollmentFollowThroughUseCase(
      harness.enrollments,
      harness.planned,
      new DrizzleFollowThroughExecutionFactsRepository(harness.db),
      harness.notPerformed,
    );
    await run(harness, useCase);
  } finally {
    await harness.end();
  }
}

type ReportResult = Awaited<ReturnType<GetEnrollmentFollowThroughUseCase['execute']>>;

/** The report DTO of a successful read, or a loud failure. */
async function dtoOf(result: ReportResult) {
  if (!result.ok) throw new Error(result.error.message);
  if (result.data === null) throw new Error('expected a report, got the absence of a run');
  return result.data;
}

describe('M17 follow-through execution facts — one coherent snapshot under a concurrent transition', () => {
  it('resolves exactly one coherent outcome while Undo→start→complete is in flight', async () => {
    const { fixture, occurrenceB } = await seedRecordedRun();

    await withHarness(async (harness, useCase) => {
      const projection = new DrizzleFollowThroughExecutionFactsRepository(harness.db);
      const occurrence = scheduledWorkoutIdValue(occurrenceB);
      const writer = await holdUndoStartComplete(harness, fixture.program, occurrenceB);

      // 1. While the transition is genuinely uncommitted: the OLD state, whole —
      // the record is present and no completed session exists for B.
      const duringFlight = await projection.listFollowThroughExecutionFactsByEnrollment(RUN);
      expect(duringFlight.notPerformedFacts.map((fact) => fact.scheduledWorkoutId)).toContain(occurrence);
      expect(
        duringFlight.completedActivity.map((activity) => activity.scheduledWorkoutId),
      ).not.toContain(occurrence);
      const before = await dtoOf(
        await useCase.execute({ userId: OWNER, program: fixture.program, now: NOW }),
      );
      if (!before.configured) throw new Error('expected a configured report');
      expect(before.totals.notPerformed).toBe(1);
      expect(before.totals.completed).toBe(0);

      // 2. The commit lands strictly INSIDE a read: the gate holds the read's
      // execution-facts statement behind the writer's uncommitted delete
      // (VERIFIED pending), so the statement runs only after the commit…
      const gate = holdTableWriteGate(harness.db, 'not_performed_workouts');
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessExclusiveLock');
      const inFlight = useCase.execute({ userId: OWNER, program: fixture.program, now: NOW });
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessShareLock');
      await writer.release();
      await gate.release();

      // …and the report resolves from exactly ONE snapshot — the NEW coherent
      // state: B completed, the record gone. The forbidden answer (B both
      // completed and recorded) would throw here and fail the test.
      const report = await dtoOf(await inFlight);
      if (!report.configured) throw new Error('expected a configured report');
      expect(report.totals.completed).toBe(1);
      expect(report.totals.notPerformed).toBe(0);
      expect(report.notPerformedUnplaced).toBe(0);

      // 3. A fresh projection after the commit confirms the same whole state.
      const afterCommit = await projection.listFollowThroughExecutionFactsByEnrollment(RUN);
      expect(afterCommit.notPerformedFacts).toEqual([]);
      expect(afterCommit.completedActivity.map((activity) => activity.scheduledWorkoutId)).toContain(occurrence);
    });
  });

  it('negative control: the retired three-statement composition tears at the SAME gate', async () => {
    const { fixture, occurrenceB } = await seedRecordedRun();

    await withHarness(async (harness) => {
      const occurrence = scheduledWorkoutIdValue(occurrenceB);
      const writer = await holdUndoStartComplete(harness, fixture.program, occurrenceB);
      // The gate for THIS tear: it must land BETWEEN the retired reads, so the
      // completed read runs AFTER the commit and the fact read BEFORE it.
      const gate = holdTableWriteGate(harness.db, 'workout_sessions');
      await waitForPendingLock(harness.sql, 'workout_sessions', 'AccessExclusiveLock');

      // The pre-fix composition: the completed activity read queues behind the
      // gate (it scans workout_sessions); the fact read runs immediately and
      // sees the state BEFORE the commit — the record is still there.
      const completedRead = harness.sessions.listCompletedOccurrenceActivity(RUN);
      await waitForPendingLock(harness.sql, 'workout_sessions', 'AccessShareLock');
      const factsBefore = await harness.notPerformed.listByEnrollment(RUN);
      expect(factsBefore.map((fact) => fact.scheduledWorkoutId)).toContain(occurrence);

      // The commit lands between the two reads: the completed read then sees
      // the state AFTER it — B has a completed session.
      await writer.release();
      await gate.release();
      const completedAfter = await completedRead;
      expect(completedAfter.map((activity) => activity.scheduledWorkoutId)).toContain(occurrence);

      // The forbidden composition: a STALE record beside a FRESH completed
      // session. `resolveFollowThroughOutcome` correctly rejects it — this is
      // the exact false contradiction the torn projection manufactured.
      expect(() =>
        resolveFollowThroughOutcome(
          {
            scheduledWorkoutId: occurrence,
            plannedDate: plannedDate(TODAY),
            completedAt: completedAfter.find((activity) => activity.scheduledWorkoutId === occurrence)?.completedAt ?? null,
            hasActiveSession: false,
            hasNotPerformedRecord: true,
          },
          plannedDate(TODAY),
        ),
      ).toThrow('Occurrence settlement contract violated');
    });
  });
});
