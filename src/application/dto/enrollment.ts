/**
 * Data transfer objects for program enrollment data crossing layer boundaries.
 *
 * DTOs are plain, serializable shapes. Branded IDs are stripped to plain
 * strings, Date objects are serialized to ISO 8601 strings. All progress data
 * is derived per enrollment at read time — nothing derived is persisted.
 */

/**
 * Reference to the next incomplete scheduled workout of an enrolled program,
 * addressed by its public route coordinates.
 */
export interface NextScheduledWorkoutDto {
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

/**
 * Derived progress of one enrollment. Completion is measured against the
 * program's scheduled workouts using the enrollment's completed sessions.
 */
export interface EnrollmentProgressDto {
  readonly totalWorkouts: number;
  readonly completedWorkouts: number;
  readonly percentage: number;
}

/**
 * Per-user enrollment view of a training program.
 *
 * - `not-enrolled`: the user has no enrollment in the program.
 * - `enrolled`: `nextWorkout` is null when every scheduled workout of the
 *   program has been completed within this enrollment;
 *   `completedScheduledWorkoutIds` drives the Done markers in the schedule.
 */
export type ProgramEnrollmentViewDto =
  | { readonly status: 'not-enrolled' }
  | {
      readonly status: 'enrolled';
      readonly enrolledAt: string;
      readonly progress: EnrollmentProgressDto;
      readonly nextWorkout: NextScheduledWorkoutDto | null;
      readonly completedScheduledWorkoutIds: ReadonlyArray<string>;
    };

/**
 * Summary of one enrollment, for listing the authenticated user's plans.
 */
export interface EnrollmentSummaryDto {
  readonly programId: string;
  readonly programSlug: string;
  readonly programName: string;
  readonly enrolledAt: string;
}
