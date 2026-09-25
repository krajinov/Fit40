/**
 * Real-PostgreSQL fixtures for the M15 planned-workout persistence suite.
 *
 * Not a test file. Every scenario drives the real write path (the domain
 * factories, `ProgramEnrollmentRepository`, `WorkoutSessionRepository`,
 * `PlannedWorkoutRepository`), never raw inserts, so the suites exercise the
 * same statements production uses.
 *
 * Users and enrollments come from the shared `personal-record-fixtures`
 * helpers; this module adds the planned-workout vocabulary plus a completed-run
 * fixture (the shape M14's restart tests use, kept local so the M14 suite
 * itself stays untouched).
 */

import { asc, eq } from 'drizzle-orm';

import { createPlannedWorkout, type PlannedWorkout } from '@/domain/entities/planned-workout';
import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
} from '@/domain/entities/workout-session';
import {
  createEnrollmentId,
  createScheduledWorkoutId,
  type EnrollmentId,
  type ExerciseId,
  type ScheduledWorkoutId,
} from '@/domain/types/ids';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';
import {
  exercises,
  plannedWorkouts,
  programEnrollments,
} from '@/infrastructure/database/schema';

import { exerciseId, reps, seedEnrollment, seedUser, userId } from './personal-record-fixtures';
import { db, programRepository, workoutSessionRepository } from './setup';

export function plannedDate(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function enrollmentIdValue(value: string): EnrollmentId {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function scheduledWorkoutIdValue(value: string): ScheduledWorkoutId {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** A valid domain planned workout for `enrollmentId`. */
export function plannedWorkout(
  enrollmentId: string,
  scheduledWorkoutId: string,
  plannedDateValue: string,
): PlannedWorkout {
  const result = createPlannedWorkout({
    enrollmentId,
    scheduledWorkoutId,
    plannedDate: plannedDate(plannedDateValue),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Every authored occurrence of a program, in authored order. */
export function listOccurrences(program: TrainingProgram): ReadonlyArray<ScheduledWorkout> {
  return program.weeks.flatMap((week) =>
    [...week.scheduledWorkouts].sort((a, b) => a.order - b.order),
  );
}

/**
 * A complete replacement set: every authored occurrence of `program` dated on
 * consecutive days of the same month, starting at `firstDate`.
 */
export function plannedSetFor(
  program: TrainingProgram,
  enrollmentId: string,
  firstDate: string,
): ReadonlyArray<PlannedWorkout> {
  const firstDay = Number.parseInt(firstDate.slice(8, 10), 10);
  const prefix = firstDate.slice(0, 8);

  return listOccurrences(program).map((occurrence, index) => {
    const day = String(firstDay + index).padStart(2, '0');
    return plannedWorkout(enrollmentId, occurrence.id, `${prefix}${day}`);
  });
}

/** `occurrence@date` lines, so assertions compare identity AND date. */
export function plannedLines(rows: ReadonlyArray<PlannedWorkout>): ReadonlyArray<string> {
  return rows.map((row) => `${row.scheduledWorkoutId}@${row.plannedDate}`);
}

export interface PlannedRunFixture {
  readonly program: TrainingProgram;
  readonly enrollmentId: string;
  readonly occurrenceIds: ReadonlyArray<string>;
}

/** Seeds a real user plus one real enrollment in a seeded program. */
export async function seedEnrolledRun(input: {
  readonly owner: string;
  readonly programSlug: string;
  readonly enrollmentId: string;
}): Promise<PlannedRunFixture> {
  await seedUser(input.owner);

  const program = await programRepository.findBySlug(input.programSlug);
  if (program === null) throw new Error(`seed program "${input.programSlug}" is missing`);

  await seedEnrollment(input.enrollmentId, input.owner, program.id);

  return {
    program,
    enrollmentId: input.enrollmentId,
    occurrenceIds: listOccurrences(program).map((occurrence) => occurrence.id),
  };
}

export interface CompletedRunFixture extends PlannedRunFixture {
  readonly sessionIds: ReadonlyArray<string>;
  readonly exerciseIds: ReadonlyArray<ExerciseId>;
}

/**
 * A fully completed run: one completed session per authored occurrence, so
 * M14's restart authority (`isProgramComplete`) is satisfied. Mirrors the M14
 * restart suite's fixture without importing from that test module.
 */
export async function seedCompletedRun(input: {
  readonly owner: string;
  readonly programSlug: string;
  readonly enrollmentId: string;
}): Promise<CompletedRunFixture> {
  const run = await seedEnrolledRun(input);

  const catalog = await db
    .select({ id: exercises.id })
    .from(exercises)
    .orderBy(asc(exercises.id))
    .limit(3);
  const exerciseIds = catalog.map((row) => exerciseId(row.id));
  if (exerciseIds.length === 0) throw new Error('seed catalog is empty');

  const sessionIds: string[] = [];

  for (const [index, occurrence] of listOccurrences(run.program).entries()) {
    const id = `${input.enrollmentId}-session-${index + 1}`;
    const day = String(index + 1).padStart(2, '0');
    const exercise = exerciseIds[index % exerciseIds.length];
    if (exercise === undefined) throw new Error('unreachable: the catalog is non-empty');

    const created = createWorkoutSession({
      id,
      userId: userId(input.owner),
      enrollmentId: enrollmentIdValue(input.enrollmentId),
      scheduledWorkoutId: scheduledWorkoutIdValue(occurrence.id),
      workoutId: occurrence.workoutId,
      startedAt: new Date(`2026-09-${day}T09:00:00Z`),
      exerciseLogs: [
        { authoredExerciseId: exercise, order: 1, prescription: reps(), restSeconds: 60 },
      ],
    });
    if (!created.ok) throw new Error(created.error.message);

    const logged = logSessionSet(created.data, {
      exerciseOrder: 1,
      type: 'reps',
      reps: 8,
      weightKg: 20 + index,
      rpe: null,
    });
    if (!logged.ok) throw new Error(logged.error.message);

    const done = completeWorkoutSession(logged.data, new Date(`2026-09-${day}T10:00:00Z`));
    if (!done.ok) throw new Error(done.error.message);

    await workoutSessionRepository.save(done.data);
    sessionIds.push(id);
  }

  return { ...run, sessionIds, exerciseIds };
}

/** The lowest-id exercise in the seed catalog, for building a real session. */
export async function firstCatalogExerciseId(): Promise<ExerciseId> {
  const rows = await db
    .select({ id: exercises.id })
    .from(exercises)
    .orderBy(asc(exercises.id))
    .limit(1);

  const first = rows[0];
  if (first === undefined) throw new Error('seed catalog is empty');
  return exerciseId(first.id);
}

/** Every planned row in the database, for orphan/leak assertions. */
export async function allPlannedRows(): Promise<
  ReadonlyArray<{
    readonly enrollmentId: string;
    readonly scheduledWorkoutId: string;
    readonly plannedDate: string;
  }>
> {
  return db
    .select({
      enrollmentId: plannedWorkouts.enrollmentId,
      scheduledWorkoutId: plannedWorkouts.scheduledWorkoutId,
      plannedDate: plannedWorkouts.plannedDate,
    })
    .from(plannedWorkouts)
    .orderBy(asc(plannedWorkouts.enrollmentId), asc(plannedWorkouts.plannedDate));
}

/** The enrollment ids that currently exist for the owner. */
export async function enrollmentIdsForOwner(owner: string): Promise<ReadonlyArray<string>> {
  const rows = await db
    .select({ id: programEnrollments.id })
    .from(programEnrollments)
    .where(eq(programEnrollments.userId, owner));
  return rows.map((row) => row.id);
}
