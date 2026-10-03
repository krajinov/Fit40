/**
 * Use case: resolve the user's next scheduled workout preview.
 *
 * Ported from the presentation-layer next-workout-view assembly (PR #9 P1):
 * orchestrating the scheduled-workout detail with the user's session state
 * is application orchestration. The raw prescription value objects are
 * returned; label formatting stays in presentation.
 *
 * M17 final review: the preview carries the occurrence's authoritative
 * settlement truth. `GetWorkoutSessionUseCase` already reports
 * `notPerformedRecorded` for the user's own run, so a recorded occurrence maps
 * to the `not-performed` session state — never `not-started`, which would
 * advertise a Start the backend refuses. The degraded paths (a null closure
 * read that falls back to the M14 `nextWorkout`) therefore stay non-startable
 * without any surface inspecting a repository or recomputing settlement.
 */

import type { NextWorkoutDto, NextWorkoutSessionState } from '@/application/dto/dashboard';
import type { GetScheduledWorkoutUseCase } from '@/application/use-cases/get-scheduled-workout';
import type { GetWorkoutSessionUseCase } from '@/application/use-cases/get-workout-session';

/** How many exercise rows are previewed before the "+ N more" row. */
export const NEXT_WORKOUT_PREVIEW_LIMIT = 3;

export interface ResolveNextWorkoutInput {
  readonly userId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export class ResolveNextWorkoutUseCase {
  constructor(
    private readonly scheduledWorkout: Pick<GetScheduledWorkoutUseCase, 'execute'>,
    private readonly workoutSession: Pick<GetWorkoutSessionUseCase, 'execute'>,
  ) {}

  /**
   * Returns null when the occurrence or the user's session state cannot be
   * resolved (only possible when the catalog changes mid-request); callers
   * then render no card rather than stale or fabricated data.
   */
  async execute(input: ResolveNextWorkoutInput): Promise<NextWorkoutDto | null> {
    const workoutResult = await this.scheduledWorkout.execute({
      programSlug: input.programSlug,
      weekNumber: input.weekNumber,
      workoutOrder: input.workoutOrder,
    });
    if (!workoutResult.ok) {
      return null;
    }

    const sessionResult = await this.workoutSession.execute({
      userId: input.userId,
      programSlug: input.programSlug,
      weekNumber: input.weekNumber,
      workoutOrder: input.workoutOrder,
    });
    if (!sessionResult.ok) {
      return null;
    }

    const workout = workoutResult.data.workout;
    // M17 final review: the occurrence's authoritative settlement fact comes
    // from the SAME user-scoped session read — never from a client flag. A
    // recorded occurrence has no session but is settled, so it is NEVER
    // 'not-started' (which would advertise a Start the backend refuses).
    const sessionState: NextWorkoutSessionState = sessionResult.data.notPerformedRecorded
      ? 'not-performed'
      : sessionResult.data.session !== null &&
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
        .slice(0, NEXT_WORKOUT_PREVIEW_LIMIT)
        .map((exercise) => ({
          order: exercise.order,
          exerciseName: exercise.exerciseName,
          prescription: exercise.prescription,
        })),
      sessionState,
    };
  }
}
