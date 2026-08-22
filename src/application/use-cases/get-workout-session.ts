/**
 * Use case: retrieve the current workout session for a scheduled workout.
 *
 * Returns null if no session exists yet (i.e. the workout has not been started).
 */

import type { ProgramRepository } from '@/application/ports/program-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { err, ok, type Result } from '@/lib/result';

export type GetWorkoutSessionError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | {
      readonly code: 'SCHEDULED_WORKOUT_NOT_FOUND';
      readonly programSlug: string;
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly message: string;
    };

export interface GetWorkoutSessionInput {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export class GetWorkoutSessionUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
  ) {}

  async execute(
    input: GetWorkoutSessionInput,
  ): Promise<Result<WorkoutSessionDto | null, GetWorkoutSessionError>> {
    const program = await this.programRepository.findBySlug(input.programSlug);
    if (program === null) {
      return err({
        code: 'PROGRAM_NOT_FOUND',
        slug: input.programSlug,
        message: `Program "${input.programSlug}" not found`,
      });
    }

    const occurrence = findScheduledWorkoutOccurrence(
      program,
      input.weekNumber,
      input.workoutOrder,
    );

    if (occurrence === null) {
      return err({
        code: 'SCHEDULED_WORKOUT_NOT_FOUND',
        programSlug: input.programSlug,
        weekNumber: input.weekNumber,
        workoutOrder: input.workoutOrder,
        message: `Scheduled workout not found for week ${input.weekNumber}, order ${input.workoutOrder}`,
      });
    }

    const session = await this.sessionRepository.findByScheduledWorkoutId(occurrence.scheduled.id);

    if (session === null) {
      return ok(null);
    }

    return ok(toWorkoutSessionDto(session));
  }
}