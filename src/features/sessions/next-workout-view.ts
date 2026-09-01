/**
 * Presentation view of the next scheduled workout, shared by the dashboard
 * "Up next" card and the program detail enrollment panel.
 *
 * Assembles DTOs from existing read-only use cases (the scheduled workout
 * detail plus the user's session state for that occurrence). Nothing is
 * derived that the application layer does not already expose; no domain or
 * repository types cross into presentation.
 */

import { formatPrescription } from '@/features/programs/program-labels';
import { getScheduledWorkoutUseCase } from '@/features/programs/services';
import { getWorkoutSessionUseCase } from '@/features/sessions/services';

export interface NextWorkoutExercisePreview {
  readonly exerciseName: string;
  readonly prescriptionLabel: string;
}

/** How many exercise rows the cards preview before the "+ N more" row. */
export const NEXT_WORKOUT_PREVIEW_COUNT = 3;

export type NextWorkoutSessionState = 'not-started' | 'in-progress';

export interface NextWorkoutView {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly workoutName: string;
  readonly exerciseCount: number;
  readonly estimatedMinutes: number;
  readonly preview: ReadonlyArray<NextWorkoutExercisePreview>;
  readonly sessionState: NextWorkoutSessionState;
}

export interface NextWorkoutInput {
  readonly userId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * Resolves the presentation view for one scheduled-workout occurrence.
 * Returns null when the occurrence cannot be resolved (only possible when the
 * catalog changes mid-request); callers then render no card rather than
 * stale or fabricated data.
 */
export async function buildNextWorkoutView(
  input: NextWorkoutInput,
): Promise<NextWorkoutView | null> {
  const workoutResult = await getScheduledWorkoutUseCase.execute({
    programSlug: input.programSlug,
    weekNumber: input.weekNumber,
    workoutOrder: input.workoutOrder,
  });
  if (!workoutResult.ok) {
    return null;
  }

  const sessionResult = await getWorkoutSessionUseCase.execute({
    userId: input.userId,
    programSlug: input.programSlug,
    weekNumber: input.weekNumber,
    workoutOrder: input.workoutOrder,
  });
  if (!sessionResult.ok) {
    return null;
  }

  const workout = workoutResult.data.workout;
  const sessionState: NextWorkoutSessionState =
    sessionResult.data.session !== null &&
    sessionResult.data.session.status === 'in-progress'
      ? 'in-progress'
      : 'not-started';

  return {
    programSlug: input.programSlug,
    weekNumber: input.weekNumber,
    workoutOrder: input.workoutOrder,
    workoutName: workout.name,
    exerciseCount: workout.exercises.length,
    estimatedMinutes: workout.estimatedDurationMinutes,
    preview: workout.exercises
      .slice(0, NEXT_WORKOUT_PREVIEW_COUNT)
      .map((exercise) => ({
        exerciseName: exercise.exerciseName,
        prescriptionLabel: formatPrescription(exercise.prescription),
      })),
    sessionState,
  };
}
