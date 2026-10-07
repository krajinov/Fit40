/**
 * M17 schedule execution facts — ONE coherent database snapshot, on real
 * PostgreSQL.
 *
 * The P2 finding this suite guards: the enrollment schedule read used to
 * obtain the in-progress session projection and the recorded-not-performed
 * facts through independent statements. Under READ COMMITTED each statement
 * takes its own snapshot, so a `recordNotPerformed` transition for an
 * abandoned session (delete session + insert fact, committed atomically)
 * could hand `resolvePlannedWorkoutStatus` a STALE in-progress session beside
 * the FRESH fact — and in-progress precedence would render Resume (and hide
 * the settled state) for a session the database no longer holds. The fix: one
 * projection statement (`DrizzleScheduleExecutionFactsRepository`) returning
 * all three execution-fact sets from one snapshot.
 *
 * Every interleaving here is decided by database state, never by a sleep: the
 * writer is held mid-transaction by a gate; the read's in-flight position is
 * proven through `pg_locks` before the writer is allowed to commit. Raw
 * statements appear ONLY inside gate holders, to reproduce what the peer
 * transition commits — the read itself is always the production use case.
 *
 * The negative control drives the retired multi-query composition through the
 * SAME armed gate and DOES produce the forbidden stale-in-progress-plus-fresh-
 * fact pair, proving the gate reproduces the bug and that the fix — not a
 * vacuous interleaving — is what removes it.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import type { EnrollmentScheduleDto } from '@/application/dto/schedule';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { resolvePlannedWorkoutStatus } from '@/domain/services/schedule-focus';
import { DrizzleScheduleExecutionFactsRepository } from '@/infrastructure/database/repositories/drizzle-schedule-execution-facts-repository';
import { workoutSessions } from '@/infrastructure/database/schema';

import {
  createRaceHarness,
  holdEnrollmentLock,
  holdTableWriteGate,
  insertFactRaw,
  seedCompletedOccurrenceSession,
  seedInProgressOccurrenceSession,
  waitForPendingLock,
  type RaceHarness,
} from './not-performed-race-fixtures';
import {
  enrollmentIdValue,
  plannedDate,
  plannedWorkout,
  seedEnrolledRun,
} from './planned-workout-fixtures';
import {
  closeDatabase,
  db,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  resetAndSeed,
  scheduleExecutionFactsRepository,
} from './setup';

const OWNER = 'm17-schedule-snapshot-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-schedule-snapshot';
const RUN = enrollmentIdValue(RUN_ID);
/** Wednesday 2026-09-23: the calendar clock. */
const NOW = new Date('2026-09-23T09:00:00.000Z');
const TODAY = '2026-09-23';
const PAST = '2026-09-21';
const FUTURE = '2026-09-25';

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

/** A dedicated pool with the production use case bound to that pool. */
async function withHarness(
  run: (harness: RaceHarness, useCase: GetEnrollmentScheduleUseCase) => Promise<void>,
): Promise<void> {
  // The writer holder, the gate holder, the in-flight reader and the pg_locks
  // observer each need their own real parallel connection.
  const harness = createRaceHarness(6);
  try {
    const useCase = new GetEnrollmentScheduleUseCase(
      harness.enrollments,
      harness.planned,
      new DrizzleScheduleExecutionFactsRepository(harness.db),
    );
    await run(harness, useCase);
  } finally {
    await harness.end();
  }
}

/**
 * Holds the peer `recordNotPerformed` transition for an abandoned session
 * uncommitted until `release()`: the enrollment lock FIRST (the writer-side
 * serialization the production authority uses), then the session delete
 * (children cascade) and the fact insert. Committed at release, it is exactly
 * one valid transition.
 */
async function holdRecordNotPerformedTransition(
  harness: RaceHarness,
  sessionId: string,
  occurrenceId: string,
): Promise<{ readonly release: () => Promise<void> }> {
  return holdEnrollmentLock({
    db: harness.db,
    enrollmentId: RUN,
    work: async (tx) => {
      await tx.delete(workoutSessions).where(eq(workoutSessions.id, sessionId));
      await insertFactRaw(tx, { enrollmentId: RUN, scheduledWorkoutId: occurrenceId });
    },
  });
}

/**
 * Seeds an enrolled run with a planned row TODAY for its first occurrence,
 * which carries an abandoned zero-set session and no record.
 */
async function seedAbandonedSessionRun() {
  const fixture = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
  const [occurrenceB] = fixture.occurrenceIds;
  if (occurrenceB === undefined) throw new Error('expected at least one authored occurrence');
  await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
    plannedWorkout(RUN_ID, occurrenceB, TODAY),
  ]);
  const session = await seedInProgressOccurrenceSession({
    id: `${RUN_ID}-abandoned`,
    owner: OWNER,
    enrollmentId: RUN,
    scheduledWorkoutId: occurrenceB,
    workoutId: workoutIdFor(fixture.program, occurrenceB),
  });
  return { fixture, occurrenceB, session };
}

/** The status of one occurrence's calendar item, or a loud failure. */
async function statusOf(
  useCase: GetEnrollmentScheduleUseCase,
  program: TrainingProgram,
  occurrenceId: string,
): Promise<string> {
  const schedule = await readSchedule(useCase, program);
  const item = schedule.items.find((candidate) => candidate.scheduledWorkoutId === occurrenceId);
  if (item === undefined) throw new Error(`occurrence "${occurrenceId}" has no calendar row`);
  return item.status;
}

/** The DTO of a schedule read, or a loud failure. */
async function readSchedule(
  useCase: GetEnrollmentScheduleUseCase,
  program: TrainingProgram,
): Promise<EnrollmentScheduleDto> {
  const result = await useCase.execute({ userId: OWNER, program, now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  if (result.data === null) throw new Error('expected a schedule, got the absence of a run');
  return result.data;
}


describe('M17 schedule execution facts — one coherent snapshot under a concurrent transition', () => {
  it('B. the calendar resolves from one coherent snapshot while the abandoned-session → record transition is in flight', async () => {
    const { fixture, occurrenceB, session } = await seedAbandonedSessionRun();

    await withHarness(async (harness, useCase) => {
      const writer = await holdRecordNotPerformedTransition(harness, session.id, occurrenceB);

      // 1. While the transition is genuinely uncommitted: the session-derived
      // state, whole — the occurrence is in-progress.
      expect(await statusOf(useCase, fixture.program, occurrenceB)).toBe('in-progress');

      // 2. The commit lands strictly INSIDE a read: the gate holds the read's
      // execution-facts statement behind the writer's uncommitted insert
      // (VERIFIED pending), so the statement runs only after the commit…
      const gate = holdTableWriteGate(harness.db, 'not_performed_workouts');
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessExclusiveLock');
      const inFlight = useCase.execute({ userId: OWNER, program: fixture.program, now: NOW });
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessShareLock');
      await writer.release();
      await gate.release();

      // …and the item resolves from exactly ONE snapshot — the NEW coherent
      // state: recorded as not performed, with no live session truth beside
      // it. Presentation maps this status to no Resume, no Start, no Move and
      // no second record control (pinned by the schedule view unit tests).
      const result = await inFlight;
      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(result.error.message);
      const schedule = result.data;
      if (schedule === null) throw new Error('expected a schedule, got the absence of a run');
      const item = schedule.items.find((candidate) => candidate.scheduledWorkoutId === occurrenceB);
      expect(item?.status).toBe('not-performed');
      expect(schedule.focus.notPerformedRecorded).toBe(1);
    });
  });

  it('negative control: the retired multi-query composition resolves the stale in-progress at the SAME gate', async () => {
    const { occurrenceB, session } = await seedAbandonedSessionRun();

    await withHarness(async (harness) => {
      const writer = await holdRecordNotPerformedTransition(harness, session.id, occurrenceB);
      const gate = holdTableWriteGate(harness.db, 'not_performed_workouts');
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessExclusiveLock');

      // The pre-fix composition: the in-progress projection and the fact read
      // as independent statements. The fact read queues behind the gate; the
      // in-progress read runs immediately and sees the state BEFORE the
      // commit.
      const factsRead = harness.notPerformed.listByEnrollment(RUN);
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessShareLock');
      const inProgressIds = await harness.sessions.listInProgressScheduledWorkoutIds(RUN);
      expect(inProgressIds.map(String)).toContain(occurrenceB);

      // The commit lands between the two statements: the fact read then sees
      // the state AFTER it.
      await writer.release();
      await gate.release();
      const facts = await factsRead;
      expect(facts.map((fact) => fact.scheduledWorkoutId)).toContain(occurrenceB);

      // The forbidden composition: a STALE in-progress beside the FRESH
      // record. In-progress precedence (correct over coherent facts) then
      // wins, and the calendar would render Resume for a session the database
      // no longer holds.
      const tornStatus = resolvePlannedWorkoutStatus(
        {
          plannedWorkout: plannedWorkout(RUN_ID, occurrenceB, TODAY),
          hasCompletedSession: false,
          hasActiveSession: true,
          hasNotPerformedRecord: true,
        },
        plannedDate(TODAY),
      );
      expect(tornStatus).toBe('in-progress');
    });
  });
});


describe('M17 schedule execution facts — regression statuses are unchanged', () => {
  it('planned, past-due, in-progress, completed and not-performed all resolve exactly as before', async () => {
    const fixture = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
    const [aPlanned, aPastDue, aInProgress, aCompleted, aNotPerformed] = fixture.occurrenceIds;
    if (
      aPlanned === undefined ||
      aPastDue === undefined ||
      aInProgress === undefined ||
      aCompleted === undefined ||
      aNotPerformed === undefined
    ) {
      throw new Error('expected at least five authored occurrences');
    }

    await plannedWorkoutRepository.replaceAllForEnrollment(RUN, [
      plannedWorkout(RUN_ID, aPastDue, '2026-09-20'),
      plannedWorkout(RUN_ID, aCompleted, PAST),
      plannedWorkout(RUN_ID, aNotPerformed, TODAY),
      plannedWorkout(RUN_ID, aInProgress, FUTURE),
      plannedWorkout(RUN_ID, aPlanned, '2026-09-26'),
    ]);
    await seedInProgressOccurrenceSession({
      id: `${RUN_ID}-in-progress`,
      owner: OWNER,
      enrollmentId: RUN,
      scheduledWorkoutId: aInProgress,
      workoutId: workoutIdFor(fixture.program, aInProgress),
    });
    await seedCompletedOccurrenceSession({
      id: `${RUN_ID}-completed`,
      owner: OWNER,
      enrollmentId: RUN,
      scheduledWorkoutId: aCompleted,
      workoutId: workoutIdFor(fixture.program, aCompleted),
    });
    await db.transaction((tx) =>
      insertFactRaw(tx, { enrollmentId: RUN, scheduledWorkoutId: aNotPerformed }),
    );

    const useCase = new GetEnrollmentScheduleUseCase(
      programEnrollmentRepository,
      plannedWorkoutRepository,
      scheduleExecutionFactsRepository,
    );
    const schedule = await readSchedule(useCase, fixture.program);

    const statusById = new Map(
      schedule.items.map((item) => [item.scheduledWorkoutId, item.status]),
    );
    expect(statusById.get(aPlanned)).toBe('planned');
    expect(statusById.get(aPastDue)).toBe('past-due');
    expect(statusById.get(aInProgress)).toBe('in-progress');
    expect(statusById.get(aCompleted)).toBe('completed');
    expect(statusById.get(aNotPerformed)).toBe('not-performed');
  });
});

