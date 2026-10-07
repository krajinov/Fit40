import { describe, expect, it, vi } from 'vitest';

import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import { ReschedulePlannedWorkoutUseCase } from '@/application/use-cases/reschedule-planned-workout';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { InMemoryProgramEnrollmentRepository } from '@/infrastructure/enrollments/in-memory-program-enrollment-repository';
import { InMemoryPlannedWorkoutRepository } from '@/infrastructure/scheduling/in-memory-planned-workout-repository';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

import {
  enrollment,
  enrollmentId,
  makeEnrollmentRepo,
  makePlannedRepo,
  makeProgram,
  makeProgramRepo,
  MON,
  NEXT_FRI,
  NOW,
  OCCURRENCE_W1_1,
  OCCURRENCE_W1_2,
  OCCURRENCE_W2_1,
  planned,
  PROGRAM_SLUG,
  saveCompletedSession,
  saveInProgressSession,
  SUN,
  WED,
  WORKOUT_A,
} from './schedule-fixtures';

const PROGRAM = makeProgram();

const USER_A = 'user-a';
const ENR_A = 'enr-a';
const USER_B = 'user-b';
const ENR_B = 'enr-b';

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
  const useCase = new ReschedulePlannedWorkoutUseCase(
    programRepo,
    enrollments,
    plannedWorkouts,
    sessions,
  );
  return { programRepo, enrollments, plannedWorkouts, sessions, useCase };
}

type Harness = ReturnType<typeof makeHarness>;

async function enroll(harness: Harness, id = ENR_A, owner = USER_A): Promise<void> {
  await harness.enrollments.create(enrollment(id, owner));
}

/** Runs the mutation with the fixture run's first occurrence by default. */
function reschedule(
  harness: Harness,
  date: string,
  overrides: {
    readonly userId?: string;
    readonly programSlug?: string;
    readonly weekNumber?: number;
    readonly workoutOrder?: number;
  } = {},
) {
  return harness.useCase.execute({
    userId: overrides.userId ?? USER_A,
    programSlug: overrides.programSlug ?? PROGRAM_SLUG,
    weekNumber: overrides.weekNumber ?? 1,
    workoutOrder: overrides.workoutOrder ?? 1,
    date,
    now: NOW,
  });
}

/** The run's planned rows as [occurrenceId, plannedDate] pairs. */
async function planEntries(harness: Harness, id = ENR_A) {
  const rows = await harness.plannedWorkouts.listByEnrollment(enrollmentId(id));
  return rows.map((row) => [row.scheduledWorkoutId, row.plannedDate]);
}

describe('ReschedulePlannedWorkoutUseCase', () => {
  it('moves a future planned workout to another date', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
      planned(ENR_A, OCCURRENCE_W1_2, WED),
    ]);

    const result = await reschedule(harness, NEXT_FRI);

    expect(result.ok).toBe(true);
    // Read back in calendar order: the moved row now sorts after Wednesday.
    expect(await planEntries(harness)).toEqual([
      [OCCURRENCE_W1_2, WED],
      [OCCURRENCE_W1_1, NEXT_FRI],
    ]);
  });

  it('allows moving a workout onto today', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, WED),
    ]);

    const result = await reschedule(harness, MON);

    expect(result.ok).toBe(true);
    expect(await planEntries(harness)).toEqual([[OCCURRENCE_W1_1, MON]]);
  });

  it('rejects a malformed date', async () => {
    const harness = makeHarness();
    await enroll(harness);
    const rescheduleSpy = vi.spyOn(harness.plannedWorkouts, 'reschedule');

    const result = await reschedule(harness, '22/09/2026');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_DATE');
    expect(rescheduleSpy).not.toHaveBeenCalled();
  });

  it('rejects an impossible calendar date', async () => {
    const harness = makeHarness();
    await enroll(harness);

    const result = await reschedule(harness, '2026-02-30');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_DATE');
  });

  it('rejects a date in the past', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ]);
    const rescheduleSpy = vi.spyOn(harness.plannedWorkouts, 'reschedule');

    const result = await reschedule(harness, '2026-09-20');

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'DATE_IN_PAST', today: MON });
    expect(rescheduleSpy).not.toHaveBeenCalled();
  });

  it('reports PROGRAM_NOT_FOUND for an unknown program', async () => {
    const harness = makeHarness({ program: null });
    await enroll(harness);

    const result = await reschedule(harness, WED, { programSlug: 'missing-program' });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('reports SCHEDULED_WORKOUT_NOT_FOUND for coordinates outside the program', async () => {
    const harness = makeHarness();
    await enroll(harness);

    const result = await reschedule(harness, WED, { weekNumber: 9, workoutOrder: 9 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: 'SCHEDULED_WORKOUT_NOT_FOUND',
      weekNumber: 9,
      workoutOrder: 9,
    });
  });

  it('reports NOT_ENROLLED when the user has no run for the program', async () => {
    const harness = makeHarness();
    const rescheduleSpy = vi.spyOn(harness.plannedWorkouts, 'reschedule');

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(rescheduleSpy).not.toHaveBeenCalled();
  });

  it('reports SCHEDULE_NOT_CONFIGURED when the run has no planning yet', async () => {
    const harness = makeHarness();
    await enroll(harness);
    const rescheduleSpy = vi.spyOn(harness.plannedWorkouts, 'reschedule');

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCHEDULE_NOT_CONFIGURED');
    expect(rescheduleSpy).not.toHaveBeenCalled();
  });

  it('reports PLANNED_WORKOUT_NOT_FOUND when the occurrence has no planned row', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_2, WED),
    ]);

    const result = await reschedule(harness, MON);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: 'PLANNED_WORKOUT_NOT_FOUND',
      scheduledWorkoutId: OCCURRENCE_W1_1,
    });
  });

  it('refuses to move a completed workout even when a planned row still exists', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ]);
    await saveCompletedSession(harness.sessions, {
      id: 's-done',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: WORKOUT_A,
    });
    const rescheduleSpy = vi.spyOn(harness.plannedWorkouts, 'reschedule');

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: 'WORKOUT_ALREADY_COMPLETED',
      scheduledWorkoutId: OCCURRENCE_W1_1,
    });
    expect(rescheduleSpy).not.toHaveBeenCalled();
  });

  it('reports PLANNED_WORKOUT_NOT_FOUND for a completed occurrence whose row is already gone', async () => {
    const harness = makeHarness();
    await enroll(harness);
    // Regeneration removed the completed occurrence's row: there is no intent
    // left to move, so the row lookup is the truthful outcome.
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_2, WED),
    ]);
    await saveCompletedSession(harness.sessions, {
      id: 's-done',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: WORKOUT_A,
    });

    const result = await reschedule(harness, MON);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('PLANNED_WORKOUT_NOT_FOUND');
  });

  it('refuses to move a workout whose session is in progress', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ]);
    await saveInProgressSession(harness.sessions, {
      id: 's-live',
      userId: USER_A,
      enrollmentId: enrollmentId(ENR_A),
      scheduledWorkoutId: OCCURRENCE_W1_1,
      workoutId: WORKOUT_A,
    });
    const rescheduleSpy = vi.spyOn(harness.plannedWorkouts, 'reschedule');

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({
      code: 'SESSION_IN_PROGRESS',
      scheduledWorkoutId: OCCURRENCE_W1_1,
    });
    expect(rescheduleSpy).not.toHaveBeenCalled();
  });

  it('treats moving to the same date as a successful no-op without writing', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, NEXT_FRI),
    ]);
    const rescheduleSpy = vi.spyOn(harness.plannedWorkouts, 'reschedule');

    const result = await reschedule(harness, NEXT_FRI);

    expect(result.ok).toBe(true);
    expect(rescheduleSpy).not.toHaveBeenCalled();
    expect(await planEntries(harness)).toEqual([[OCCURRENCE_W1_1, NEXT_FRI]]);
  });

  it('reports DATE_ALREADY_PLANNED when another planned workout holds the date', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
      planned(ENR_A, OCCURRENCE_W1_2, SUN),
    ]);

    const result = await reschedule(harness, SUN);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatchObject({ code: 'DATE_ALREADY_PLANNED', date: SUN });
    // The one-planned-workout-per-date invariant survived the rejected move.
    expect(await planEntries(harness)).toEqual([
      [OCCURRENCE_W1_1, MON],
      [OCCURRENCE_W1_2, SUN],
    ]);
  });

  it('maps a vanished run to NOT_ENROLLED without retrying the write', async () => {
    const harness = makeHarness({
      enrollmentRepo: makeEnrollmentRepo([enrollment(ENR_A, USER_A), null]),
      planned: makePlannedRepo({
        rows: [planned(ENR_A, OCCURRENCE_W1_1, MON)],
        rescheduleResult: false,
      }),
    });
    const rescheduleSpy = vi.mocked(harness.plannedWorkouts.reschedule);

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(rescheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('never retargets a replacement run: a restarted run maps to NOT_ENROLLED', async () => {
    const harness = makeHarness({
      enrollmentRepo: makeEnrollmentRepo([enrollment(ENR_A, USER_A), enrollment(ENR_B, USER_A)]),
      planned: makePlannedRepo({
        rows: [planned(ENR_A, OCCURRENCE_W1_1, MON)],
        rescheduleResult: false,
      }),
    });
    const rescheduleSpy = vi.mocked(harness.plannedWorkouts.reschedule);

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(rescheduleSpy).toHaveBeenCalledTimes(1);
    expect(rescheduleSpy.mock.calls.every(([target]) => target === ENR_A)).toBe(true);
  });

  it('maps an unchanged enrollment to SCHEDULE_CHANGED rather than retrying', async () => {
    const harness = makeHarness({
      enrollmentRepo: makeEnrollmentRepo([enrollment(ENR_A, USER_A)]),
      planned: makePlannedRepo({
        rows: [planned(ENR_A, OCCURRENCE_W1_1, MON)],
        rescheduleResult: false,
      }),
    });
    const rescheduleSpy = vi.mocked(harness.plannedWorkouts.reschedule);

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('SCHEDULE_CHANGED');
    expect(rescheduleSpy).toHaveBeenCalledTimes(1);
  });

  it('moves only the caller\'s own planned workout', async () => {
    const harness = makeHarness();
    await enroll(harness, ENR_A, USER_A);
    await enroll(harness, ENR_B, USER_B);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ]);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_B), [
      planned(ENR_B, OCCURRENCE_W1_1, MON),
    ]);

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(true);
    expect(await planEntries(harness, ENR_A)).toEqual([[OCCURRENCE_W1_1, WED]]);
    // The other user's run is untouched.
    expect(await planEntries(harness, ENR_B)).toEqual([[OCCURRENCE_W1_1, MON]]);
  });

  it('never composes an occurrence for another user\'s run', async () => {
    const harness = makeHarness();
    await enroll(harness, ENR_B, USER_B);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_B), [
      planned(ENR_B, OCCURRENCE_W2_1, MON),
    ]);

    const result = await reschedule(harness, WED, { weekNumber: 2 });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');
    expect(await planEntries(harness, ENR_B)).toEqual([[OCCURRENCE_W2_1, MON]]);
  });

  it('never writes a session: planning moves are not execution', async () => {
    const harness = makeHarness();
    await enroll(harness);
    await harness.plannedWorkouts.replaceAllForEnrollment(enrollmentId(ENR_A), [
      planned(ENR_A, OCCURRENCE_W1_1, MON),
    ]);
    const save = vi.spyOn(harness.sessions, 'save');

    const result = await reschedule(harness, WED);

    expect(result.ok).toBe(true);
    expect(save).not.toHaveBeenCalled();
  });
});
