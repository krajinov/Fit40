/**
 * Shared fixtures for the M15 scheduling use-case tests.
 *
 * One authored program (2 weeks × 3 workouts — six occurrences), the calendar
 * constants the expectations pin to, and helpers that build every value through
 * its real domain factory, so a fixture can never drift from the contract.
 * 2026-09-21 is a Monday, matching the UTC calendar week the domain uses.
 */

import { createPlannedWorkout, type PlannedWorkout } from '@/domain/entities/planned-workout';
import {
  createProgramEnrollment,
  type ProgramEnrollment,
} from '@/domain/entities/program-enrollment';
import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { Difficulty } from '@/domain/types/exercise';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  type EnrollmentId,
  type WorkoutId,
} from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';
import { vi } from 'vitest';

import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';

export const PROGRAM_ID = 'p-schedule';
export const PROGRAM_SLUG = 'prog-schedule';

/** Authored occurrence ids, in authored program order. */
export const OCCURRENCE_W1_1 = 'sched-w1-1';
export const OCCURRENCE_W1_2 = 'sched-w1-2';
export const OCCURRENCE_W1_3 = 'sched-w1-3';
export const OCCURRENCE_W2_1 = 'sched-w2-1';
export const OCCURRENCE_W2_2 = 'sched-w2-2';
export const OCCURRENCE_W2_3 = 'sched-w2-3';

export const OCCURRENCES_IN_ORDER: ReadonlyArray<string> = [
  OCCURRENCE_W1_1,
  OCCURRENCE_W1_2,
  OCCURRENCE_W1_3,
  OCCURRENCE_W2_1,
  OCCURRENCE_W2_2,
  OCCURRENCE_W2_3,
];

export const WORKOUT_A = 'wo-a';
export const WORKOUT_B = 'wo-b';
export const WORKOUT_C = 'wo-c';

/** The request clock: Monday 2026-09-21 (09:00 UTC). */
export const NOW = new Date('2026-09-21T09:00:00Z');

export const MON = '2026-09-21';
export const TUE = '2026-09-22';
export const WED = '2026-09-23';
export const THU = '2026-09-24';
export const FRI = '2026-09-25';
export const SUN = '2026-09-27';
export const NEXT_MON = '2026-09-28';
export const NEXT_WED = '2026-09-30';
export const NEXT_FRI = '2026-10-02';
/** Friday of the previous calendar week — a legitimate past date. */
export const LAST_FRI = '2026-09-18';
/** Wednesday of the previous calendar week. */
export const LAST_WED = '2026-09-16';

/** The Tue/Thu sequence (used to prove a non-Monday first eligible date). */
export const TUE_1 = '2026-09-22';
export const THU_1 = '2026-09-24';
export const TUE_2 = '2026-09-29';
export const THU_2 = '2026-10-01';
export const TUE_3 = '2026-10-06';
export const THU_3 = '2026-10-08';

/** Monday / Wednesday / Friday, the canonical M15 example selection. */
export const MON_WED_FRI: ReadonlyArray<number> = [1, 3, 5];

/** Tuesday / Thursday — a selection that excludes the request day. */
export const TUE_THU: ReadonlyArray<number> = [2, 4];

export function scheduledWorkoutId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function enrollmentId(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A validated PlannedDate, built through the value object (never a raw cast). */
export function plannedDate(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A validated PlannedWorkout row for the given run and occurrence. */
export function planned(
  enrollment: string,
  occurrence: string,
  date: string,
): PlannedWorkout {
  const result = createPlannedWorkout({
    enrollmentId: enrollment,
    scheduledWorkoutId: occurrence,
    plannedDate: plannedDate(date),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function repScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function exerciseId(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function userId(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function workoutId(value: string): WorkoutId {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/**
 * The authored program: 2 weeks × 3 workouts. Week 2 repeats the same three
 * workout templates, so occurrence ids (not workout ids) identify planned rows.
 */
export function makeProgram(): TrainingProgram {
  const workouts = [
    { id: WORKOUT_A, name: 'Workout A', slug: 'workout-a', exercise: 'ex-001' },
    { id: WORKOUT_B, name: 'Workout B', slug: 'workout-b', exercise: 'ex-002' },
    { id: WORKOUT_C, name: 'Workout C', slug: 'workout-c', exercise: 'ex-003' },
  ].map((spec) => {
    const result = createWorkout({
      id: spec.id,
      name: spec.name,
      slug: spec.slug,
      description: `${spec.name} description`,
      estimatedDurationMinutes: 30,
      exercises: [
        {
          exerciseId: exerciseId(spec.exercise),
          order: 1,
          prescription: repScheme(),
          restSeconds: 60,
        },
      ],
    });
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });

  const week = (weekNumber: number, ids: ReadonlyArray<string>) => ({
    weekNumber,
    scheduledWorkouts: ids.map((id, index) => ({
      id: scheduledWorkoutId(id),
      workoutId: workoutId(workouts[index]?.id ?? WORKOUT_A),
      order: index + 1,
    })),
  });

  const result = createTrainingProgram({
    id: PROGRAM_ID,
    name: 'Schedule Test Program',
    slug: PROGRAM_SLUG,
    description: 'A program used by the M15 scheduling tests',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: 2,
    workoutsPerWeek: 3,
    workouts,
    weeks: [
      week(1, [OCCURRENCE_W1_1, OCCURRENCE_W1_2, OCCURRENCE_W1_3]),
      week(2, [OCCURRENCE_W2_1, OCCURRENCE_W2_2, OCCURRENCE_W2_3]),
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A valid enrollment row for the fixture program. */
export function enrollment(
  id: string,
  ownerId: string,
  programId = PROGRAM_ID,
): ProgramEnrollment {
  const result = createProgramEnrollment({
    id,
    userId: ownerId,
    programId,
    enrolledAt: new Date('2026-09-01T00:00:00Z'),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export interface SessionFixtureOptions {
  readonly id: string;
  readonly userId: string;
  /** null models a session detached by a leave (another run's history). */
  readonly enrollmentId: EnrollmentId | null;
  readonly scheduledWorkoutId: string;
  readonly workoutId?: string;
  readonly startedAt?: string;
  readonly completedAt?: string;
}

function buildSession(options: SessionFixtureOptions): WorkoutSession {
  const result = createWorkoutSession({
    id: options.id,
    userId: userId(options.userId),
    enrollmentId: options.enrollmentId,
    scheduledWorkoutId: scheduledWorkoutId(options.scheduledWorkoutId),
    workoutId: workoutId(options.workoutId ?? WORKOUT_A),
    startedAt: new Date(options.startedAt ?? '2026-09-21T08:00:00Z'),
    exerciseLogs: [
      { authoredExerciseId: exerciseId('ex-001'), order: 1, prescription: repScheme(), restSeconds: 60 },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Saves a live (started, not completed) session — the in-progress fact. */
export async function saveInProgressSession(
  repo: InMemoryWorkoutSessionRepository,
  options: SessionFixtureOptions,
): Promise<void> {
  await repo.save(buildSession(options));
}

/** Saves a completed session — the completion/history fact. */
export async function saveCompletedSession(
  repo: InMemoryWorkoutSessionRepository,
  options: SessionFixtureOptions,
): Promise<void> {
  const logged = logSessionSet(buildSession(options), {
    exerciseOrder: 1,
    type: 'reps',
    reps: 10,
    weightKg: null,
    rpe: null,
  });
  if (!logged.ok) throw new Error(logged.error.message);

  const done = completeWorkoutSession(
    logged.data,
    new Date(options.completedAt ?? '2026-09-21T09:30:00Z'),
  );
  if (!done.ok) throw new Error(done.error.message);

  await repo.save(done.data);
}

/** Catalog stub answering `findBySlug` with the supplied program. */
export function makeProgramRepo(program: TrainingProgram | null) {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(async () => program),
    findSessionRouteByScheduledWorkoutId: vi.fn(),
    listMetadataByIds: vi.fn(),
  } satisfies ProgramRepository;
}

/**
 * Enrollment stub answering from a fixed sequence, so a test can model "the run
 * existed when it was read, and was replaced or deleted before the write".
 * The final element answers every further call.
 */
export function makeEnrollmentRepo(sequence: ReadonlyArray<ProgramEnrollment | null>) {
  let index = 0;
  return {
    findByUserAndProgram: vi.fn(async () => {
      const answer = sequence[Math.min(index, sequence.length - 1)] ?? null;
      index += 1;
      return answer;
    }),
    listByUserId: vi.fn(),
    create: vi.fn(),
    delete: vi.fn(),
    replaceExpectedWithNew: vi.fn(),
  } satisfies ProgramEnrollmentRepository;
}

/** Planned-workout repository stub with injectable write outcomes. */
export function makePlannedRepo(
  options: {
    readonly rows?: ReadonlyArray<PlannedWorkout>;
    readonly replaceAllResult?: boolean;
    readonly rescheduleResult?: boolean;
    readonly rescheduleError?: Error;
  } = {},
) {
  return {
    listByEnrollment: vi.fn(async () => options.rows ?? []),
    replaceAllForEnrollment: vi.fn(async () => options.replaceAllResult ?? true),
    reschedule: vi.fn(async () => {
      if (options.rescheduleError !== undefined) {
        throw options.rescheduleError;
      }
      return options.rescheduleResult ?? true;
    }),
  } satisfies PlannedWorkoutRepository;
}
