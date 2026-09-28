import { describe, expect, it, vi } from 'vitest';

import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { EnrollmentScheduleDto } from '@/application/dto/schedule';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import { GetEnrollmentScheduleUseCase } from '@/application/use-cases/get-enrollment-schedule';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryPlannedWorkoutRepository } from '@/infrastructure/scheduling/in-memory-planned-workout-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

import {
  enrollment,
  enrollmentId,
  FRI,
  LAST_FRI,
  LAST_WED,
  makeNotPerformedRepo,
  makeProgram,
  notPerformedFact,
  MON,
  NEXT_MON,
  NEXT_WED,
  NOW,
  OCCURRENCE_W1_1,
  OCCURRENCE_W1_2,
  OCCURRENCE_W1_3,
  OCCURRENCE_W2_1,
  OCCURRENCE_W2_3,
  planned,
  PROGRAM_SLUG,
  saveCompletedSession,
  saveInProgressSession,
  WED,
  WORKOUT_A,
  WORKOUT_B,
} from './schedule-fixtures';

const PROGRAM = makeProgram();

const USER_A = 'user-a';
const ENR_A = 'enr-a';
const USER_B = 'user-b';
const ENR_B = 'enr-b';

function makeHarness(facts: ReadonlyArray<NotPerformedOccurrence> = []) {
  const enrollments = new InMemoryProgramEnrollmentRepository();
  const plannedWorkouts = new InMemoryPlannedWorkoutRepository();
  const sessions = new InMemoryWorkoutSessionRepository();
  const notPerformed = makeNotPerformedRepo(facts);
  const useCase = new GetEnrollmentScheduleUseCase(
    enrollments,
    plannedWorkouts,
    sessions,
    notPerformed,
  );
  return { enrollments, plannedWorkouts, sessions, notPerformed, useCase };
}

type Harness = ReturnType<typeof makeHarness>;

async function enrolledRun(harness: Harness, id = ENR_A, owner = USER_A): Promise<void> {
  await harness.enrollments.create(enrollment(id, owner));
}

/** Runs the read and asserts it succeeded, returning the DTO (or null). */
async function readSchedule(
  harness: Harness,
  userId = USER_A,
): Promise<EnrollmentScheduleDto | null> {
  const result = await harness.useCase.execute({ userId, program: PROGRAM, now: NOW });
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Runs the read and asserts an enrolled, configured outcome. */
async function readConfigured(harness: Harness): Promise<EnrollmentScheduleDto> {
  const schedule = await readSchedule(harness);
  if (schedule === null || !schedule.configured) {
    throw new Error('expected a configured schedule');
  }
  return schedule;
}

describe('GetEnrollmentScheduleUseCase', () => {
  it('rejects an invalid user id', async () => {
    const harness = makeHarness();

    const result = await harness.useCase.execute({ userId: '  ', program: PROGRAM, now: NOW });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'INVALID_INPUT', field: 'userId' });
  });

  it('returns null when the user is not enrolled, never reading another user\'s schedule', async () => {
    const harness = makeHarness();
    await harness.enrollments.create(enrollment(ENR_B, USER_B));
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_B), [
      planned(ENR_B, OCCURRENCE_W1_1, MON),
    ]);
    const listByEnrollment = vi.spyOn(harness.plannedWorkouts, 'listByEnrollment');

    const result = await harness.useCase.execute({
      userId: USER_A,
      program: PROGRAM,
      now: NOW,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toBeNull();
    // Ownership is resolved before any planning read: the other user's run is
    // never even fetched.
    expect(listByEnrollment).not.toHaveBeenCalled();
  });

  it('reports an enrolled but unconfigured run without inventing dates', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);

    const schedule = await readSchedule(harness);

    expect(schedule).toEqual({
      programSlug: PROGRAM_SLUG,
      configured: false,
      today: MON,
      items: [],
      unplacedNotPerformedWorkouts: [],
      focus: { today: null, next: null, pastDue: null, notPerformedRecorded: 0 },
    });
  });

  it('maps every planned workout to its authored occurrence metadata in calendar order', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    // Inserted out of calendar order on purpose: the read orders by date.
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W2_1, NEXT_WED),
      planned(ENR_A, OCCURRENCE_W1_1, MON),
      planned(ENR_A, OCCURRENCE_W1_2, WED),
    ]);

    const schedule = await readConfigured(harness);

    expect(schedule.configured).toBe(true);
    expect(schedule.today).toBe(MON);
    expect(schedule.items).toEqual([
      {
        scheduledWorkoutId: OCCURRENCE_W1_1,
        weekNumber: 1,
        workoutOrder: 1,
        workoutName: 'Workout A',
        plannedDate: MON,
        status: 'planned',
      },
      {
        scheduledWorkoutId: OCCURRENCE_W1_2,
        weekNumber: 1,
        workoutOrder: 2,
        workoutName: 'Workout B',
        plannedDate: WED,
        status: 'planned',
      },
      {
        scheduledWorkoutId: OCCURRENCE_W2_1,
        weekNumber: 2,
        workoutOrder: 1,
        workoutName: 'Workout A',
        plannedDate: NEXT_WED,
        status: 'planned',
      },
    ]);
  });

  it('derives status from session truth first and the calendar second', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, LAST_FRI),
      planned(ENR_A, OCCURRENCE_W1_2, MON),
      planned(ENR_A, OCCURRENCE_W1_3, WED),
      planned(ENR_A, OCCURRENCE_W2_1, FRI),
    ]);
    await saveInProgressSession(harness.sessions, {
      id: 's-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_2,
      workoutId: WORKOUT_B,
    });
    await saveCompletedSession(harness.sessions, {
      id: 's-done',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W2_1,
      workoutId: WORKOUT_A,
    });

    const schedule = await readConfigured(harness);

    expect(schedule.items.map((item) => [item.scheduledWorkoutId, item.status])).toEqual([
      [OCCURRENCE_W1_1, 'past-due'],
      [OCCURRENCE_W1_2, 'in-progress'],
      [OCCURRENCE_W1_3, 'planned'],
      [OCCURRENCE_W2_1, 'completed'],
    ]);
  });

  it('keeps an in-progress workout dated in the past as in-progress, never past-due', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, LAST_FRI),
    ]);
    await saveInProgressSession(harness.sessions, {
      id: 's-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
    });

    const schedule = await readConfigured(harness);

    expect(schedule.items[0]?.status).toBe('in-progress');
    // A workout being performed right now is not "behind schedule".
    expect(schedule.focus.pastDue).toBeNull();
    expect(schedule.focus.today).toBeNull();
    expect(schedule.focus.next).toBeNull();
  });

  it('selects today and next from the calendar, and counts every past-due workout', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, LAST_WED),
      planned(ENR_A, OCCURRENCE_W1_2, LAST_FRI),
      planned(ENR_A, OCCURRENCE_W1_3, MON),
      planned(ENR_A, OCCURRENCE_W2_1, NEXT_MON),
    ]);
    await saveCompletedSession(harness.sessions, {
      id: 's-done',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_3,
    });

    const schedule = await readConfigured(harness);

    // A workout already completed today is still today's workout.
    expect(schedule.focus.today?.scheduledWorkoutId).toBe(OCCURRENCE_W1_3);
    expect(schedule.focus.today?.status).toBe('completed');
    expect(schedule.focus.next?.scheduledWorkoutId).toBe(OCCURRENCE_W2_1);
    expect(schedule.focus.pastDue?.count).toBe(2);
    expect(schedule.focus.pastDue?.earliest.scheduledWorkoutId).toBe(OCCURRENCE_W1_1);
    expect(schedule.focus.pastDue?.earliest.plannedDate).toBe(LAST_WED);
  });

  it('orders items by calendar date even when the repository returns them unordered', async () => {
    const enrollments = new InMemoryProgramEnrollmentRepository();
    await enrollments.create(enrollment(ENR_A, USER_A));
    const rows = [
      planned(ENR_A, OCCURRENCE_W2_1, NEXT_WED),
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ];
    const plannedRepo = {
      listByEnrollment: vi.fn(async () => [...rows].reverse()),
      replaceAllForEnrollment: vi.fn(),
      reschedule: vi.fn(),
    } satisfies PlannedWorkoutRepository;
    const sessions = new InMemoryWorkoutSessionRepository();
    const useCase = new GetEnrollmentScheduleUseCase(
      enrollments,
      plannedRepo,
      sessions,
      makeNotPerformedRepo(),
    );

    const result = await useCase.execute({ userId: USER_A, program: PROGRAM, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok || result.data === null) throw new Error('expected a schedule');
    expect(result.data.items.map((item) => item.scheduledWorkoutId)).toEqual([
      OCCURRENCE_W1_1,
      OCCURRENCE_W2_1,
    ]);
    expect(plannedRepo.replaceAllForEnrollment).not.toHaveBeenCalled();
    expect(plannedRepo.reschedule).not.toHaveBeenCalled();
  });

  it('fails loudly when a persisted planned row is not an occurrence of the program', async () => {
    const enrollments = new InMemoryProgramEnrollmentRepository();
    await enrollments.create(enrollment(ENR_A, USER_A));
    const plannedRepo = {
      listByEnrollment: vi.fn(async () => [planned(ENR_A, 'sched-other-program-1', MON)]),
      replaceAllForEnrollment: vi.fn(),
      reschedule: vi.fn(),
    } satisfies PlannedWorkoutRepository;
    const sessions = new InMemoryWorkoutSessionRepository();
    const useCase = new GetEnrollmentScheduleUseCase(
      enrollments,
      plannedRepo,
      sessions,
      makeNotPerformedRepo(),
    );

    await expect(
      useCase.execute({ userId: USER_A, program: PROGRAM, now: NOW }),
    ).rejects.toThrow(/not an occurrence of program/);
  });

  it('never writes: no planning mutation and no session mutation', async () => {
    const harness = makeHarness();
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
      planned(ENR_A, OCCURRENCE_W1_2, WED),
    ]);
    const replaceAll = vi.spyOn(harness.plannedWorkouts, 'replaceAllForEnrollment');
    const reschedule = vi.spyOn(harness.plannedWorkouts, 'reschedule');
    const save = vi.spyOn(harness.sessions, 'save');

    const schedule = await readConfigured(harness);

    expect(schedule.items).toHaveLength(2);
    expect(replaceAll).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });
});

/**
 * M17 Slice 8 — real not-performed facts in the M15 read model.
 *
 * The fact reaches the EXISTING Slice 2 taxonomy (no second status resolver) and
 * is projected separately when the recorded occurrence has no planned row at all,
 * because a missing row must never erase settlement truth.
 */
describe('GetEnrollmentScheduleUseCase — recorded not-performed facts', () => {
  /** A run with three dated rows and one recorded occurrence among them. */
  async function recordedRun(
    harness: Harness,
    rows: ReadonlyArray<'W1_1' | 'W1_2' | 'W1_3'> = ['W1_1', 'W1_2', 'W1_3'],
  ): Promise<void> {
    await enrolledRun(harness);
    const byName = {
      W1_1: { id: OCCURRENCE_W1_1, date: LAST_WED },
      W1_2: { id: OCCURRENCE_W1_2, date: MON },
      W1_3: { id: OCCURRENCE_W1_3, date: WED },
    } as const;
    await harness.plannedWorkouts.replaceAllForEnrollment(
      enrollmentId(ENR_A),
      rows.map((name) => planned(ENR_A, byName[name].id, byName[name].date)),
    );
  }

  it('resolves a dated recorded occurrence to not-performed', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_2)]);
    await recordedRun(harness);

    const schedule = await readConfigured(harness);

    const recorded = schedule.items.find(
      (item) => item.scheduledWorkoutId === OCCURRENCE_W1_2,
    );
    expect(recorded?.status).toBe('not-performed');
    expect(recorded?.plannedDate).toBe(MON);
    // The factual count is exposed, and the recorded item is not a catch-up.
    expect(schedule.focus.notPerformedRecorded).toBe(1);
    expect(schedule.unplacedNotPerformedWorkouts).toEqual([]);
  });

  it('keeps the locked precedence: a live session outranks the record', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_2)]);
    await recordedRun(harness);
    await saveInProgressSession(harness.sessions, {
      id: 's-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_2,
    });

    const schedule = await readConfigured(harness);

    expect(
      schedule.items.find((item) => item.scheduledWorkoutId === OCCURRENCE_W1_2)?.status,
    ).toBe('in-progress');
  });

  it('fails loudly when a recorded occurrence is also completed (I1)', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_2)]);
    await recordedRun(harness);
    await saveCompletedSession(harness.sessions, {
      id: 's-done',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_2,
    });

    await expect(readSchedule(harness)).rejects.toThrow(/both completed and recorded/);
  });

  it('excludes a recorded past-due item from pastDue and a recorded future item from next', async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W1_1),
      notPerformedFact(ENR_A, OCCURRENCE_W1_3),
    ]);
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, LAST_WED),
      planned(ENR_A, OCCURRENCE_W1_2, MON),
      planned(ENR_A, OCCURRENCE_W1_3, NEXT_WED),
    ]);

    const schedule = await readConfigured(harness);

    // W1_1 is dated before today and W1_3 after today: neither is actionable.
    expect(schedule.focus.pastDue).toBeNull();
    expect(schedule.focus.next).toBeNull();
    expect(schedule.focus.notPerformedRecorded).toBe(2);
  });

  it('keeps a recorded item dated today in today focus with its recorded status', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_2)]);
    await recordedRun(harness);

    const schedule = await readConfigured(harness);

    expect(schedule.focus.today?.scheduledWorkoutId).toBe(OCCURRENCE_W1_2);
    expect(schedule.focus.today?.status).toBe('not-performed');
  });

  it('leaves unrecorded occurrences exactly as they were', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_2)]);
    await recordedRun(harness);
    await saveCompletedSession(harness.sessions, {
      id: 's-done',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_3,
    });

    const schedule = await readConfigured(harness);

    const statusById = new Map(schedule.items.map((item) => [item.scheduledWorkoutId, item.status]));
    expect(statusById.get(OCCURRENCE_W1_1)).toBe('past-due');
    expect(statusById.get(OCCURRENCE_W1_2)).toBe('not-performed');
    expect(statusById.get(OCCURRENCE_W1_3)).toBe('completed');
  });
});



/**
 * The unplaced projection: recorded occurrences that hold NO current row.
 *
 * The definition is exact — recorded AND no row — and it is deliberately
 * independent of any date or horizon, so a rowless fact is never erased and
 * never given a fabricated date.
 */
describe('GetEnrollmentScheduleUseCase — unplaced not-performed projection', () => {
  async function runWithRows(
    harness: Harness,
    rows: ReadonlyArray<{ readonly occurrence: string; readonly date: string }>,
  ): Promise<void> {
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(
      enrollmentId(ENR_A),
      rows.map((row) => planned(ENR_A, row.occurrence, row.date)),
    );
  }

  it('projects a recorded occurrence with no row exactly once, with authored labels', async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W1_3, '2026-09-24T18:30:00.000Z'),
    ]);
    await runWithRows(harness, [{ occurrence: OCCURRENCE_W1_1, date: MON }]);

    const schedule = await readConfigured(harness);

    expect(schedule.unplacedNotPerformedWorkouts).toEqual([
      {
        scheduledWorkoutId: OCCURRENCE_W1_3,
        weekNumber: 1,
        workoutOrder: 3,
        workoutName: 'Workout C',
        recordedAtIso: '2026-09-24T18:30:00.000Z',
      },
    ]);
    // Never a dated item, never in focus, and never counted as a row.
    expect(schedule.items.map((item) => item.scheduledWorkoutId)).toEqual([OCCURRENCE_W1_1]);
    expect(schedule.focus.notPerformedRecorded).toBe(0);
    // The one row is today's item; the rowless fact adds nothing to focus.
    expect(schedule.focus.today?.scheduledWorkoutId).toBe(OCCURRENCE_W1_1);
  });

  it('keeps a recorded occurrence that still holds a row out of the projection', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_1)]);
    await runWithRows(harness, [{ occurrence: OCCURRENCE_W1_1, date: MON }]);

    const schedule = await readConfigured(harness);

    expect(schedule.unplacedNotPerformedWorkouts).toEqual([]);
    expect(schedule.items[0]?.status).toBe('not-performed');
  });

  it("never leaks another enrollment's recorded facts", async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_B, OCCURRENCE_W1_3),
      notPerformedFact(ENR_A, OCCURRENCE_W1_2),
    ]);
    await enrolledRun(harness);
    await harness.enrollments.create(enrollment(ENR_B, USER_B));
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ]);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_B), [
      planned(ENR_B, OCCURRENCE_W1_1, MON),
    ]);

    const schedule = await readConfigured(harness);

    expect(schedule.unplacedNotPerformedWorkouts.map((item) => item.workoutOrder)).toEqual([2]);
  });

  it('projects recorded facts in authored program order, not read order', async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W2_1),
      notPerformedFact(ENR_A, OCCURRENCE_W1_3),
      notPerformedFact(ENR_A, OCCURRENCE_W1_1),
    ]);
    await runWithRows(harness, [{ occurrence: OCCURRENCE_W2_3, date: NEXT_WED }]);

    const schedule = await readConfigured(harness);

    expect(schedule.unplacedNotPerformedWorkouts.map((item) => item.scheduledWorkoutId)).toEqual([
      OCCURRENCE_W1_1,
      OCCURRENCE_W1_3,
      OCCURRENCE_W2_1,
    ]);
  });
});

describe('GetEnrollmentScheduleUseCase — rowless facts, horizons and undo', () => {
  it('is horizon-independent: far past, today and far future reads are identical', async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W1_1),
      notPerformedFact(ENR_A, OCCURRENCE_W2_3),
    ]);
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_2, MON),
    ]);

    const readAt = async (now: Date) => {
      const result = await harness.useCase.execute({ userId: USER_A, program: PROGRAM, now });
      if (!result.ok || result.data === null) throw new Error('expected a schedule');
      return result.data.unplacedNotPerformedWorkouts;
    };

    const farPast = await readAt(new Date('2020-01-01T00:00:00Z'));
    const today = await readAt(NOW);
    const farFuture = await readAt(new Date('2030-01-01T00:00:00Z'));

    // No week window and no date rule may remove a rowless fact, in either
    // horizon direction.
    expect(farPast).toEqual(today);
    expect(farFuture).toEqual(today);
    expect(today.map((item) => item.weekNumber)).toEqual([1, 2]);
  });

  it('projects rowless facts even when the run has no planned row at all', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_1)]);
    await enrolledRun(harness);

    const schedule = await readSchedule(harness);

    expect(schedule?.configured).toBe(false);
    expect(schedule?.items).toEqual([]);
    expect(schedule?.unplacedNotPerformedWorkouts).toHaveLength(1);
  });

  it('drops the projection when the fact is gone, synthesizing no row', async () => {
    const withFact = makeHarness([notPerformedFact(ENR_A, OCCURRENCE_W1_1)]);
    await enrolledRun(withFact);
    await withFact.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_2, MON),
    ]);
    expect((await readConfigured(withFact)).unplacedNotPerformedWorkouts).toHaveLength(1);

    // The same run read WITHOUT the fact: the read model has no write path, so
    // removing the fact is the whole undo lifecycle at this level.
    const withoutFact = makeHarness();
    await enrolledRun(withoutFact);
    await withoutFact.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_2, MON),
    ]);
    const cleared = await readConfigured(withoutFact);

    expect(cleared.unplacedNotPerformedWorkouts).toEqual([]);
    // No row was synthesized for the authored occurrence either.
    expect(cleared.items.map((item) => item.scheduledWorkoutId)).toEqual([OCCURRENCE_W1_2]);
  });

  it('reads the run facts exactly once, with no planning or session write', async () => {
    const harness = makeHarness([
      notPerformedFact(ENR_A, OCCURRENCE_W1_1),
      notPerformedFact(ENR_A, OCCURRENCE_W2_3),
    ]);
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_2, MON),
    ]);
    const listFacts = vi.spyOn(harness.notPerformed, 'listByEnrollment');
    const replaceAll = vi.spyOn(harness.plannedWorkouts, 'replaceAllForEnrollment');
    const reschedule = vi.spyOn(harness.plannedWorkouts, 'reschedule');
    const save = vi.spyOn(harness.sessions, 'save');

    const schedule = await readConfigured(harness);

    // ONE bounded, enrollment-scoped fact read — never per row or per fact.
    expect(listFacts).toHaveBeenCalledTimes(1);
    expect(listFacts).toHaveBeenCalledWith(enrollmentId(ENR_A));
    expect(schedule.unplacedNotPerformedWorkouts).toHaveLength(2);
    expect(replaceAll).not.toHaveBeenCalled();
    expect(reschedule).not.toHaveBeenCalled();
    expect(save).not.toHaveBeenCalled();
  });

  it('fails loudly when a recorded fact is not an occurrence of the program', async () => {
    const harness = makeHarness([notPerformedFact(ENR_A, 'sched-other-program-1')]);
    await enrolledRun(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ]);

    await expect(readSchedule(harness)).rejects.toThrow(/not an occurrence of program/);
  });
});

