import { describe, expect, it, vi } from 'vitest';

import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { EnrollmentScheduleDto } from '@/application/dto/schedule';
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
  makeProgram,
  MON,
  NEXT_MON,
  NEXT_WED,
  NOW,
  OCCURRENCE_W1_1,
  OCCURRENCE_W1_2,
  OCCURRENCE_W1_3,
  OCCURRENCE_W2_1,
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

function makeHarness() {
  const enrollments = new InMemoryProgramEnrollmentRepository();
  const plannedWorkouts = new InMemoryPlannedWorkoutRepository();
  const sessions = new InMemoryWorkoutSessionRepository();
  const useCase = new GetEnrollmentScheduleUseCase(enrollments, plannedWorkouts, sessions);
  return { enrollments, plannedWorkouts, sessions, useCase };
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
      focus: { today: null, next: null, pastDue: null },
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
    const useCase = new GetEnrollmentScheduleUseCase(enrollments, plannedRepo, sessions);

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
    const useCase = new GetEnrollmentScheduleUseCase(enrollments, plannedRepo, sessions);

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
