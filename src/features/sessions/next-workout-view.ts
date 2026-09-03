/**
 * Presentation view of the next scheduled workout, shared by the dashboard
 * "Up next" card and the program detail enrollment panel.
 *
 * The orchestration (scheduled workout detail + the user's session state)
 * lives in ResolveNextWorkoutUseCase (application layer); this module only
 * formats the raw prescription values into display labels. Nothing is
 * derived that the application layer does not already expose.
 */

import type { NextWorkoutDto } from '@/application/dto/dashboard';
import { NEXT_WORKOUT_PREVIEW_LIMIT } from '@/application/use-cases/resolve-next-workout';
import { formatPrescription } from '@/features/programs/program-labels';
import { resolveNextWorkoutUseCase } from '@/features/sessions/services';

export interface NextWorkoutExercisePreview {
  /** Position in the scheduled workout — stable React key (occurrence
   * identity), since exercise names are not guaranteed unique. */
  readonly order: number;
  readonly exerciseName: string;
  readonly prescriptionLabel: string;
}

/** How many exercise rows the cards preview before the "+ N more" row. */
export const NEXT_WORKOUT_PREVIEW_COUNT = NEXT_WORKOUT_PREVIEW_LIMIT;

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
 * Presentation state of the enrollment's next-workout preview. Deliberately
 * three-valued: an unresolvable preview (catalog change or lookup failure)
 * is NOT program completion, and must never render as one.
 *
 * - `available`:   the enrollment has a next workout and its preview resolved.
 * - `unavailable`: the enrollment still has a next workout
 *                  (`NextScheduledWorkoutDto` non-null) but its preview could
 *                  not be resolved — degraded state, no workout data shown.
 * - `complete`:    the enrollment has no next workout — every scheduled
 *                  workout is done.
 */
export type NextWorkoutPreviewState =
  | { readonly status: 'available'; readonly workout: NextWorkoutView }
  | { readonly status: 'unavailable' }
  | { readonly status: 'complete' };

/**
 * Maps the enrollment's scheduled next workout and the (possibly failed)
 * preview resolution onto the presentation state. Completion is keyed
 * exclusively on the application layer's `nextWorkout: null`; a non-null
 * scheduled workout with a null preview stays "unavailable" — never
 * "complete", and no workout data is fabricated.
 */
export function nextWorkoutPreviewState(
  scheduled: { readonly weekNumber: number; readonly workoutOrder: number } | null,
  workout: NextWorkoutView | null,
): NextWorkoutPreviewState {
  if (scheduled === null) {
    return { status: 'complete' };
  }
  return workout === null ? { status: 'unavailable' } : { status: 'available', workout };
}

/**
 * Formats the application-layer DTO into the presentation view (raw
 * prescription value objects → display labels). Shared with the dashboard
 * view assembly, which receives the DTO from
 * GetCurrentProgramDashboardUseCase and must not re-query.
 */
export function toNextWorkoutView(dto: NextWorkoutDto): NextWorkoutView {
  return {
    programSlug: dto.programSlug,
    weekNumber: dto.weekNumber,
    workoutOrder: dto.workoutOrder,
    workoutName: dto.workoutName,
    exerciseCount: dto.exerciseCount,
    estimatedMinutes: dto.estimatedMinutes,
    preview: dto.preview.map((exercise) => ({
      order: exercise.order,
      exerciseName: exercise.exerciseName,
      prescriptionLabel: formatPrescription(exercise.prescription),
    })),
    sessionState: dto.sessionState,
  };
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
  const dto = await resolveNextWorkoutUseCase.execute(input);
  return dto === null ? null : toNextWorkoutView(dto);
}

