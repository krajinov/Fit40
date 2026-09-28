/**
 * M16 Slice 6 — the plan follow-through read over real PostgreSQL.
 *
 * Proves the whole vertical composes rather than just the orchestration: real
 * `planned_workouts` calendar intent plus real `workout_sessions` execution
 * facts, read through the Drizzle repositories, resolved by the real
 * `GetEnrollmentFollowThroughUseCase`, summarized by the Slice 1 Domain rules
 * and mapped by the Slice 3 DTO mapper.
 *
 * Nothing is mocked and no Domain summary is built by hand: the expected counts
 * are the M16 contract's own arithmetic, and the occurrence facts come from the
 * same domain factories and repositories production uses.
 *
 * Fixed clock: Thursday 2026-09-24T12:00Z. The current UTC week is
 * 2026-09-21 → 2026-09-28 and the 8-week horizon starts at 2026-08-03, so
 * "today" and the reported span never depend on the machine clock.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { ConfiguredFollowThroughDto } from '@/application/dto/follow-through';
import {
  FOLLOW_THROUGH_WEEK_COUNT,
  GetEnrollmentFollowThroughUseCase,
} from '@/application/use-cases/get-enrollment-follow-through';
import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import type { ExerciseId } from '@/domain/types/ids';
import { DrizzleNotPerformedOccurrenceRepository } from '@/infrastructure/database/repositories/drizzle-not-performed-occurrence-repository';
import { DrizzlePlannedWorkoutRepository } from '@/infrastructure/database/repositories/drizzle-planned-workout-repository';
import { DrizzleProgramEnrollmentRepository } from '@/infrastructure/database/repositories/drizzle-program-enrollment-repository';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import * as schema from '@/infrastructure/database/schema';

import { countFacts, insertFact } from './not-performed-fixtures';
import {
  enrollmentIdValue,
  firstCatalogExerciseId,
  listOccurrences,
  plannedLines,
  plannedWorkout,
  seedEnrolledRun,
  type PlannedRunFixture,
} from './planned-workout-fixtures';
import { reps, seedEnrollment, userId, workoutSessionId } from './personal-record-fixtures';
import {
  closeDatabase,
  notPerformedOccurrenceRepository,
  plannedWorkoutRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  workoutSessionRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';
import { insertSession } from './session-fixtures';

const PROGRAM_SLUG = 'fit40-beginner-strength';
const OTHER_PROGRAM_SLUG = 'strong-at-home';

const OWNER = 'follow-through-owner';
const OTHER_OWNER = 'follow-through-other';
const RUN = 'enr-follow-through';
const OTHER_RUN = 'enr-follow-through-other';
const LEFT_RUN = 'enr-follow-through-left';

/** Thursday noon UTC: the current week is 2026-09-21 → 2026-09-28. */
const NOW = new Date('2026-09-24T12:00:00.000Z');
const TODAY = '2026-09-24';

/**
 * One run's calendar intent, covering every execution state M16 can report:
 * early / on-plan / late completions, a live session, a past-due occurrence,
 * today's occurrence, and an upcoming one later in the current week. The last
 * row is dated in the NEXT week — outside the 8-week horizon — and must appear
 * in no week row and no total.
 */
const PLAN: ReadonlyArray<{ readonly occurrence: string; readonly date: string }> = [
  { occurrence: 'fit40-beginner-strength-w1-1', date: '2026-08-04' },
  { occurrence: 'fit40-beginner-strength-w1-2', date: '2026-08-05' },
  { occurrence: 'fit40-beginner-strength-w2-2', date: '2026-09-15' },
  { occurrence: 'fit40-beginner-strength-w1-3', date: '2026-09-16' },
  { occurrence: 'fit40-beginner-strength-w2-1', date: '2026-09-22' },
  { occurrence: 'fit40-beginner-strength-w2-3', date: '2026-09-24' },
  { occurrence: 'fit40-beginner-strength-w3-1', date: '2026-09-26' },
  { occurrence: 'fit40-beginner-strength-w3-2', date: '2026-09-30' },
];

interface RunFixture extends PlannedRunFixture {
  readonly occurrencesById: ReadonlyMap<string, ScheduledWorkout>;
}

function byId(program: TrainingProgram): ReadonlyMap<string, ScheduledWorkout> {
  return new Map(listOccurrences(program).map((occurrence) => [occurrence.id, occurrence]));
}

function occurrenceOf(run: RunFixture, id: string): ScheduledWorkout {
  const occurrence = run.occurrencesById.get(id);
  if (occurrence === undefined) {
    throw new Error(`the seeded program has no occurrence "${id}"`);
  }
  return occurrence;
}

/** A real user + real enrollment in a seeded program, with its occurrences. */
async function seedRun(input: {
  readonly owner: string;
  readonly programSlug: string;
  readonly enrollmentId: string;
}): Promise<RunFixture> {
  const run = await seedEnrolledRun(input);
  return { ...run, occurrencesById: byId(run.program) };
}

/**
 * A second run for an owner who already exists (the shared helper seeds the
 * user, and a user id must not be inserted twice).
 */
async function seedAdditionalRun(input: {
  readonly owner: string;
  readonly programSlug: string;
  readonly enrollmentId: string;
}): Promise<RunFixture> {
  const program = await programRepository.findBySlug(input.programSlug);
  if (program === null) throw new Error(`seed program "${input.programSlug}" is missing`);

  await seedEnrollment(input.enrollmentId, input.owner, program.id);
  return {
    program,
    enrollmentId: input.enrollmentId,
    occurrenceIds: listOccurrences(program).map((occurrence) => occurrence.id),
    occurrencesById: byId(program),
  };
}

/** Stores one run's calendar through the real whole-set replacement write. */
async function configure(
  run: RunFixture,
  rows: ReadonlyArray<{ readonly occurrence: string; readonly date: string }>,
): Promise<void> {
  const planned = rows.map((row) => plannedWorkout(run.enrollmentId, row.occurrence, row.date));
  const replaced = await plannedWorkoutRepository.replaceAllForEnrollment(
    enrollmentIdValue(run.enrollmentId),
    planned,
  );
  expect(replaced).toBe(true);
}

/** Persists one execution fact through the real session write path. */
async function saveSession(input: {
  readonly id: string;
  readonly owner: string;
  readonly enrollment: string;
  readonly occurrence: ScheduledWorkout;
  readonly exercise: ExerciseId;
  readonly startedAt: string;
  /** Omitted leaves the session in progress. */
  readonly completedAt?: string;
}): Promise<WorkoutSession> {
  const created = createWorkoutSession({
    id: input.id,
    userId: userId(input.owner),
    enrollmentId: enrollmentIdValue(input.enrollment),
    scheduledWorkoutId: input.occurrence.id,
    workoutId: input.occurrence.workoutId,
    startedAt: new Date(input.startedAt),
    exerciseLogs: [
      { authoredExerciseId: input.exercise, order: 1, prescription: reps(), restSeconds: 60 },
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

  if (input.completedAt === undefined) {
    await insertSession(logged.data);
    return logged.data;
  }

  const completed = completeWorkoutSession(logged.data, new Date(input.completedAt));
  if (!completed.ok) throw new Error(completed.error.message);
  await insertSession(completed.data);
  return completed.data;
}

/** The real use case over the real repositories. */
function makeUseCase(): GetEnrollmentFollowThroughUseCase {
  return new GetEnrollmentFollowThroughUseCase(
    programEnrollmentRepository,
    plannedWorkoutRepository,
    workoutSessionRepository,
    notPerformedOccurrenceRepository,
  );
}

/** Runs the real read and asserts a configured report came back. */
async function readReport(
  owner: string,
  program: TrainingProgram,
): Promise<ConfiguredFollowThroughDto> {
  const result = await makeUseCase().execute({ userId: owner, program, now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  if (result.data === null || !result.data.configured) {
    throw new Error('expected a configured follow-through report');
  }
  return result.data;
}

describe('M16 plan follow-through over real PostgreSQL', () => {
  beforeEach(async () => {
    await resetAndSeed();
  });

  it('reports one real run of executions through the eight-week counts', async () => {
    const run = await seedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    const exercise = await firstCatalogExerciseId();
    await configure(run, PLAN);

    // The stored calendar is exactly the intent the report consumes: real rows,
    // real dates, one per occurrence, written through the replacement path.
    expect(
      plannedLines(await plannedWorkoutRepository.listByEnrollment(enrollmentIdValue(RUN))),
    ).toEqual([
      'fit40-beginner-strength-w1-1@2026-08-04',
      'fit40-beginner-strength-w1-2@2026-08-05',
      'fit40-beginner-strength-w2-2@2026-09-15',
      'fit40-beginner-strength-w1-3@2026-09-16',
      'fit40-beginner-strength-w2-1@2026-09-22',
      'fit40-beginner-strength-w2-3@2026-09-24',
      'fit40-beginner-strength-w3-1@2026-09-26',
      'fit40-beginner-strength-w3-2@2026-09-30',
    ]);

    // Real execution facts: two early-week completions (one before its planned
    // date, one on it), a late completion, and one live session.
    await saveSession({
      id: 'ff-early',
      owner: OWNER,
      enrollment: RUN,
      occurrence: occurrenceOf(run, 'fit40-beginner-strength-w1-1'),
      exercise,
      startedAt: '2026-08-03T08:00:00Z',
      completedAt: '2026-08-03T09:00:00Z',
    });
    await saveSession({
      id: 'ff-on-plan',
      owner: OWNER,
      enrollment: RUN,
      occurrence: occurrenceOf(run, 'fit40-beginner-strength-w1-2'),
      exercise,
      startedAt: '2026-08-05T08:00:00Z',
      completedAt: '2026-08-05T09:30:00Z',
    });
    await saveSession({
      id: 'ff-late',
      owner: OWNER,
      enrollment: RUN,
      occurrence: occurrenceOf(run, 'fit40-beginner-strength-w1-3'),
      exercise,
      startedAt: '2026-09-18T08:00:00Z',
      completedAt: '2026-09-18T09:00:00Z',
    });
    await saveSession({
      id: 'ff-live',
      owner: OWNER,
      enrollment: RUN,
      occurrence: occurrenceOf(run, 'fit40-beginner-strength-w2-1'),
      exercise,
      startedAt: '2026-09-22T08:00:00Z',
    });

    const dto = await readReport(OWNER, run.program);

    expect(FOLLOW_THROUGH_WEEK_COUNT).toBe(8);
    expect(dto.programSlug).toBe(PROGRAM_SLUG);
    expect(dto.today).toBe(TODAY);
    // Only the weeks holding planned rows are reported — the seven empty windows
    // in between are omitted, never rendered as zero weeks — and `closed`
    // follows the supplied clock exactly.
    expect(dto.weeks.map((week) => week.weekStart)).toEqual([
      '2026-08-03T00:00:00.000Z',
      '2026-09-14T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
    ]);
    expect(dto.weeks.map((week) => week.weekEnd)).toEqual([
      '2026-08-10T00:00:00.000Z',
      '2026-09-21T00:00:00.000Z',
      '2026-09-28T00:00:00.000Z',
    ]);
    expect(dto.weeks.map((week) => week.closed)).toEqual([true, true, false]);

    expect(dto.weeks[0]).toEqual({
      weekStart: '2026-08-03T00:00:00.000Z',
      weekEnd: '2026-08-10T00:00:00.000Z',
      closed: true,
      planned: 2,
      completed: 2,
      completedEarly: 1,
      completedLate: 0,
      started: 0,
      pastDue: 0,
      notPerformed: 0,
    });
    expect(dto.weeks[1]).toEqual({
      weekStart: '2026-09-14T00:00:00.000Z',
      weekEnd: '2026-09-21T00:00:00.000Z',
      closed: true,
      planned: 2,
      completed: 1,
      completedEarly: 0,
      completedLate: 1,
      started: 0,
      pastDue: 1,
      notPerformed: 0,
    });
    expect(dto.weeks[2]).toEqual({
      weekStart: '2026-09-21T00:00:00.000Z',
      weekEnd: '2026-09-28T00:00:00.000Z',
      closed: false,
      planned: 3,
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 1,
      pastDue: 0,
      notPerformed: 0,
    });

    // Seven planned rows, seven execution states: three completions (one early,
    // one on plan, one late), one live session, one past due, and two rows dated
    // today or later in the current week (today and upcoming). The six counters
    // must account for every row exactly once.
    expect(dto.totals).toEqual({
      planned: 7,
      completed: 3,
      completedEarly: 1,
      completedLate: 1,
      started: 1,
      pastDue: 1,
      notPerformed: 0,
    });
    expect(dto.totals.completed - (dto.totals.completedEarly + dto.totals.completedLate)).toBe(1);
    expect(
      dto.totals.planned - (dto.totals.completed + dto.totals.started + dto.totals.pastDue),
    ).toBe(2);
    // The next-week row is outside the reported span: reported in no week and in
    // no total (the horizon is the eight weeks ending with the current one).
    expect(dto.totals.planned).toBe(7);

    // Totals are the sum of the returned rows — every counter, including the M17
    // recorded-not-performed one, and nothing that a week did not report.
    const summed = dto.weeks.reduce(
      (sum, week) => ({
        planned: sum.planned + week.planned,
        completed: sum.completed + week.completed,
        completedEarly: sum.completedEarly + week.completedEarly,
        completedLate: sum.completedLate + week.completedLate,
        started: sum.started + week.started,
        pastDue: sum.pastDue + week.pastDue,
        notPerformed: sum.notPerformed + week.notPerformed,
      }),
      {
        planned: 0,
        completed: 0,
        completedEarly: 0,
        completedLate: 0,
        started: 0,
        pastDue: 0,
        notPerformed: 0,
      },
    );
    expect(summed).toEqual(dto.totals);
  });

  it('reports only current calendar intent: an unplanned completed occurrence stays history', async () => {
    const run = await seedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    const exercise = await firstCatalogExerciseId();
    // Planned for TODAY: nothing else can move this row's counts.
    await configure(run, [{ occurrence: 'fit40-beginner-strength-w2-1', date: TODAY }]);

    // A real completion for an occurrence that holds no planned row today — the
    // occurrence was never on this calendar, or was removed from it — completed
    // in the very week the report covers. M16 is current-plan follow-through, so
    // no historical intent is reconstructed and no fact is injected.
    const orphan = await saveSession({
      id: 'ff-orphan',
      owner: OWNER,
      enrollment: RUN,
      occurrence: occurrenceOf(run, 'fit40-beginner-strength-w5-1'),
      exercise,
      startedAt: '2026-09-23T08:00:00Z',
      completedAt: '2026-09-23T09:00:00Z',
    });

    const dto = await readReport(OWNER, run.program);

    // The session is real history, and the activity read does return it …
    expect(await workoutSessionRepository.findById(orphan.id)).not.toBeNull();
    expect(
      await workoutSessionRepository.listCompletedOccurrenceActivity(enrollmentIdValue(RUN)),
    ).toHaveLength(1);

    // … but it never becomes a report occurrence: only the planned row counts,
    // and its completion adds nothing to this week.
    expect(dto.weeks).toHaveLength(1);
    expect(dto.weeks[0]?.planned).toBe(1);
    expect(dto.weeks[0]?.completed).toBe(0);
    expect(dto.totals).toEqual({
      planned: 1,
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 0,
      notPerformed: 0,
    });
  });

  it('keeps another run and detached history out of this report', async () => {
    const exercise = await firstCatalogExerciseId();

    const run = await seedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    await configure(run, [{ occurrence: 'fit40-beginner-strength-w1-3', date: '2026-09-16' }]);
    await saveSession({
      id: 'ff-run-session',
      owner: OWNER,
      enrollment: RUN,
      occurrence: occurrenceOf(run, 'fit40-beginner-strength-w1-3'),
      exercise,
      startedAt: '2026-09-18T08:00:00Z',
      completedAt: '2026-09-18T09:00:00Z',
    });

    // Another user's run of the same program: its own calendar and completions.
    const otherRun = await seedRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });
    await configure(otherRun, [
      { occurrence: 'fit40-beginner-strength-w2-1', date: '2026-09-22' },
      { occurrence: 'fit40-beginner-strength-w2-2', date: '2026-09-23' },
    ]);
    await saveSession({
      id: 'ff-other-1',
      owner: OTHER_OWNER,
      enrollment: OTHER_RUN,
      occurrence: occurrenceOf(otherRun, 'fit40-beginner-strength-w2-1'),
      exercise,
      startedAt: '2026-09-22T08:00:00Z',
      completedAt: '2026-09-22T09:00:00Z',
    });
    await saveSession({
      id: 'ff-other-2',
      owner: OTHER_OWNER,
      enrollment: OTHER_RUN,
      occurrence: occurrenceOf(otherRun, 'fit40-beginner-strength-w2-2'),
      exercise,
      startedAt: '2026-09-23T08:00:00Z',
      completedAt: '2026-09-23T09:00:00Z',
    });

    // This owner's earlier run of another program, left: the enrollment (and its
    // planning) is deleted while its completed sessions are detached, not lost.
    const leftRun = await seedAdditionalRun({
      owner: OWNER,
      programSlug: OTHER_PROGRAM_SLUG,
      enrollmentId: LEFT_RUN,
    });
    await saveSession({
      id: 'ff-left-session',
      owner: OWNER,
      enrollment: LEFT_RUN,
      occurrence: occurrenceOf(leftRun, 'strong-at-home-w1-1'),
      exercise,
      startedAt: '2026-09-20T08:00:00Z',
      completedAt: '2026-09-20T09:00:00Z',
    });
    expect(await programEnrollmentRepository.delete(enrollmentIdValue(LEFT_RUN))).toBe(true);

    const dto = await readReport(OWNER, run.program);

    // Only this run's own row and completion: the other run and the detached
    // history contribute nothing.
    expect(dto.totals).toEqual({
      planned: 1,
      completed: 1,
      completedEarly: 0,
      completedLate: 1,
      started: 0,
      pastDue: 0,
      notPerformed: 0,
    });

    // The other run answers for itself, unaffected by this one.
    const otherDto = await readReport(OTHER_OWNER, otherRun.program);
    expect(otherDto.totals).toEqual({
      planned: 2,
      completed: 2,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 0,
      notPerformed: 0,
    });

    // Detached history survives as the owner's data, attached to no run.
    const detached = await workoutSessionRepository.findById(workoutSessionId('ff-left-session'));
    expect(detached?.enrollmentId).toBeNull();
    expect(
      await workoutSessionRepository.listCompletedOccurrenceActivity(enrollmentIdValue(LEFT_RUN)),
    ).toEqual([]);
  });

  it('reads the report with five SELECTs and no write', async () => {
    const run = await seedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    const exercise = await firstCatalogExerciseId();
    await configure(run, [{ occurrence: 'fit40-beginner-strength-w1-1', date: '2026-08-04' }]);
    await saveSession({
      id: 'ff-read-only',
      owner: OWNER,
      enrollment: RUN,
      occurrence: occurrenceOf(run, 'fit40-beginner-strength-w1-1'),
      exercise,
      startedAt: '2026-08-04T08:00:00Z',
      completedAt: '2026-08-04T09:00:00Z',
    });

    // Everything above is fixture setup through the shared repositories. The
    // statements observed below belong to the M16 read alone: a dedicated
    // logging client, warmed first so postgres.js' one-time type introspection
    // is not part of the count.
    const queries: string[] = [];
    const loggingClient = postgres(getTestDatabaseUrl(), {
      max: 1,
      debug: (_connection: number, query: string) => {
        queries.push(query.trim().toLowerCase());
      },
    });

    try {
      const loggingDb = drizzle(loggingClient, { schema });
      const useCase = new GetEnrollmentFollowThroughUseCase(
        new DrizzleProgramEnrollmentRepository(loggingDb),
        new DrizzlePlannedWorkoutRepository(loggingDb),
        new DrizzleWorkoutSessionRepository(loggingDb),
        new DrizzleNotPerformedOccurrenceRepository(loggingDb),
      );

      await useCase.execute({ userId: OWNER, program: run.program, now: NOW });
      queries.length = 0;

      const result = await useCase.execute({ userId: OWNER, program: run.program, now: NOW });

      expect(result.ok).toBe(true);
      // Five bounded statements: the enrollment lookup, the run's planned rows,
      // and the three independent occurrence reads — never one query per row.
      expect(queries).toHaveLength(5);
      expect(queries.filter((query) => !query.startsWith('select'))).toEqual([]);
      expect(queries.some((query) => query.includes('program_enrollments'))).toBe(true);
      expect(queries.some((query) => query.includes('planned_workouts'))).toBe(true);
      expect(queries.filter((query) => query.includes('workout_sessions'))).toHaveLength(2);
      // The M17 fact projection is one statement, not one per occurrence.
      expect(queries.filter((query) => query.includes('not_performed_workouts'))).toHaveLength(1);
      // Read-only: the report never inserts, updates or deletes anything.
      expect(queries.filter((query) => /^(insert|update|delete)/.test(query))).toEqual([]);
    } finally {
      await loggingClient.end();
    }
  });
});

/**
 * M17 Slice 9 — the three locked buckets, on real PostgreSQL.
 *
 * One combined scenario, so the distinctions are proved against real rows and
 * the real read path rather than against stubs: a recorded fact whose planned row
 * is inside the reported weeks, one whose planned row is outside them, and one
 * with no row at all. A second run's record proves nothing leaks.
 */
describe('M17 Slice 9 — recorded facts in the M16 report over real PostgreSQL', () => {
  const IN_HORIZON_RECORDED = 'fit40-beginner-strength-w2-2';
  const IN_HORIZON_PLAIN = 'fit40-beginner-strength-w1-3';
  const OUT_OF_HORIZON_RECORDED = 'fit40-beginner-strength-w3-2';
  /** An authored occurrence this run has no planned row for. */
  const ROWLESS_RECORDED = 'fit40-beginner-strength-w3-1';

  beforeEach(async () => {
    await resetAndSeed();
  });

  it('places each recorded fact in its own bucket, widening no horizon', async () => {
    const run = await seedRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN });
    const other = await seedRun({
      owner: OTHER_OWNER,
      programSlug: OTHER_PROGRAM_SLUG,
      enrollmentId: OTHER_RUN,
    });

    await configure(run, [
      // Bucket 1: inside the eight reported weeks, recorded.
      { occurrence: IN_HORIZON_RECORDED, date: '2026-09-15' },
      // Inside the horizon, not recorded.
      { occurrence: IN_HORIZON_PLAIN, date: '2026-09-16' },
      // Bucket 2: the next week — beyond the last reported window, recorded.
      { occurrence: OUT_OF_HORIZON_RECORDED, date: '2026-09-30' },
    ]);
    await insertFact({
      enrollmentId: RUN,
      scheduledWorkoutId: IN_HORIZON_RECORDED,
      recordedAt: '2026-09-16T18:00:00.000Z',
    });
    await insertFact({
      enrollmentId: RUN,
      scheduledWorkoutId: OUT_OF_HORIZON_RECORDED,
      recordedAt: '2026-09-30T18:00:00.000Z',
    });
    // Bucket 3: recorded, with no planned row for its authored occurrence.
    await insertFact({
      enrollmentId: RUN,
      scheduledWorkoutId: ROWLESS_RECORDED,
      recordedAt: '2026-09-24T18:00:00.000Z',
    });

    // Another run of another program with a rowed and a rowless record of its own.
    const [otherRowed, otherRowless] = other.occurrenceIds;
    if (otherRowed === undefined || otherRowless === undefined) {
      throw new Error('expected the seeded program to author at least two occurrences');
    }
    await configure(other, [{ occurrence: otherRowed, date: '2026-09-16' }]);
    await insertFact({
      enrollmentId: OTHER_RUN,
      scheduledWorkoutId: otherRowless,
      recordedAt: '2026-09-24T18:00:00.000Z',
    });

    const dto = await readReport(OWNER, run.program);

    // Bucket 1 — one week only: the recorded row is planned AND not performed
    // (never past due), the unrecorded row is genuinely behind.
    expect(FOLLOW_THROUGH_WEEK_COUNT).toBe(8);
    expect(dto.weeks.map((week) => week.weekStart)).toEqual(['2026-09-14T00:00:00.000Z']);
    expect(dto.weeks[0]).toMatchObject({
      planned: 2,
      // The recorded row is settled; the unrecorded row is genuinely behind.
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 1,
      notPerformed: 1,
    });

    // Bucket 2 — the out-of-horizon row contributes no week, no count and no
    // total: the fact pulled nothing into the report (2 of the 3 rows are in it).
    expect(dto.weeks.some((week) => week.weekStart === '2026-09-28T00:00:00.000Z')).toBe(false);
    expect(dto.totals).toEqual({
      planned: 2,
      completed: 0,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 1,
      notPerformed: 1,
    });

    // Bucket 3 — the rowless record is a count and nothing else. The
    // out-of-horizon occurrence has a row, so it is NOT part of this count.
    expect(dto.notPerformedUnplaced).toBe(1);

    // Read-only, and run-scoped: the persisted facts are untouched, and the other
    // run's record is reported only to its own owner.
    expect(await countFacts(RUN)).toBe(3);
    expect(await countFacts(OTHER_RUN)).toBe(1);

    const otherDto = await readReport(OTHER_OWNER, other.program);
    expect(otherDto.totals.planned).toBe(1);
    expect(otherDto.totals.notPerformed).toBe(0);
    expect(otherDto.notPerformedUnplaced).toBe(1);
  });
});

afterAll(async () => {
  await closeDatabase();
});
