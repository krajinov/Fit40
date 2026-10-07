import { describe, expect, it, vi } from 'vitest';

import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import { ConfigureTrainingDaysUseCase } from '@/application/use-cases/configure-training-days';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryPlannedWorkoutRepository } from '@/infrastructure/scheduling/in-memory-planned-workout-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

import {
  enrollment,
  enrollmentId,
  FRI,
  LAST_FRI,
  makeEnrollmentRepo,
  makePlannedRepo,
  makeProgram,
  makeProgramRepo,
  MON,
  MON_WED_FRI,
  NEXT_FRI,
  NEXT_MON,
  NEXT_WED,
  NOW,
  OCCURRENCE_W1_1,
  OCCURRENCE_W1_2,
  OCCURRENCE_W1_3,
  OCCURRENCE_W2_1,
  OCCURRENCE_W2_2,
  OCCURRENCE_W2_3,
  OCCURRENCES_IN_ORDER,
  planned,
  PROGRAM_SLUG,
  saveCompletedSession,
  saveInProgressSession,
  SUN,
  THU_1,
  THU_2,
  THU_3,
  TUE_1,
  TUE_2,
  TUE_3,
  TUE_THU,
  WED,
  WORKOUT_A,
} from './schedule-fixtures';

const PROGRAM = makeProgram();

const USER_A = 'user-a';
const ENR_A = 'enr-a';
const ENR_B = 'enr-b';
/** Friday only — a selection that excludes the request day (Monday). */
const FRI_ONLY: ReadonlyArray<number> = [5];

function makeHarness(
  options: {
    readonly program?: TrainingProgram | null;
    readonly enrollmentRepo?: ProgramEnrollmentRepository;
    readonly planned?: PlannedWorkoutRepository;
  } = {},
) {
  const programRepo = makeProgramRepo(options.program === undefined ? PROGRAM : options.program);
  const enrollments = options.enrollmentRepo ?? new InMemoryProgramEnrollmentRepository();
  const plannedWorkouts = options.planned ?? new InMemoryPlannedWorkoutRepository();
  const sessions = new InMemoryWorkoutSessionRepository();
  const useCase = new ConfigureTrainingDaysUseCase(
    programRepo,
    enrollments,
    plannedWorkouts,
    sessions,
  );
  return { programRepo, enrollments, plannedWorkouts, sessions, useCase };
}

type Harness = ReturnType<typeof makeHarness>;

/** Enrolls the caller in the fixture run (in-memory enrollment repository only). */
async function enroll(harness: Harness, id = ENR_A, owner = USER_A): Promise<void> {
  await harness.enrollments.create(enrollment(id, owner));
}

/** Configure weekdays and assert success. */
async function configure(harness: Harness, weekdays: ReadonlyArray<number>): Promise<void> {
  const result = await harness.useCase.execute({
    userId: USER_A,
    programSlug: PROGRAM_SLUG,
    weekdays,
    now: NOW,
  });
  expect(result.ok).toBe(true);
}

/** The run's planned rows as [occurrenceId, plannedDate] pairs, in read order. */
async function planEntries(harness: Harness, id = ENR_A) {
  const rows = await harness.plannedWorkouts.listByEnrollment(enrollmentId(id));
  return rows.map((row) => [row.scheduledWorkoutId, row.plannedDate]);
}

describe('ConfigureTrainingDaysUseCase', () => {
  it('generates the run calendar from the selected weekdays', async () => {
    const harness = makeHarness();
    await enroll(harness);

    await configure(harness, MON_WED_FRI);

    expect(await planEntries(harness)).toEqual([
      [OCCURRENCE_W1_1, MON],
      [OCCURRENCE_W1_2, WED],
      [OCCURRENCE_W1_3, FRI],
      [OCCURRENCE_W2_1, NEXT_MON],
      [OCCURRENCE_W2_2, NEXT_WED],
      [OCCURRENCE_W2_3, NEXT_FRI],
    ]);
  });

  it('starts on the next selected weekday when today is not selected', async () => {
    const harness = makeHarness();
    await enroll(harness);

    await configure(harness, TUE_THU);

    expect(await planEntries(harness)).toEqual([
      [OCCURRENCE_W1_1, TUE_1],
      [OCCURRENCE_W1_2, THU_1],
      [OCCURRENCE_W1_3, TUE_2],
      [OCCURRENCE_W2_1, THU_2],
      [OCCURRENCE_W2_2, TUE_3],
      [OCCURRENCE_W2_3, THU_3],
    ]);
  });

  it('excludes completed occurrences: performed work gets no calendar row', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await saveCompletedSession(harness.sessions, {
      id: 's-done',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: WORKOUT_A,
    });

    await configure(harness, MON_WED_FRI);

    const entries = await planEntries(harness);
    expect(entries).toHaveLength(5);
    expect(entries.map((entry) => entry[0])).not.toContain(OCCURRENCE_W1_1);
    // The remaining occurrences still start today, in authored order.
    expect(entries[0]).toEqual([OCCURRENCE_W1_2, MON]);
  });

  it('freezes an in-progress occurrence on its existing date, even a past one', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, LAST_FRI),
    ]);
    await saveInProgressSession(harness.sessions, {
      id: 's-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: WORKOUT_A,
    });

    await configure(harness, MON_WED_FRI);

    expect(await planEntries(harness)).toEqual([
      [OCCURRENCE_W1_1, LAST_FRI],
      [OCCURRENCE_W1_2, MON],
      [OCCURRENCE_W1_3, WED],
      [OCCURRENCE_W2_1, FRI],
      [OCCURRENCE_W2_2, NEXT_MON],
      [OCCURRENCE_W2_3, NEXT_WED],
    ]);
  });

  it('reserves a frozen in-progress date so generated workouts skip it', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_2, WED),
    ]);
    await saveInProgressSession(harness.sessions, {
      id: 's-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_2,
      workoutId: WORKOUT_A,
    });

    await configure(harness, MON_WED_FRI);

    expect(await planEntries(harness)).toEqual([
      [OCCURRENCE_W1_1, MON],
      [OCCURRENCE_W1_2, WED],
      [OCCURRENCE_W1_3, FRI],
      [OCCURRENCE_W2_1, NEXT_MON],
      [OCCURRENCE_W2_2, NEXT_WED],
      [OCCURRENCE_W2_3, NEXT_FRI],
    ]);
  });

  it('overwrites a manual reschedule and does not reserve its old date', async () => {
    const harness = makeHarness();
    await enroll(harness);
    // A never-started occurrence moved by hand to a Sunday.
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_2, SUN),
    ]);

    await configure(harness, MON_WED_FRI);

    expect(await planEntries(harness)).toEqual([
      [OCCURRENCE_W1_1, MON],
      [OCCURRENCE_W1_2, WED],
      [OCCURRENCE_W1_3, FRI],
      [OCCURRENCE_W2_1, NEXT_MON],
      [OCCURRENCE_W2_2, NEXT_WED],
      [OCCURRENCE_W2_3, NEXT_FRI],
    ]);
  });

  it('dates an in-progress occurrence with no planned row forward, never into the past', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await saveInProgressSession(harness.sessions, {
      id: 's-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: WORKOUT_A,
    });

    await configure(harness, FRI_ONLY);

    const entries = await planEntries(harness);
    expect(entries[0]).toEqual([OCCURRENCE_W1_1, FRI]);
    expect(entries).toHaveLength(6);
    for (const [, date] of entries) {
      expect(date !== undefined && date >= FRI).toBe(true);
    }
  });

  it('freezes a bootstrapped in-progress row on the next regeneration', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await saveInProgressSession(harness.sessions, {
      id: 's-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: WORKOUT_A,
    });

    await configure(harness, FRI_ONLY);
    await configure(harness, MON_WED_FRI);

    const entries = await planEntries(harness);
    expect(entries).toHaveLength(6);
    expect(entries).toContainEqual([OCCURRENCE_W1_1, FRI]);
  });

  it('persists the complete generated set in exactly one replacement', async () => {
    const harness = makeHarness();
    await enroll(harness);
    const replaceAll = vi.spyOn(harness.plannedWorkouts, 'replaceAllForEnrollment');

    await configure(harness, MON_WED_FRI);

    expect(replaceAll).toHaveBeenCalledTimes(1);
    const call = replaceAll.mock.calls.at(0);
    expect(call).toBeDefined();
    if (call === undefined) return;
    const [targetEnrollment, rows] = call;
    expect(targetEnrollment).toBe(ENR_A);
    expect(rows.map((row) => row.scheduledWorkoutId)).toEqual(OCCURRENCES_IN_ORDER);
    expect(rows.map((row) => row.plannedDate)).toEqual([MON, WED, FRI, NEXT_MON, NEXT_WED, NEXT_FRI]);
    expect(rows.every((row) => row.enrollmentId === ENR_A)).toBe(true);
  });

  it('rejects an empty or invalid weekday selection without writing', async () => {
    const selections: ReadonlyArray<ReadonlyArray<number>> = [
      [],
      [0],
      [8],
      [1.5],
      [Number.NaN],
    ];

    for (const weekdays of selections) {
      const harness = makeHarness();
      await enroll(harness);
      const replaceAll = vi.spyOn(harness.plannedWorkouts, 'replaceAllForEnrollment');

      const result = await harness.useCase.execute({
        userId: USER_A,
        programSlug: PROGRAM_SLUG,
        weekdays,
        now: NOW,
      });

      expect(result.ok).toBe(false);
      if (result.ok) continue;
      expect(result.error.code).toBe('INVALID_TRAINING_DAYS');
      expect(replaceAll).not.toHaveBeenCalled();
    }
  });

  it('rejects an invalid user id', async () => {
    const harness = makeHarness();
    await enroll(harness);

    const result = await harness.useCase.execute({
      userId: '   ',
      programSlug: PROGRAM_SLUG,
      weekdays: MON_WED_FRI,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'INVALID_INPUT', field: 'userId' });
  });

  it('reports PROGRAM_NOT_FOUND for an unknown program', async () => {
    const harness = makeHarness({ program: null });
    await enroll(harness);

    const result = await harness.useCase.execute({
      userId: USER_A,
      programSlug: 'missing-program',
      weekdays: MON_WED_FRI,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('reports NOT_ENROLLED when the user has no run for the program', async () => {
    const harness = makeHarness();
    const replaceAll = vi.spyOn(harness.plannedWorkouts, 'replaceAllForEnrollment');

    const result = await harness.useCase.execute({
      userId: USER_A,
      programSlug: PROGRAM_SLUG,
      weekdays: MON_WED_FRI,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(replaceAll).not.toHaveBeenCalled();
  });

  it('maps a vanished run to NOT_ENROLLED, without retrying the write', async () => {
    const harness = makeHarness({
      enrollmentRepo: makeEnrollmentRepo([enrollment(ENR_A, USER_A), null]),
      planned: makePlannedRepo({ replaceAllResult: false }),
    });
    const replaceAll = vi.mocked(harness.plannedWorkouts.replaceAllForEnrollment);

    const result = await harness.useCase.execute({
      userId: USER_A,
      programSlug: PROGRAM_SLUG,
      weekdays: MON_WED_FRI,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    // Exactly one write attempt and one read-only re-check: no retry loop.
    expect(replaceAll).toHaveBeenCalledTimes(1);
  });

  it('never generates into a replacement run: a restarted run maps to NOT_ENROLLED', async () => {
    const harness = makeHarness({
      // The run the use case loaded (ENR_A) was replaced by M14 restart (ENR_B).
      enrollmentRepo: makeEnrollmentRepo([enrollment(ENR_A, USER_A), enrollment(ENR_B, USER_A)]),
      planned: makePlannedRepo({ replaceAllResult: false }),
    });
    const replaceAll = vi.mocked(harness.plannedWorkouts.replaceAllForEnrollment);

    const result = await harness.useCase.execute({
      userId: USER_A,
      programSlug: PROGRAM_SLUG,
      weekdays: MON_WED_FRI,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(replaceAll).toHaveBeenCalledTimes(1);
    // The replacement run is addressed by a different id, so nothing was ever
    // written for it.
    expect(replaceAll.mock.calls.every(([target]) => target === ENR_A)).toBe(true);
  });

  it('maps an unchanged enrollment to SCHEDULE_CHANGED rather than retrying', async () => {
    const harness = makeHarness({
      enrollmentRepo: makeEnrollmentRepo([enrollment(ENR_A, USER_A)]),
      planned: makePlannedRepo({ replaceAllResult: false }),
    });
    const replaceAll = vi.mocked(harness.plannedWorkouts.replaceAllForEnrollment);

    const result = await harness.useCase.execute({
      userId: USER_A,
      programSlug: PROGRAM_SLUG,
      weekdays: MON_WED_FRI,
      now: NOW,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCHEDULE_CHANGED');
    expect(replaceAll).toHaveBeenCalledTimes(1);
  });

  it('writes only the caller\'s own run', async () => {
    const harness = makeHarness();
    await enroll(harness, ENR_A, USER_A);
    await enroll(harness, ENR_B, 'user-b');
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_B), [
      planned(ENR_B, OCCURRENCE_W1_1, MON),
    ]);

    await configure(harness, MON_WED_FRI);

    expect(await planEntries(harness, ENR_A)).toHaveLength(6);
    expect(await planEntries(harness, ENR_B)).toEqual([[OCCURRENCE_W1_1, MON]]);
  });

  it('never writes a session: sessions are execution truth, not planning', async () => {
    const harness = makeHarness();
    await enroll(harness);
    const save = vi.spyOn(harness.sessions, 'save');

    await configure(harness, MON_WED_FRI);

    expect(save).not.toHaveBeenCalled();
  });
});
