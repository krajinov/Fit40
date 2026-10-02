/**
 * M17 Slice 12 — the settlement LIFECYCLE round trips on real PostgreSQL.
 *
 * Where `not-performed-concurrency.test.ts` proves who wins an overlap, this
 * suite proves what a full lifecycle does to the whole vertical: enroll,
 * configure, record, read (M15 calendar, M16 follow-through, M17 closure),
 * undo, regenerate, re-record, restart and leave/rejoin.
 *
 * Every read is the production read and every write is the production use case,
 * on the shared integration client. No concurrency is simulated here — the
 * races live in the concurrency suite — so the assertions are about composed
 * truth: which rows exist, which statuses the reads derive from them, and which
 * historical sessions survive or detach.
 *
 * Fixed clocks: `NOW` (Tue 2026-09-22T09:00Z) for the first configuration and
 * `LATER` (Mon 2026-09-28T09:00Z) for the regeneration, so no assertion depends
 * on the machine clock.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { EnrollmentScheduleDto } from '@/application/dto/schedule';
import { ConfigureTrainingDaysUseCase } from '@/application/use-cases/configure-training-days';
import { EnrollInProgramUseCase } from '@/application/use-cases/enroll-in-program';
import { GetEnrollmentFollowThroughUseCase } from '@/application/use-cases/get-enrollment-follow-through';
import { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import { GetRunClosureSummaryUseCase } from '@/application/use-cases/get-run-closure-summary';
import { LeaveProgramUseCase } from '@/application/use-cases/leave-program';
import { RecordNotPerformedUseCase } from '@/application/use-cases/record-not-performed';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { UndoNotPerformedUseCase } from '@/application/use-cases/undo-not-performed';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';

import { factLines } from './not-performed-fixtures';
import {
  childRowCounts,
  countRows,
  seedCompletedOccurrenceSession,
  seedConcludedRun,
} from './not-performed-race-fixtures';
import {
  allPlannedRows,
  enrollmentIdValue,
  enrollmentIdsForOwner,
  listOccurrences,
  seedEnrolledRun,
} from './planned-workout-fixtures';
import { workoutSessionId } from './personal-record-fixtures';
import {
  client,
  closeDatabase,
  notPerformedOccurrenceRepository,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  runClosureFactsRepository,
  scheduleExecutionFactsRepository,
  runOccurrenceWrites,
  workoutSessionRepository,
} from './setup';

const OWNER = 'm17-lifecycle-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const AUTHORED_OCCURRENCES = 12;
const RUN = 'enr-m17-lifecycle';
/** Tuesday 2026-09-22: the first configuration's clock. */
const NOW = new Date('2026-09-22T09:00:00.000Z');
/** Monday 2026-09-28: the regeneration's clock, one week later. */
const LATER = new Date('2026-09-28T09:00:00.000Z');
const RECORDED_AT = new Date('2026-09-22T18:30:00.000Z');
const RECORDED_AGAIN_AT = new Date('2026-09-28T19:15:00.000Z');

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** Every production use case of this lifecycle, wired to the shared client. */
function useCases() {
  return {
    enroll: new EnrollInProgramUseCase(
      programRepository,
      programEnrollmentRepository,
      new NodeIdGenerator(),
    ),
    configure: new ConfigureTrainingDaysUseCase(
      programRepository,
      programEnrollmentRepository,
      plannedWorkoutRepository,
      workoutSessionRepository,
      notPerformedOccurrenceRepository,
    ),
    schedule: new GetEnrollmentScheduleUseCase(
      programEnrollmentRepository,
      plannedWorkoutRepository,
      scheduleExecutionFactsRepository,
    ),
    followThrough: new GetEnrollmentFollowThroughUseCase(
      programEnrollmentRepository,
      plannedWorkoutRepository,
      workoutSessionRepository,
      notPerformedOccurrenceRepository,
    ),
    closure: new GetRunClosureSummaryUseCase(
      programEnrollmentRepository,
      runClosureFactsRepository,
    ),
    record: new RecordNotPerformedUseCase(
      programRepository,
      programEnrollmentRepository,
      runOccurrenceWrites,
    ),
    undo: new UndoNotPerformedUseCase(
      programRepository,
      programEnrollmentRepository,
      runOccurrenceWrites,
    ),
    restart: new RestartProgramUseCase(
      programRepository,
      programEnrollmentRepository,
      workoutSessionRepository,
      notPerformedOccurrenceRepository,
      new NodeIdGenerator(),
    ),
    leave: new LeaveProgramUseCase(programRepository, programEnrollmentRepository),
  };
}


/** The authored coordinates of one occurrence, as the public routes address it. */
function coordinatesOf(
  program: TrainingProgram,
  occurrenceId: string,
): { readonly weekNumber: number; readonly workoutOrder: number } {
  const occurrence = listOccurrences(program).find((candidate) => candidate.id === occurrenceId);
  if (occurrence === undefined) {
    throw new Error(`occurrence "${occurrenceId}" is not authored by the program`);
  }
  const week = program.weeks.find((candidate) =>
    candidate.scheduledWorkouts.some((scheduled) => scheduled.id === occurrenceId),
  );
  if (week === undefined) throw new Error('occurrence has no authored week');

  return { weekNumber: week.weekNumber, workoutOrder: occurrence.order };
}

/** The occurrence template's workout id, needed to build a real session. */
function workoutIdFor(program: TrainingProgram, occurrenceId: string): string {
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

/** One occurrence's row in the M15 calendar, or a loud failure. */
function itemFor(schedule: EnrollmentScheduleDto | null, occurrenceId: string) {
  if (schedule === null) throw new Error('expected a schedule, got the absence of a run');
  const item = schedule.items.find((candidate) => candidate.scheduledWorkoutId === occurrenceId);
  if (item === undefined) throw new Error(`occurrence "${occurrenceId}" has no calendar row`);
  return item;
}

/** The run's persisted facts, via the production read, as `occurrence@instant`. */
async function factsFor(enrollmentId: string): Promise<ReadonlyArray<string>> {
  return factLines(
    await notPerformedOccurrenceRepository.listByEnrollment(enrollmentIdValue(enrollmentId)),
  );
}

describe('1. record → read → undo → regenerate → re-record', () => {
  it('carries one settlement through every M15/M16/M17 read and back', async () => {
    const run = await seedEnrolledRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: RUN,
    });
    const { configure, record, schedule, followThrough, closure, undo } = useCases();
    const [first] = run.occurrenceIds;
    if (first === undefined) throw new Error('expected the program to author occurrences');

    // 1. Configure: the whole authored plan is placed, today first.
    const configured = await configure.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekdays: [1, 3, 5],
      now: NOW,
    });
    expect(configured.ok).toBe(true);

    const before = await schedule.execute({ userId: OWNER, program: run.program, now: NOW });
    if (!before.ok || before.data === null) throw new Error('expected a configured schedule');
    expect(before.data.configured).toBe(true);
    expect(before.data.items).toHaveLength(AUTHORED_OCCURRENCES);
    expect(itemFor(before.data, first).status).toBe('planned');
    expect(before.data.focus.notPerformedRecorded).toBe(0);

    // 2. Record one occurrence. The fact is a settlement, not calendar intent.
    const recorded = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(run.program, first),
      recordedAt: RECORDED_AT,
    });
    expect(recorded.ok).toBe(true);
    expect(await factsFor(RUN)).toEqual([`${first}@${RECORDED_AT.toISOString()}`]);
    // No session is created, attributed or closed by a settlement.
    expect(await countRows(client, 'workout_sessions')).toBe(0);

    // 3. M15: the row is still there, and its status is the record — never a date.
    const calendared = await schedule.execute({ userId: OWNER, program: run.program, now: NOW });
    if (!calendared.ok || calendared.data === null) throw new Error('expected a schedule');
    expect(calendared.data.items).toHaveLength(AUTHORED_OCCURRENCES);
    expect(itemFor(calendared.data, first).status).toBe('not-performed');
    expect(calendared.data.focus.notPerformedRecorded).toBe(1);
    expect(calendared.data.unplacedNotPerformedWorkouts).toEqual([]);

    // 4. M16: the recorded occurrence is a count in its week, never past due.
    //    The report's horizon is the last 8 weeks, so the future rows of this
    //    plan contribute no week and no total — the recorded one does.
    const report = await followThrough.execute({ userId: OWNER, program: run.program, now: NOW });
    if (!report.ok || report.data === null) throw new Error('expected a follow-through report');
    expect(report.data.configured).toBe(true);
    if (!report.data.configured) return;
    expect(report.data.totals.notPerformed).toBe(1);
    expect(report.data.totals.pastDue).toBe(0);
    expect(report.data.notPerformedUnplaced).toBe(0);
    expect(report.data.weeks.map((week) => week.weekStart)).toEqual(['2026-09-21T00:00:00.000Z']);
    expect(report.data.weeks[0]).toMatchObject({ notPerformed: 1, pastDue: 0, completed: 0 });

    // 5. M17 closure: concluded is false, incomplete is true, restart is closed.
    const closed = await closure.execute({ userId: OWNER, program: run.program });
    if (!closed.ok || closed.data === null) throw new Error('expected a closure summary');
    expect(closed.data).toMatchObject({
      totalWorkouts: AUTHORED_OCCURRENCES,
      completedWorkouts: 0,
      notPerformedWorkouts: 1,
      openWorkouts: AUTHORED_OCCURRENCES - 1,
      isConcluded: false,
      isProgramComplete: false,
      restartAvailable: false,
    });

    // 6. Undo: the fact is gone, the calendar is untouched, nothing is placed.
    const retracted = await undo.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(run.program, first),
    });
    expect(retracted.ok).toBe(true);
    expect(await factsFor(RUN)).toEqual([]);
    expect(await countRows(client, 'workout_sessions')).toBe(0);

    const afterUndo = await schedule.execute({ userId: OWNER, program: run.program, now: NOW });
    if (!afterUndo.ok || afterUndo.data === null) throw new Error('expected a schedule');
    expect(afterUndo.data.items).toHaveLength(AUTHORED_OCCURRENCES);
    // Undo itself never synthesizes a row: the occurrence returns to its
    // date-derived status on the row it already had.
    expect(itemFor(afterUndo.data, first).status).toBe('planned');
    expect(afterUndo.data.focus.notPerformedRecorded).toBe(0);

    // 7. Regenerate a week later: the now-open occurrence is placed again, once.
    const regenerated = await configure.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekdays: [2, 4],
      now: LATER,
    });
    expect(regenerated.ok).toBe(true);

    const rows = await allPlannedRows();
    expect(rows).toHaveLength(AUTHORED_OCCURRENCES);
    expect(new Set(rows.map((row) => row.scheduledWorkoutId)).size).toBe(AUTHORED_OCCURRENCES);
    expect(rows.some((row) => row.scheduledWorkoutId === first)).toBe(true);
    expect(await factsFor(RUN)).toEqual([]);
    expect(await countRows(client, 'workout_sessions')).toBe(0);

    // 8. Re-record: settlement is repeatable and still writes no session.
    const reRecorded = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(run.program, first),
      recordedAt: RECORDED_AGAIN_AT,
    });
    expect(reRecorded.ok).toBe(true);
    expect(await factsFor(RUN)).toEqual([`${first}@${RECORDED_AGAIN_AT.toISOString()}`]);
    expect(await countRows(client, 'workout_sessions')).toBe(0);

    const reCalendared = await schedule.execute({
      userId: OWNER,
      program: run.program,
      now: LATER,
    });
    if (!reCalendared.ok || reCalendared.data === null) throw new Error('expected a schedule');
    expect(itemFor(reCalendared.data, first).status).toBe('not-performed');

    const reClosed = await closure.execute({ userId: OWNER, program: run.program });
    if (!reClosed.ok || reClosed.data === null) throw new Error('expected a closure summary');
    expect(reClosed.data.notPerformedWorkouts).toBe(1);
  });
});


describe('2. restart — a concluded run is replaced, never inherited', () => {
  it('clears the old run’s facts, detaches its history and starts the fresh run clean', async () => {
    // A restartable run by construction: every authored occurrence is settled —
    // all but the last by a completed session, the last by a not-performed fact.
    const run = await seedConcludedRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: RUN,
    });
    const { closure, record, restart } = useCases();
    const [first] = run.occurrenceIds;
    if (first === undefined) throw new Error('expected the program to author occurrences');

    // Concluded while INCOMPLETE: that pair is exactly what opens the restart.
    const before = await closure.execute({ userId: OWNER, program: run.program });
    if (!before.ok || before.data === null) throw new Error('expected a closure summary');
    expect(before.data).toMatchObject({
      totalWorkouts: AUTHORED_OCCURRENCES,
      completedWorkouts: AUTHORED_OCCURRENCES - 1,
      notPerformedWorkouts: 1,
      openWorkouts: 0,
      isConcluded: true,
      isProgramComplete: false,
      restartAvailable: true,
    });
    expect(await factsFor(RUN)).toEqual([`${run.settledOccurrenceId}@2026-09-28T18:30:00.000Z`]);

    const restarted = await restart.execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
    expect(restarted.ok).toBe(true);

    // A replacement run, with an identity of its own.
    const enrollments = await enrollmentIdsForOwner(OWNER);
    expect(enrollments).toHaveLength(1);
    const fresh = enrollments[0];
    if (fresh === undefined) throw new Error('expected the replacement enrollment');
    expect(fresh).not.toBe(RUN);

    // The old run is gone with everything that belonged to it...
    expect(await factsFor(RUN)).toEqual([]);
    expect(await countRows(client, 'not_performed_workouts')).toBe(0);
    expect((await allPlannedRows()).filter((row) => row.enrollmentId === RUN)).toEqual([]);

    // ...and the fresh run inherits NO settlement: a fresh enrollment can never
    // carry the previous run's recorded facts.
    expect(await factsFor(fresh)).toEqual([]);

    // Its closure is open, and it is not restartable.
    const freshClosure = await closure.execute({ userId: OWNER, program: run.program });
    if (!freshClosure.ok || freshClosure.data === null) {
      throw new Error('expected a closure summary');
    }
    expect(freshClosure.data).toMatchObject({
      totalWorkouts: AUTHORED_OCCURRENCES,
      completedWorkouts: 0,
      notPerformedWorkouts: 0,
      openWorkouts: AUTHORED_OCCURRENCES,
      isConcluded: false,
      isProgramComplete: false,
      restartAvailable: false,
    });

    // Historical truth is detached, not destroyed: every completed session is
    // still there, still complete, with its exercise and set rows in place.
    for (const sessionId of run.completedSessionIds) {
      const session = await workoutSessionRepository.findById(workoutSessionId(sessionId));
      expect(session).not.toBeNull();
      expect(session?.enrollmentId).toBeNull();
      expect(session?.completedAt).not.toBeNull();
      expect(await childRowCounts(client, sessionId)).toEqual({ exerciseLogs: 1, setLogs: 1 });
    }

    // The fresh run settles on its own: recording lands on the new enrollment.
    const recorded = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(run.program, first),
      recordedAt: RECORDED_AT,
    });
    expect(recorded.ok).toBe(true);
    expect(await factsFor(fresh)).toEqual([`${first}@${RECORDED_AT.toISOString()}`]);
    expect(await factsFor(RUN)).toEqual([]);
  });
});


describe('3. leave — facts cascade, history detaches, a rejoin starts clean', () => {
  it('removes the run with its facts, keeps completed history, and rejoins fresh', async () => {
    const run = await seedEnrolledRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: RUN,
    });
    const { configure, enroll, closure, record, schedule, leave } = useCases();
    const [first, second] = run.occurrenceIds;
    if (first === undefined || second === undefined) {
      throw new Error('expected the program to author at least two occurrences');
    }

    const configured = await configure.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekdays: [1, 3, 5],
      now: NOW,
    });
    expect(configured.ok).toBe(true);

    // One occurrence settled as not performed, a different one completed: the
    // run now carries both kinds of settlement, and one durable session.
    const recorded = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(run.program, first),
      recordedAt: RECORDED_AT,
    });
    expect(recorded.ok).toBe(true);
    const completed = await seedCompletedOccurrenceSession({
      id: `${RUN}-completed`,
      owner: OWNER,
      enrollmentId: enrollmentIdValue(RUN),
      scheduledWorkoutId: second,
      workoutId: workoutIdFor(run.program, second),
    });

    const before = await closure.execute({ userId: OWNER, program: run.program });
    if (!before.ok || before.data === null) throw new Error('expected a closure summary');
    expect(before.data).toMatchObject({
      completedWorkouts: 1,
      notPerformedWorkouts: 1,
      openWorkouts: AUTHORED_OCCURRENCES - 2,
    });

    const left = await leave.execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
    expect(left.ok).toBe(true);

    // The run is gone, and the fact died with it (enrollment CASCADE) — a
    // settlement is run-scoped execution truth, not user-global history.
    expect(await enrollmentIdsForOwner(OWNER)).toEqual([]);
    expect(await factsFor(RUN)).toEqual([]);
    expect(await countRows(client, 'not_performed_workouts')).toBe(0);
    expect(await allPlannedRows()).toEqual([]);

    // With no run, both reads report absence rather than inventing a state.
    expect(await schedule.execute({ userId: OWNER, program: run.program, now: NOW })).toEqual({
      ok: true,
      data: null,
    });
    expect(await closure.execute({ userId: OWNER, program: run.program })).toEqual({
      ok: true,
      data: null,
    });

    // Durable completed history survives, detached, with its rows intact.
    const surviving = await workoutSessionRepository.findById(workoutSessionId(completed.id));
    expect(surviving).not.toBeNull();
    expect(surviving?.enrollmentId).toBeNull();
    expect(await childRowCounts(client, completed.id)).toEqual({
      exerciseLogs: 1,
      setLogs: 1,
    });

    // Rejoin: a new enrollment identity, zero inherited settlement, open closure.
    const rejoined = await enroll.execute({ userId: OWNER, programSlug: PROGRAM_SLUG });
    expect(rejoined.ok).toBe(true);
    const enrollments = await enrollmentIdsForOwner(OWNER);
    expect(enrollments).toHaveLength(1);
    const fresh = enrollments[0];
    if (fresh === undefined) throw new Error('expected the rejoin enrollment');
    expect(fresh).not.toBe(RUN);
    expect(await factsFor(fresh)).toEqual([]);

    const freshClosure = await closure.execute({ userId: OWNER, program: run.program });
    if (!freshClosure.ok || freshClosure.data === null) {
      throw new Error('expected a closure summary');
    }
    expect(freshClosure.data).toMatchObject({
      completedWorkouts: 0,
      notPerformedWorkouts: 0,
      openWorkouts: AUTHORED_OCCURRENCES,
      isConcluded: false,
    });

    // Fresh planning behaves like a first enrollment, and the old fact stays gone.
    const freshSchedule = await schedule.execute({
      userId: OWNER,
      program: run.program,
      now: NOW,
    });
    if (!freshSchedule.ok || freshSchedule.data === null) throw new Error('expected a schedule');
    expect(freshSchedule.data.configured).toBe(false);
    expect(freshSchedule.data.items).toEqual([]);

    const reconfigured = await configure.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      weekdays: [1, 3, 5],
      now: NOW,
    });
    expect(reconfigured.ok).toBe(true);
    const placed = await schedule.execute({ userId: OWNER, program: run.program, now: NOW });
    if (!placed.ok || placed.data === null) throw new Error('expected a schedule');
    expect(placed.data.configured).toBe(true);
    expect(placed.data.items).toHaveLength(AUTHORED_OCCURRENCES);
    expect(placed.data.focus.notPerformedRecorded).toBe(0);
    expect(await factsFor(RUN)).toEqual([]);
  });
});

