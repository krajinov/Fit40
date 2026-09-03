/**
 * Data transfer objects for the dashboard's current-program view.
 *
 * DTOs are plain, serializable shapes. Reuses ProgramDetailDto and the
 * enrollment view DTOs; the next-workout preview carries the raw domain
 * prescription so display formatting stays in the presentation layer.
 */

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ProgramDetailDto } from '@/application/dto/program';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

/** Whether the next workout's session has already been started by the user. */
export type NextWorkoutSessionState = 'not-started' | 'in-progress';

/** One previewed exercise row of the next scheduled workout. */
export interface NextWorkoutPreviewExerciseDto {
  /** Position in the scheduled workout — stable occurrence identity for
   * React keys (exercise ids/names are not guaranteed unique within a
   * workout). */
  readonly order: number;
  readonly exerciseName: string;
  readonly prescription: RepPrescription;
}

/**
 * The user's next scheduled workout, resolved for the dashboard "Up next"
 * card. `preview` holds at most NEXT_WORKOUT_PREVIEW_LIMIT exercises.
 */
export interface NextWorkoutDto {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly workoutName: string;
  readonly exerciseCount: number;
  readonly estimatedMinutes: number;
  readonly preview: ReadonlyArray<NextWorkoutPreviewExerciseDto>;
  readonly sessionState: NextWorkoutSessionState;
}

/**
 * The user's current program as shown on the dashboard: the most recently
 * joined enrollment, hydrated with program detail, per-enrollment progress
 * and next-workout state.
 */
export interface CurrentProgramDashboardDto {
  readonly program: ProgramDetailDto;
  readonly enrollment: Extract<ProgramEnrollmentViewDto, { status: 'enrolled' }>;
  readonly nextWorkout: NextWorkoutDto | null;
}
