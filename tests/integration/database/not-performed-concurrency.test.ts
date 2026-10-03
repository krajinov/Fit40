/**
 * M17 Slice 12 — the settlement concurrency matrix on real PostgreSQL.
 *
 * Every overlap here uses a dedicated pool with real parallel connections, and
 * every interleaving is decided by an explicit transaction gate (never a
 * sleep). The operations under test are the production ones: the Slice 7 record
 * / undo use cases, the Slice 6 start use case, the M15 configure transaction,
 * the M14 restart/leave lifecycle and the enrollment-locked settlement
 * authority. Raw statements appear ONLY inside a gate holder, to reproduce what
 * a peer transaction commits (a fact, a replacement enrollment, a logged set)
 * while a production transaction is genuinely in flight.
 *
 * Serialization point for record, undo and start: the enrollment row, taken
 * `FOR NO KEY UPDATE` FIRST, exactly as `DrizzleRunOccurrenceWrites` does.
 *
 * Scenario 9c is the one that found something: a session content write
 * (`WorkoutSessionRepository.save`) does NOT take the enrollment lock, so it can
 * commit a logged set between the settlement's locked diagnostic read and its
 * guarded DELETE. PostgreSQL's READ COMMITTED re-check for a blocked DELETE
 * re-evaluates predicates on the target row only, so the `NOT EXISTS` subquery
 * kept the pre-work snapshot and the delete destroyed the just-committed set
 * (cascade). The guard now also pins the session row's `version` (a target-row
 * column, re-evaluated correctly), which makes the delete miss and the
 * transaction abort as a contract violation — no statement added, no new lock.
 * 9c proves the abort, the survival of the work, and the honest
 * `OCCURRENCE_HAS_LOGGED_WORK` refusal on the next attempt.
 */
import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { NotPerformedWriteContractViolationError } from '@/application/ports/run-occurrence-write-repository';
import { ConfigureTrainingDaysUseCase } from '@/application/use-cases/configure-training-days';
import { LeaveProgramUseCase } from '@/application/use-cases/leave-program';
import { RecordNotPerformedUseCase } from '@/application/use-cases/record-not-performed';
import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { StartWorkoutSessionUseCase } from '@/application/use-cases/start-workout-session';
import { UndoNotPerformedUseCase } from '@/application/use-cases/undo-not-performed';
import type { TrainingProgram } from '@/domain/entities/training-program';
import type { EnrollmentId } from '@/domain/types/ids';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import type { Database } from '@/infrastructure/database/client';
import { DrizzleNotPerformedOccurrenceRepository } from '@/infrastructure/database/repositories/drizzle-not-performed-occurrence-repository';
import { DrizzlePlannedWorkoutRepository } from '@/infrastructure/database/repositories/drizzle-planned-workout-repository';
import { DrizzleProgramEnrollmentRepository } from '@/infrastructure/database/repositories/drizzle-program-enrollment-repository';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { DrizzleRunClosureFactsRepository } from '@/infrastructure/database/repositories/drizzle-run-closure-facts-repository';
import { DrizzleRunOccurrenceWrites } from '@/infrastructure/database/repositories/drizzle-run-occurrence-writes';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import * as schema from '@/infrastructure/database/schema';
import { notPerformedWorkouts } from '@/infrastructure/database/schema';

import {
  PENDING,
  authoredExerciseCount,
  buildOccurrenceSession,
  childRowCounts,
  countRows,
  createRaceHarness,
  deleteEnrollmentRaw,
  factExists,
  factInstants,
  holdEnrollmentLock,
  holdSessionWork,
  insertFactRaw,
  orphanChildRows,
  replaceEnrollmentRaw,
  seedCompletedOccurrenceSession,
  seedConcludedRun,
  seedInProgressOccurrenceSession,
  sessionIdsForRun,
  sessionRowFor,
  settleWithin,
  type RaceHarness,
} from './not-performed-race-fixtures';
import {
  allPlannedRows,
  enrollmentIdValue,
  enrollmentIdsForOwner,
  scheduledWorkoutIdValue,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import { closeDatabase, resetAndSeed } from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'm17-race-owner';
const OTHER_OWNER = 'm17-race-other-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-race-a';
const OTHER_RUN_ID = 'enr-m17-race-b';
const FRESH_RUN_ID = 'enr-m17-race-a-fresh';
const RUN = enrollmentIdValue(RUN_ID);
const OTHER_RUN = enrollmentIdValue(OTHER_RUN_ID);
const FRESH_RUN = enrollmentIdValue(FRESH_RUN_ID);
const RECORDED_AT = new Date('2026-09-28T18:30:00.000Z');
const OTHER_RECORDED_AT = new Date('2026-09-28T19:45:00.000Z');
/** Wednesday 2026-09-23: the configure clock. */
const NOW = new Date('2026-09-23T09:00:00.000Z');

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** The authored coordinates of one occurrence, as the public routes address it. */
function coordinatesOf(
  program: TrainingProgram,
  occurrenceId: string,
): { readonly weekNumber: number; readonly workoutOrder: number } {
  for (const week of program.weeks) {
    for (const scheduled of week.scheduledWorkouts) {
      if (scheduled.id === occurrenceId) {
        return { weekNumber: week.weekNumber, workoutOrder: scheduled.order };
      }
    }
  }
  throw new Error(`occurrence "${occurrenceId}" is not authored by the program`);
}

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

/** The first three authored occurrences, or a loud failure. */
function occurrencesOf(fixture: PlannedRunFixture): readonly [string, string, string] {
  const [first, second, third] = fixture.occurrenceIds;
  if (first === undefined || second === undefined || third === undefined) {
    throw new Error('expected at least three authored occurrences');
  }
  return [first, second, third];
}

/** The production use cases wired to a dedicated (parallel) pool. */
function useCasesFor(harness: RaceHarness) {
  return {
    record: new RecordNotPerformedUseCase(harness.programs, harness.enrollments, harness.writes),
    undo: new UndoNotPerformedUseCase(harness.programs, harness.enrollments, harness.writes),
    start: new StartWorkoutSessionUseCase(
      harness.programs,
      harness.writes,
      harness.enrollments,
      new NodeIdGenerator(),
    ),
    configure: new ConfigureTrainingDaysUseCase(
      harness.programs,
      harness.enrollments,
      harness.planned,
      harness.sessions,
      harness.notPerformed,
    ),
    restart: new RestartProgramUseCase(
      harness.programs,
      harness.enrollments,
      new DrizzleRunClosureFactsRepository(harness.db),
      new NodeIdGenerator(),
    ),
    leave: new LeaveProgramUseCase(harness.programs, harness.enrollments),
  };
}

/** Runs a scenario on its own pool and always closes it. */
async function withHarness<T>(run: (harness: RaceHarness) => Promise<T>): Promise<T> {
  const harness = createRaceHarness(6);
  try {
    return await run(harness);
  } finally {
    await harness.end();
  }
}

/** The standard seeded run: one owner, one program, one enrollment. */
async function seedRaceRun(owner = OWNER, enrollmentId = RUN): Promise<PlannedRunFixture> {
  return seedEnrolledRun({ owner, programSlug: PROGRAM_SLUG, enrollmentId });
}

/** The whole-run settlement truth, for final-state assertions. */
async function settleTruth(harness: RaceHarness, enrollmentId = RUN) {
  return {
    facts: await factInstants(harness.sql, enrollmentId),
    sessions: await sessionIdsForRun(harness.sql, enrollmentId),
    sessionsTotal: await countRows(harness.sql, 'workout_sessions'),
    children: await orphanChildRows(harness.sql),
  };
}

describe('2. record || record — a double submit settles once', () => {
  it('2a. the queued record reads the peer fact under the lock and refuses to restate it', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record } = useCasesFor(harness);
      const holder = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: RUN,
        work: (tx) => insertFactRaw(tx, { enrollmentId: RUN, scheduledWorkoutId: first }),
      });

      const second = record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: OTHER_RECORDED_AT,
      });
      expect(await settleWithin(second, 1200)).toBe(PENDING);

      await holder.release();

      const outcome = await second;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe('OCCURRENCE_ALREADY_RECORDED');

      // The peer's instant is the one that survives: the refusal never rewrote
      // the established fact.
      expect(await factInstants(harness.sql, RUN)).toEqual([
        `${first}@2026-09-28T18:30:00.000Z`,
      ]);
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(1);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });

  it('2b. two genuinely concurrent submitters settle exactly once, without an infrastructure error', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const [left, right] = await Promise.all([
        record.execute({
          userId: OWNER,
          programSlug: PROGRAM_SLUG,
          ...coordinates,
          recordedAt: RECORDED_AT,
        }),
        record.execute({
          userId: OWNER,
          programSlug: PROGRAM_SLUG,
          ...coordinates,
          recordedAt: OTHER_RECORDED_AT,
        }),
      ]);

      const outcomes = [left, right];
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      const refused = outcomes.find((outcome) => !outcome.ok);
      expect(refused === undefined ? null : refused.error.code).toBe('OCCURRENCE_ALREADY_RECORDED');

      const facts = await factInstants(harness.sql, RUN);
      expect(facts).toHaveLength(1);
      expect([RECORDED_AT.toISOString(), OTHER_RECORDED_AT.toISOString()]).toContain(
        facts[0]?.split('@')[1],
      );
      expect(await settleTruth(harness)).toEqual({
        facts,
        sessions: [],
        sessionsTotal: 0,
        children: { exerciseLogs: 0, setLogs: 0 },
      });
    });
  });
});

describe('3. record || undo — settlement and retraction serialized', () => {
  it('3a. a retraction that commits first leaves the occurrence unrecorded, so the record still succeeds', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      // Establish the fact first, then retract it inside the gate (the undo
      // writer's effect) while a record is in flight.
      const established = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
        recordedAt: RECORDED_AT,
      });
      expect(established.ok).toBe(true);

      const holder = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: RUN,
        work: async (tx) => {
          await tx.delete(notPerformedWorkouts);
        },
      });

      const restated = record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
        recordedAt: OTHER_RECORDED_AT,
      });
      expect(await settleWithin(restated, 1200)).toBe(PENDING);

      await holder.release();

      const outcome = await restated;
      expect(outcome.ok).toBe(true);
      expect(await factInstants(harness.sql, RUN)).toEqual([
        `${first}@2026-09-28T19:45:00.000Z`,
      ]);
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(1);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });

  it('3b. a genuinely concurrent record and undo leave at most one fact and never a duplicate', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record, undo } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const [recorded, undone] = await Promise.all([
        record.execute({
          userId: OWNER,
          programSlug: PROGRAM_SLUG,
          ...coordinates,
          recordedAt: RECORDED_AT,
        }),
        undo.execute({ userId: OWNER, programSlug: PROGRAM_SLUG, ...coordinates }),
      ]);

      // Both writers are legal: the record may or may not find a fact to
      // establish, and the undo may or may not find one to retract. What may
      // never happen is a duplicated or half-written fact.
      expect(recorded.ok).toBe(true);
      if (!undone.ok) expect(undone.error.code).toBe('OCCURRENCE_NOT_RECORDED');

      const facts = await factInstants(harness.sql, RUN);
      expect(facts.length).toBeLessThanOrEqual(1);
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(facts.length);
      expect(await settleTruth(harness)).toEqual({
        facts,
        sessions: [],
        sessionsTotal: 0,
        children: { exerciseLogs: 0, setLogs: 0 },
      });
    });
  });
});
describe('1. record || start — the enrollment lock arbitrates', () => {
  it('1a. record commits first: the queued start observes the fact and creates nothing', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { start } = useCasesFor(harness);
      // A peer settlement writer holds the enrollment lock and commits the fact.
      const holder = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: RUN,
        work: (tx) => insertFactRaw(tx, { enrollmentId: RUN, scheduledWorkoutId: first }),
      });

      const started = start.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
      });

      // Queued behind the parent row — a lock cycle would have aborted with
      // SQLSTATE 40P01 well inside this window.
      expect(await settleWithin(started, 1200)).toBe(PENDING);
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(0);

      await holder.release();

      const outcome = await started;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe('OCCURRENCE_RECORDED_NOT_PERFORMED');

      expect(await settleTruth(harness)).toEqual({
        facts: [`${first}@2026-09-28T18:30:00.000Z`],
        sessions: [],
        sessionsTotal: 0,
        children: { exerciseLogs: 0, setLogs: 0 },
      });
    });
  });

  it('1b. start writes first: the serialized record deletes the abandoned zero-set session', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record, start } = useCasesFor(harness);
      const holder = await holdEnrollmentLock({ db: harness.db, enrollmentId: RUN });

      const started = start.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
      });
      expect(await settleWithin(started, 1200)).toBe(PENDING);

      await holder.release();

      const outcome = await started;
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      // The winner's session is exactly the abandoned shape: one exercise log
      // per authored exercise, zero logged sets, still in progress.
      expect(await childRowCounts(harness.sql, outcome.data.sessionId)).toEqual({
        exerciseLogs: authoredExerciseCount(run.program, first),
        setLogs: 0,
      });
      expect(await sessionRowFor(harness.sql, RUN, first)).toEqual({
        id: outcome.data.sessionId,
        enrollmentId: RUN,
      });

      // The second, serialized record decides on what the winner left behind.
      const recorded = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      });
      expect(recorded.ok).toBe(true);

      // Slice 6 semantics preserved: the empty in-progress session is gone and
      // the occurrence is settled instead.
      expect(await settleTruth(harness)).toEqual({
        facts: [`${first}@2026-09-28T18:30:00.000Z`],
        sessions: [],
        sessionsTotal: 0,
        children: { exerciseLogs: 0, setLogs: 0 },
      });
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(1);
    });
  });

  it('1c. genuinely concurrent start and record always commit exactly one settlement', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record, start } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const [started, recorded] = await Promise.all([
        start.execute({ userId: OWNER, programSlug: PROGRAM_SLUG, ...coordinates }),
        record.execute({
          userId: OWNER,
          programSlug: PROGRAM_SLUG,
          ...coordinates,
          recordedAt: RECORDED_AT,
        }),
      ]);

      // The record always settles: either the occurrence was untouched, or it
      // found the loser's abandoned zero-set session and removed it.
      expect(recorded.ok).toBe(true);
      // The start either created the session (and the record removed it) or was
      // refused with the locked settlement outcome.
      if (!started.ok) {
        expect(started.error.code).toBe('OCCURRENCE_RECORDED_NOT_PERFORMED');
      }

      // Whichever ordering won, the final truth is one settlement, no session
      // and no child row left behind.
      expect(await settleTruth(harness)).toEqual({
        facts: [`${first}@2026-09-28T18:30:00.000Z`],
        sessions: [],
        sessionsTotal: 0,
        children: { exerciseLogs: 0, setLogs: 0 },
      });
    });
  });
});
/** The run's calendar rows, read through the shared client after work settles. */
async function plannedOccurrencesForRun(enrollmentId: EnrollmentId): Promise<ReadonlyArray<string>> {
  const rows = await allPlannedRows();
  return rows
    .filter((row) => row.enrollmentId === enrollmentId)
    .map((row) => row.scheduledWorkoutId);
}

describe('4. record || configure — the settlement is honored by regeneration', () => {
  it('4a. a fact committed first means the regeneration never dates the settled occurrence', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { configure, record } = useCasesFor(harness);

      const recorded = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      });
      expect(recorded.ok).toBe(true);

      const configured = await configure.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        weekdays: [1, 3, 5],
        now: NOW,
      });
      expect(configured.ok).toBe(true);

      const planned = await plannedOccurrencesForRun(RUN);
      expect(new Set(planned).size).toBe(planned.length);
      expect(planned).not.toContain(first);
      expect(planned).toHaveLength(run.occurrenceIds.length - 1);
      expect(await factExists(harness.sql, RUN, first)).toBe(true);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });

  it('4b. a regeneration that commits against an unseen fact leaves a stale row the NEXT regeneration reconciles', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { configure } = useCasesFor(harness);
      const input = {
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        weekdays: [1, 3, 5],
        now: NOW,
      };

      const initial = await configure.execute(input);
      expect(initial.ok).toBe(true);
      expect(await plannedOccurrencesForRun(RUN)).toHaveLength(run.occurrenceIds.length);

      // The peer fact commits while a second, identical request is queued on
      // the enrollment lock — AFTER that request read its facts and generated
      // its plan, which is exactly the documented M15/M17 window.
      const holder = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: RUN,
        work: (tx) => insertFactRaw(tx, { enrollmentId: RUN, scheduledWorkoutId: first }),
      });

      const stale = configure.execute(input);
      expect(await settleWithin(stale, 1200)).toBe(PENDING);
      await holder.release();
      const staleOutcome = await stale;
      expect(staleOutcome.ok).toBe(true);

      // The settled occurrence is still truthful: the fact exists, and the
      // stale plan is a duplicate-free calendar that merely has not project
      // the settlement yet.
      expect(await factExists(harness.sql, RUN, first)).toBe(true);
      const afterStale = await plannedOccurrencesForRun(RUN);
      expect(afterStale.filter((occurrence) => occurrence === first)).toHaveLength(1);
      expect(new Set(afterStale).size).toBe(afterStale.length);

      // The next authoritative regeneration reads the committed fact and drops
      // the row: the intermediate result is reconciled, not enshrined.
      const reconciled = await configure.execute(input);
      expect(reconciled.ok).toBe(true);
      const afterReconcile = await plannedOccurrencesForRun(RUN);
      expect(afterReconcile).not.toContain(first);
      expect(afterReconcile).toHaveLength(run.occurrenceIds.length - 1);
      expect(new Set(afterReconcile).size).toBe(afterReconcile.length);
      expect(await factExists(harness.sql, RUN, first)).toBe(true);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(0);
    });
  });

  it('4c. a calendar that already owns the occurrence is untouched by the record', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { configure, record } = useCasesFor(harness);

      const configured = await configure.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        weekdays: [1, 3, 5],
        now: NOW,
      });
      expect(configured.ok).toBe(true);
      const before = await plannedOccurrencesForRun(RUN);
      expect(before).toHaveLength(run.occurrenceIds.length);

      const recorded = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      });
      expect(recorded.ok).toBe(true);

      // The settlement writer owns the FACT, never the calendar: no row is
      // duplicated, invented or stolen, and the projection (Slice 8's read
      // model, covered by its own suite) is what reports the occurrence as not
      // performed rather than owed.
      const after = await plannedOccurrencesForRun(RUN);
      expect(after).toEqual(before);
      expect(await factExists(harness.sql, RUN, first)).toBe(true);
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(0);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });
});

describe('5. undo || start — retraction and start cannot both be true', () => {
  it('5a. the settled occurrence refuses the start, and the retraction reopens it exactly once', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record, start, undo } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const recorded = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
        recordedAt: RECORDED_AT,
      });
      expect(recorded.ok).toBe(true);

      const refused = await start.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
      });
      expect(refused.ok).toBe(false);
      if (!refused.ok) expect(refused.error.code).toBe('OCCURRENCE_RECORDED_NOT_PERFORMED');
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(0);

      const retracted = await undo.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
      });
      expect(retracted.ok).toBe(true);
      expect(await factExists(harness.sql, RUN, first)).toBe(false);

      // With the fact retracted the occurrence is startable again, exactly once.
      const started = await start.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
      });
      expect(started.ok).toBe(true);
      if (!started.ok) return;
      expect(await childRowCounts(harness.sql, started.data.sessionId)).toEqual({
        exerciseLogs: authoredExerciseCount(run.program, first),
        setLogs: 0,
      });

      expect(await settleTruth(harness)).toEqual({
        facts: [],
        sessions: [started.data.sessionId],
        sessionsTotal: 1,
        children: { exerciseLogs: 0, setLogs: 0 },
      });
    });
  });

  it('5b. a retraction committed first lets the queued start create, and never beside a fact', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record, start } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const recorded = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
        recordedAt: RECORDED_AT,
      });
      expect(recorded.ok).toBe(true);

      const holder = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: RUN,
        work: async (tx) => {
          await tx.delete(notPerformedWorkouts);
        },
      });

      const started = start.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
      });
      expect(await settleWithin(started, 1200)).toBe(PENDING);

      await holder.release();

      const outcome = await started;
      expect(outcome.ok).toBe(true);
      if (!outcome.ok) return;

      expect(await settleTruth(harness)).toEqual({
        facts: [],
        sessions: [outcome.data.sessionId],
        sessionsTotal: 1,
        children: { exerciseLogs: 0, setLogs: 0 },
      });
    });
  });
});

describe('5c. undo || start — the genuinely concurrent overlap', () => {
  it('5c. a concurrent retraction and start never leave a session beside a fact', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record, start, undo } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const recorded = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
        recordedAt: RECORDED_AT,
      });
      expect(recorded.ok).toBe(true);

      const [undone, started] = await Promise.all([
        undo.execute({ userId: OWNER, programSlug: PROGRAM_SLUG, ...coordinates }),
        start.execute({ userId: OWNER, programSlug: PROGRAM_SLUG, ...coordinates }),
      ]);

      expect(undone.ok).toBe(true);
      if (!started.ok) {
        expect(started.error.code).toBe('OCCURRENCE_RECORDED_NOT_PERFORMED');
      }

      // The retraction always removes the fact; the start either created its
      // session after it or was refused before it. Never both.
      const truth = await settleTruth(harness);
      expect(truth.facts).toEqual([]);
      expect(truth.sessions.length).toBeLessThanOrEqual(1);
      expect(truth.sessionsTotal).toBe(truth.sessions.length);
      expect(truth.children).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });
});

describe('6. undo || undo — a double retraction retracts once', () => {
  it('6a. two genuinely concurrent retractions retract once and refuse the second', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record, undo } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const recorded = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
        recordedAt: RECORDED_AT,
      });
      expect(recorded.ok).toBe(true);

      const [left, right] = await Promise.all([
        undo.execute({ userId: OWNER, programSlug: PROGRAM_SLUG, ...coordinates }),
        undo.execute({ userId: OWNER, programSlug: PROGRAM_SLUG, ...coordinates }),
      ]);

      const outcomes = [left, right];
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      const refused = outcomes.find((outcome) => !outcome.ok);
      expect(refused === undefined ? null : refused.error.code).toBe('OCCURRENCE_NOT_RECORDED');

      expect(await settleTruth(harness)).toEqual({
        facts: [],
        sessions: [],
        sessionsTotal: 0,
        children: { exerciseLogs: 0, setLogs: 0 },
      });
    });
  });

  it('6b. the retraction that queued behind a peer retraction is refused, not rebellious', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { record, undo } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const recorded = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
        recordedAt: RECORDED_AT,
      });
      expect(recorded.ok).toBe(true);

      // The peer retraction commits inside the gate, then the queued one reads
      // current truth under the lock: nothing to retract any more.
      const holder = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: RUN,
        work: async (tx) => {
          await tx.delete(notPerformedWorkouts);
        },
      });

      const queued = undo.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
      });
      expect(await settleWithin(queued, 1200)).toBe(PENDING);

      await holder.release();

      const outcome = await queued;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe('OCCURRENCE_NOT_RECORDED');
      expect(await factInstants(harness.sql, RUN)).toEqual([]);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });
});

describe('7. settlement || restart — a replaced run is never written to', () => {
  it('7a. the authority reports a vanished run for a replaced enrollment and writes nothing', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      // The M14 replacement commits first (old run deleted, fresh run inserted in
      // ONE transaction), then a stale settlement write against the old run is
      // attempted on the authority itself.
      await harness.db.transaction((tx) =>
        replaceEnrollmentRaw(tx, {
          expectedId: RUN,
          nextId: FRESH_RUN_ID,
          owner: OWNER,
          programId: run.program.id,
        }),
      );

      const outcome = await harness.writes.recordNotPerformed({
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutIdValue(first),
        recordedAt: RECORDED_AT,
      });

      expect(outcome.kind).toBe('run-vanished');
      expect(await factInstants(harness.sql, RUN)).toEqual([]);
      expect(await factInstants(harness.sql, FRESH_RUN)).toEqual([]);
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(0);
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(0);
    });
  });

  it('7b. the undo that queued behind a restart replacement is refused as ENROLLMENT_CHANGED', async () => {
    const run = await seedConcludedRun({
      owner: OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: RUN_ID,
    });

    await withHarness(async (harness) => {
      const { undo } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, run.settledOccurrenceId);

      const holder = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: RUN,
        work: (tx) =>
          replaceEnrollmentRaw(tx, {
            expectedId: RUN,
            nextId: FRESH_RUN_ID,
            owner: OWNER,
            programId: run.program.id,
          }),
      });

      const queued = undo.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinates,
      });
      expect(await settleWithin(queued, 1200)).toBe(PENDING);

      await holder.release();

      const outcome = await queued;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe('ENROLLMENT_CHANGED');

      // The fresh run is untouched: an empty settlement set by construction and
      // not a single session. The old run's facts cascaded away with it while
      // its completed history survived, detached.
      expect(await factInstants(harness.sql, FRESH_RUN)).toEqual([]);
      expect(await sessionIdsForRun(harness.sql, FRESH_RUN)).toEqual([]);
      expect(await factInstants(harness.sql, RUN)).toEqual([]);
      expect(await sessionIdsForRun(harness.sql, RUN)).toEqual([]);
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(
        run.completedSessionIds.length,
      );
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });
});

describe('7c. settlement || leave — a detached history is never corrupted', () => {
  it('7c. the record that queued behind a leave is refused as NOT_ENROLLED and writes nothing', async () => {
    const run = await seedRaceRun();
    const [first, second] = occurrencesOf(run);
    const history = await seedCompletedOccurrenceSession({
      id: `${RUN_ID}-leave-history`,
      owner: OWNER,
      enrollmentId: RUN,
      scheduledWorkoutId: second,
      workoutId: workoutIdFor(run.program, second),
    });

    await withHarness(async (harness) => {
      const { record } = useCasesFor(harness);

      const holder = await holdEnrollmentLock({
        db: harness.db,
        enrollmentId: RUN,
        work: (tx) => deleteEnrollmentRaw(tx, RUN),
      });

      const queued = record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      });
      expect(await settleWithin(queued, 1200)).toBe(PENDING);

      await holder.release();

      const outcome = await queued;
      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe('NOT_ENROLLED');

      // No settlement was written for a run that no longer exists, and the
      // completed history is intact — detached, with its children in place.
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(0);
      expect(await sessionIdsForRun(harness.sql, RUN)).toEqual([]);
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(1);
      expect(await childRowCounts(harness.sql, history.id)).toEqual({
        exerciseLogs: 1,
        setLogs: 1,
      });
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });

  it('7d. a genuinely concurrent retraction and leave settle to ONE consistent history', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { leave, record } = useCasesFor(harness);

      const [left, recorded] = await Promise.all([
        leave.execute({ userId: OWNER, programSlug: PROGRAM_SLUG }),
        record.execute({
          userId: OWNER,
          programSlug: PROGRAM_SLUG,
          ...coordinatesOf(run.program, first),
          recordedAt: RECORDED_AT,
        }),
      ]);

      expect(left.ok).toBe(true);
      if (!recorded.ok) expect(recorded.error.code).toBe('NOT_ENROLLED');

      // Whichever won, the run is gone, so neither its fact nor its calendar
      // may outlive it.
      expect(await enrollmentIdsForOwner(OWNER)).toEqual([]);
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(0);
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(0);
      expect(await countRows(harness.sql, 'planned_workouts')).toBe(0);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });
});

describe('8. start || start / restart / leave — creation races', () => {
  it('8a. the authority reports a vanished run for a replaced enrollment and creates nothing', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      await harness.db.transaction((tx) =>
        replaceEnrollmentRaw(tx, {
          expectedId: RUN,
          nextId: FRESH_RUN_ID,
          owner: OWNER,
          programId: run.program.id,
        }),
      );

      const session = buildOccurrenceSession({
        id: `${RUN_ID}-8a-session`,
        owner: OWNER,
        enrollmentId: RUN,
        scheduledWorkoutId: scheduledWorkoutIdValue(first),
        workoutId: workoutIdFor(run.program, first),
      });
      const outcome = await harness.writes.createSessionForOccurrence({
        enrollmentId: RUN,
        scheduledWorkoutId: session.scheduledWorkoutId,
        session,
      });

      expect(outcome.kind).toBe('run-vanished');
      expect(await countRows(harness.sql, 'workout_sessions')).toBe(0);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });

  it('8b. two genuinely concurrent starts create exactly one session', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    await withHarness(async (harness) => {
      const { start } = useCasesFor(harness);
      const coordinates = coordinatesOf(run.program, first);

      const [left, right] = await Promise.all([
        start.execute({ userId: OWNER, programSlug: PROGRAM_SLUG, ...coordinates }),
        start.execute({ userId: OWNER, programSlug: PROGRAM_SLUG, ...coordinates }),
      ]);

      const outcomes = [left, right];
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      const refused = outcomes.find((outcome) => !outcome.ok);
      expect(refused === undefined ? null : refused.error.code).toBe('SESSION_ALREADY_EXISTS');

      const truth = await settleTruth(harness);
      expect(truth.sessions).toHaveLength(1);
      expect(truth.sessionsTotal).toBe(1);
      expect(truth.facts).toEqual([]);
      expect(truth.children).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });
});

describe('9. record || work — logged work is never overwritten by a settlement', () => {
  it('9a. a committed set refuses the record and leaves the work untouched', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);
    const worked = await seedInProgressOccurrenceSession({
      id: `${RUN_ID}-worked`,
      owner: OWNER,
      enrollmentId: RUN,
      scheduledWorkoutId: first,
      workoutId: workoutIdFor(run.program, first),
      withLoggedSet: true,
    });

    await withHarness(async (harness) => {
      const { record } = useCasesFor(harness);

      const outcome = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe('OCCURRENCE_HAS_LOGGED_WORK');

      expect(await factInstants(harness.sql, RUN)).toEqual([]);
      expect(await sessionIdsForRun(harness.sql, RUN)).toEqual([worked.id]);
      expect(await childRowCounts(harness.sql, worked.id)).toEqual({
        exerciseLogs: 1,
        setLogs: 1,
      });
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });

  it('9b. a completed session refuses the record and stays completed', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);
    const completed = await seedCompletedOccurrenceSession({
      id: `${RUN_ID}-completed`,
      owner: OWNER,
      enrollmentId: RUN,
      scheduledWorkoutId: first,
      workoutId: workoutIdFor(run.program, first),
    });

    await withHarness(async (harness) => {
      const { record } = useCasesFor(harness);

      const outcome = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      });

      expect(outcome.ok).toBe(false);
      if (outcome.ok) return;
      expect(outcome.error.code).toBe('OCCURRENCE_ALREADY_PERFORMED');

      expect(await factInstants(harness.sql, RUN)).toEqual([]);
      expect(await sessionIdsForRun(harness.sql, RUN)).toEqual([completed.id]);
      expect(await childRowCounts(harness.sql, completed.id)).toEqual({
        exerciseLogs: 1,
        setLogs: 1,
      });
    });
  });
});

describe('9c. record || the tightest window — an uncommitted set', () => {
  it('9c. a set that commits while the settlement is queued makes the guarded DELETE refuse', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);
    // The abandoned shape the record is allowed to delete: one exercise log, no sets.
    const abandoned = await seedInProgressOccurrenceSession({
      id: `${RUN_ID}-abandoned`,
      owner: OWNER,
      enrollmentId: RUN,
      scheduledWorkoutId: first,
      workoutId: workoutIdFor(run.program, first),
    });

    await withHarness(async (harness) => {
      const { record } = useCasesFor(harness);

      // A peer saves work straight into the occurrence's session row: the same
      // row lock, version bump and set INSERT that `WorkoutSessionRepository.save`
      // performs — but NOT under the enrollment lock, which is exactly why this
      // window is the tightest one M17 has to defend.
      const holder = await holdSessionWork({ db: harness.db, sessionId: abandoned.id });

      const recording = record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      });

      // The decision was made on pre-work facts, so the write is stuck on the
      // session row lock the peer holds.
      expect(await settleWithin(recording, 1200)).toBe(PENDING);

      await holder.release();

      // The guarded DELETE re-checks its predicate against the committed set, so
      // the transaction is aborted rather than turned into a settlement fact.
      await expect(recording).rejects.toThrow(NotPerformedWriteContractViolationError);

      expect(await factInstants(harness.sql, RUN)).toEqual([]);
      expect(await countRows(harness.sql, 'not_performed_workouts')).toBe(0);
      expect(await sessionIdsForRun(harness.sql, RUN)).toEqual([abandoned.id]);
      expect(await childRowCounts(harness.sql, abandoned.id)).toEqual({
        exerciseLogs: 1,
        setLogs: 1,
      });
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });

      // The window is a one-shot abort, never a second chance: the retry reads
      // the now-committed work under the lock and refuses it as a business
      // outcome, and the logged set is still exactly where the user left it.
      const retried = await record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      });
      expect(retried.ok).toBe(false);
      if (retried.ok) return;
      expect(retried.error.code).toBe('OCCURRENCE_HAS_LOGGED_WORK');

      expect(await factInstants(harness.sql, RUN)).toEqual([]);
      expect(await childRowCounts(harness.sql, abandoned.id)).toEqual({
        exerciseLogs: 1,
        setLogs: 1,
      });
    });
  });
});

describe('10. cross-run isolation — one run’s races never touch another', () => {
  it('10a. a concurrent settlement batch on one run leaves the other run untouched', async () => {
    const run = await seedRaceRun(OWNER, RUN);
    const other = await seedRaceRun(OTHER_OWNER, OTHER_RUN);
    const [first, second] = occurrencesOf(run);
    const otherFirst = other.occurrenceIds[0];
    const otherSecond = other.occurrenceIds[1];
    if (otherFirst === undefined || otherSecond === undefined) {
      throw new Error('expected the seeded program to author at least two occurrences');
    }

    await withHarness(async (harness) => {
      const { configure, record, start } = useCasesFor(harness);

      // The other owner's run gets real truth of its own: a settlement fact, a
      // completed session and a generated calendar.
      const otherRecorded = await record.execute({
        userId: OTHER_OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(other.program, otherFirst),
        recordedAt: RECORDED_AT,
      });
      expect(otherRecorded.ok).toBe(true);
      const otherSession = await seedCompletedOccurrenceSession({
        id: `${OTHER_RUN_ID}-history`,
        owner: OTHER_OWNER,
        enrollmentId: OTHER_RUN,
        scheduledWorkoutId: otherSecond,
        workoutId: workoutIdFor(other.program, otherSecond),
      });
      const otherConfigured = await configure.execute({
        userId: OTHER_OWNER,
        programSlug: PROGRAM_SLUG,
        weekdays: [2, 4],
        now: NOW,
      });
      expect(otherConfigured.ok).toBe(true);

      const before = {
        facts: await factInstants(harness.sql, OTHER_RUN),
        sessions: await sessionIdsForRun(harness.sql, OTHER_RUN),
        planned: await plannedOccurrencesForRun(OTHER_RUN),
        children: await childRowCounts(harness.sql, otherSession.id),
      };
      expect(before.facts).toHaveLength(1);
      expect(before.children).toEqual({ exerciseLogs: 1, setLogs: 1 });

      // Three writers hammer the FIRST run at the same time: a settlement, a
      // start on a different occurrence and a regeneration.
      const [recorded, started, configured] = await Promise.all([
        record.execute({
          userId: OWNER,
          programSlug: PROGRAM_SLUG,
          ...coordinatesOf(run.program, first),
          recordedAt: RECORDED_AT,
        }),
        start.execute({
          userId: OWNER,
          programSlug: PROGRAM_SLUG,
          ...coordinatesOf(run.program, second),
        }),
        configure.execute({
          userId: OWNER,
          programSlug: PROGRAM_SLUG,
          weekdays: [1, 3, 5],
          now: NOW,
        }),
      ]);

      expect(recorded.ok).toBe(true);
      expect(started.ok).toBe(true);
      expect(configured.ok).toBe(true);

      // The first run holds exactly its own two truths, each of them once.
      const settledFacts = await factInstants(harness.sql, RUN);
      expect(settledFacts).toEqual([`${first}@2026-09-28T18:30:00.000Z`]);
      const runSessions = await sessionIdsForRun(harness.sql, RUN);
      expect(runSessions).toHaveLength(1);
      const runPlanned = await plannedOccurrencesForRun(RUN);
      expect(new Set(runPlanned).size).toBe(runPlanned.length);
      // The regeneration may or may not have observed the settlement and the
      // start that were committing beside it; every count in that window is
      // legal, and none of them may be a duplicate.
      expect(runPlanned.length).toBeGreaterThanOrEqual(run.occurrenceIds.length - 2);
      expect(runPlanned.length).toBeLessThanOrEqual(run.occurrenceIds.length);

      // The other run is untouched: same facts, same instants, same sessions,
      // same calendar, same child rows.
      expect(await factInstants(harness.sql, OTHER_RUN)).toEqual(before.facts);
      expect(await sessionIdsForRun(harness.sql, OTHER_RUN)).toEqual(before.sessions);
      expect(await plannedOccurrencesForRun(OTHER_RUN)).toEqual(before.planned);
      expect(await childRowCounts(harness.sql, otherSession.id)).toEqual(before.children);
      expect(await orphanChildRows(harness.sql)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    });
  });
});

describe('11. statement and lock discipline — parent first, bounded, no retries', () => {
  /**
   * Runs `observe` against a dedicated statement-counting client bound to the
   * SAME database, so the evidence is the SQL production actually issues. Only
   * data statements are recorded; the connection is warmed first so postgres.js'
   * one-time introspection is never counted.
   */
  async function statementsOf<T>(
    observe: (db: Database) => Promise<T>,
  ): Promise<{ readonly outcome: T; readonly statements: ReadonlyArray<string> }> {
    const statements: string[] = [];
    const countingClient = postgres(getTestDatabaseUrl(), {
      max: 1,
      debug: (_connection: number, query: string) => {
        const normalized = query.trim().toLowerCase();
        if (/^(select|insert|update|delete)/.test(normalized)) {
          statements.push(normalized);
        }
      },
    });

    try {
      const db = drizzle(countingClient, { schema });
      await db.execute(sql`select 1`);
      statements.length = 0;
      const outcome = await observe(db);
      return { outcome, statements };
    } finally {
      await countingClient.end();
    }
  }

  /** The production door wired to one database: repositories plus the use cases. */
  function productionUseCases(db: Database) {
    const programs = new DrizzleProgramRepository(db);
    const enrollments = new DrizzleProgramEnrollmentRepository(db);
    const planned = new DrizzlePlannedWorkoutRepository(db);
    const sessions = new DrizzleWorkoutSessionRepository(db);
    const notPerformed = new DrizzleNotPerformedOccurrenceRepository(db);
    const writes = new DrizzleRunOccurrenceWrites(db);
    const ids = new NodeIdGenerator();

    return {
      record: new RecordNotPerformedUseCase(programs, enrollments, writes),
      undo: new UndoNotPerformedUseCase(programs, enrollments, writes),
      start: new StartWorkoutSessionUseCase(programs, writes, enrollments, ids),
      configure: new ConfigureTrainingDaysUseCase(
        programs,
        enrollments,
        planned,
        sessions,
        notPerformed,
      ),
      restart: new RestartProgramUseCase(programs, enrollments, new DrizzleRunClosureFactsRepository(db), ids),
      leave: new LeaveProgramUseCase(programs, enrollments),
    };
  }

  const firstIndex = (statements: ReadonlyArray<string>, needle: string): number =>
    statements.findIndex((statement) => statement.includes(needle));


  it('locks the parent enrollment row before any settlement fact is read or written', async () => {
    const run = await seedRaceRun();
    const [first] = occurrencesOf(run);

    // RECORD and UNDO resolve identity, then the authority locks the enrollment
    // row FIRST: no not-performed / session / set read may precede that lock.
    const record = await statementsOf((db) =>
      productionUseCases(db).record.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
        recordedAt: RECORDED_AT,
      }),
    );
    expect(record.outcome.ok).toBe(true);
    const recordLock = firstIndex(record.statements, 'for no key update');
    expect(recordLock).toBeGreaterThanOrEqual(0);
    for (const read of ['not_performed_workouts', 'workout_sessions', 'set_logs']) {
      const readAt = firstIndex(record.statements, read);
      if (readAt !== -1) expect(readAt).toBeGreaterThan(recordLock);
    }
    // Bounded settlement work: after the lock, the authority issues at most the
    // diagnostic read, the guarded delete and the insert — a constant that does
    // not grow with the run's authored occurrences (12 of them here).
    expect(record.statements.slice(recordLock).length).toBeLessThanOrEqual(4);

    const undo = await statementsOf((db) =>
      productionUseCases(db).undo.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, first),
      }),
    );
    expect(undo.outcome.ok).toBe(true);
    const undoLock = firstIndex(undo.statements, 'for no key update');
    expect(undoLock).toBeGreaterThanOrEqual(0);
    const undoFactRead = firstIndex(undo.statements, 'not_performed_workouts');
    if (undoFactRead !== -1) expect(undoFactRead).toBeGreaterThan(undoLock);
    expect(undo.statements.slice(undoLock).length).toBeLessThanOrEqual(3);

    // No retry loop: a single logical write never issues the same statement
    // twice. (A retry would be a repeated identical statement.)
    expect(new Set(record.statements).size).toBe(record.statements.length);
    expect(new Set(undo.statements).size).toBe(undo.statements.length);
  });


  it('locks the parent enrollment row before any session row is created', async () => {
    const run = await seedRaceRun();
    const [second] = occurrencesOf(run);

    const start = await statementsOf((db) =>
      productionUseCases(db).start.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        ...coordinatesOf(run.program, second),
      }),
    );
    expect(start.outcome.ok).toBe(true);

    const lock = firstIndex(start.statements, 'for no key update');
    const sessionWrite = firstIndex(start.statements, 'insert into "workout_sessions"');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(sessionWrite).toBeGreaterThan(lock);
  });

  it('keeps planning and lifecycle writes parent-first, with no pre-lock run read', async () => {
    // REGENERATION (M15): the lock precedes every planned_workouts statement.
    const run = await seedRaceRun();
    const configure = await statementsOf((db) =>
      productionUseCases(db).configure.execute({
        userId: OWNER,
        programSlug: PROGRAM_SLUG,
        weekdays: [1, 3, 5],
        now: NOW,
      }),
    );
    expect(configure.outcome.ok).toBe(true);
    const configureLock = firstIndex(configure.statements, 'for no key update');
    expect(configureLock).toBeGreaterThanOrEqual(0);
    // The M15 write transaction locks the parent row BEFORE it rewrites the
    // calendar: the freeze read that precedes it is a plain read, not a write.
    const firstPlannedWrite = configure.statements.findIndex(
      (statement) =>
        /^(delete|insert|update)/.test(statement) && statement.includes('planned_workouts'),
    );
    expect(firstPlannedWrite).toBeGreaterThan(configureLock);

    // RESTART (M14) and LEAVE (M14) remove the RUN itself, so their first WRITE
    // is the parent enrollment row — the same parent-first order, taken with the
    // strongest lock (the delete), before any session or settlement is touched.
    // Restart needs a restartable run, so the concluded fixture is seeded.
    await seedConcludedRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    const restart = await statementsOf((db) =>
      productionUseCases(db).restart.execute({ userId: OTHER_OWNER, programSlug: PROGRAM_SLUG }),
    );
    expect(restart.outcome.ok).toBe(true);
    const restartWrite = restart.statements.findIndex((statement) =>
      /^(delete|insert|update)/.test(statement),
    );
    expect(restartWrite).toBeGreaterThanOrEqual(0);
    expect(restart.statements[restartWrite]).toContain('delete from "program_enrollments"');
    // Reads may precede it (restartability needs the run's sessions and facts),
    // but no CHILD row may be written before the parent row is replaced.
    for (const child of ['workout_sessions', 'not_performed_workouts', 'planned_workouts']) {
      const childWrite = restart.statements.findIndex(
        (statement) =>
          /^(delete|insert|update)/.test(statement) && statement.includes(child),
      );
      if (childWrite !== -1) expect(childWrite).toBeGreaterThan(restartWrite);
    }
    expect(run.enrollmentId).toBe(RUN);

    const otherOwner = 'm17-race-leave-owner';
    const other = await seedRaceRun(otherOwner, enrollmentIdValue('enr-m17-race-c'));
    const leave = await statementsOf((db) =>
      productionUseCases(db).leave.execute({ userId: otherOwner, programSlug: PROGRAM_SLUG }),
    );
    expect(leave.outcome.ok).toBe(true);
    const leaveWrite = leave.statements.findIndex((statement) =>
      /^(delete|insert|update)/.test(statement),
    );
    expect(leaveWrite).toBeGreaterThanOrEqual(0);
    expect(leave.statements[leaveWrite]).toContain('delete from "program_enrollments"');
    expect(other.enrollmentId).toBe('enr-m17-race-c');
  });
});

