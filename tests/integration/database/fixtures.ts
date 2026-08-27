/**
 * Fixtures shared by the persistence integration suite.
 *
 * Sessions are built from the seeded program so that every foreign key points at
 * a row that exists, and mutations go through the domain API rather than by
 * hand-writing database rows.
 */

import type { WorkoutExercise } from '@/domain/entities/workout';
import {
  completeWorkoutSession,
  createWorkoutSession,
  deleteSessionSet,
  logSessionSet,
  updateSessionSet,
  type DeleteSetInput,
  type LogSetCommandInput,
  type UpdateSetCommandInput,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import type { ScheduledWorkoutId, WorkoutId } from '@/domain/types/ids';
import type { Result } from '@/lib/result';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';

import { testDb } from './setup';

export const SEEDED_PROGRAM_SLUG = 'fit40-beginner-strength';

const DEFAULT_STARTED_AT = new Date('2026-08-27T10:00:00.000Z');

export interface OccurrenceFixture {
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly workoutId: WorkoutId;
  readonly exercises: ReadonlyArray<WorkoutExercise>;
}

/** Resolves one scheduled occurrence of the seeded beginner-strength program. */
export async function loadOccurrence(
  weekNumber = 1,
  workoutOrder = 1,
): Promise<OccurrenceFixture> {
  const program = await new DrizzleProgramRepository(testDb).findBySlug(SEEDED_PROGRAM_SLUG);
  const scheduled = program?.weeks
    .find((week) => week.weekNumber === weekNumber)
    ?.scheduledWorkouts.find((entry) => entry.order === workoutOrder);
  const workout = program?.workouts.find((entry) => entry.id === scheduled?.workoutId);

  if (scheduled === undefined || workout === undefined) {
    throw new Error(`Seeded program is missing week ${weekNumber} occurrence ${workoutOrder}`);
  }

  return {
    scheduledWorkoutId: scheduled.id,
    workoutId: workout.id,
    exercises: workout.exercises,
  };
}

/** An in-progress session snapshotting every exercise of the occurrence. */
export function startSession(
  id: string,
  occurrence: OccurrenceFixture,
  startedAt: Date = DEFAULT_STARTED_AT,
): WorkoutSession {
  return unwrap(
    createWorkoutSession({
      id,
      scheduledWorkoutId: occurrence.scheduledWorkoutId,
      workoutId: occurrence.workoutId,
      startedAt,
      exerciseLogs: occurrence.exercises.map((exercise) => ({
        exerciseId: exercise.exerciseId,
        order: exercise.order,
        prescription: exercise.prescription,
        restSeconds: exercise.restSeconds,
      })),
    }),
    'start session',
  );
}

export function withLoggedSet(session: WorkoutSession, input: LogSetCommandInput): WorkoutSession {
  return unwrap(logSessionSet(session, input), 'log set');
}

export function withUpdatedSet(session: WorkoutSession, input: UpdateSetCommandInput): WorkoutSession {
  return unwrap(updateSessionSet(session, input), 'update set');
}

export function withDeletedSet(session: WorkoutSession, input: DeleteSetInput): WorkoutSession {
  return unwrap(deleteSessionSet(session, input), 'delete set');
}

export function withCompletion(session: WorkoutSession, completedAt: Date): WorkoutSession {
  return unwrap(completeWorkoutSession(session, completedAt), 'complete session');
}

/** The first reps-prescribed exercise order of an occurrence. */
export function repsExercise(occurrence: OccurrenceFixture): WorkoutExercise {
  const exercise = occurrence.exercises.find((candidate) => candidate.prescription.type === 'reps');
  if (exercise === undefined) {
    throw new Error('Expected the seeded occurrence to contain a reps exercise');
  }
  return exercise;
}

/** The first duration-prescribed exercise order of an occurrence. */
export function durationExercise(occurrence: OccurrenceFixture): WorkoutExercise {
  const exercise = occurrence.exercises.find(
    (candidate) => candidate.prescription.type === 'duration',
  );
  if (exercise === undefined) {
    throw new Error('Expected the seeded occurrence to contain a duration exercise');
  }
  return exercise;
}

function unwrap<T>(result: Result<T, { readonly message: string }>, action: string): T {
  if (!result.ok) {
    throw new Error(`Failed to ${action}: ${result.error.message}`);
  }

  return result.data;
}
