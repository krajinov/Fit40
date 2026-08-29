/**
 * Use case: retrieve the current user's workout session for a scheduled
 * workout occurrence, along with whether the user is enrolled in the program.
 *
 * The session is resolved through the user's enrollment, so users never see
 * each other's sessions for the same occurrence. When the user is not
 * enrolled, no session can exist for them and the view reports
 * `enrolled: false` so the presentation layer can offer the join action.
 */

import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import { toWorkoutSessionDto, type WorkoutSessionDto } from '@/application/dto/workout-session';
import { findScheduledWorkoutOccurrence } from '@/domain/services/scheduled-workout';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';

export type GetWorkoutSessionError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | {
      readonly code: 'SCHEDULED_WORKOUT_NOT_FOUND';
      readonly programSlug: string;
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly message: string;
    }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string };

export interface GetWorkoutSessionInput {
  readonly userId: string;
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}

export interface WorkoutSessionView {
  readonly enrolled: boolean;
  readonly session: WorkoutSessionDto | null;
}

export class GetWorkoutSessionUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
  ) {}

  async execute(
    input: GetWorkoutSessionInput,
  ): Promise<Result<WorkoutSessionView, GetWorkoutSessionError>> {
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

    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: userIdResult.error.message,
        field: 'userId',
      });
    }

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(
      userIdResult.data,
      program.id,
    );
    if (enrollment === null) {
      return ok({ enrolled: false, session: null });
    }

    const session = await this.sessionRepository.findByEnrollmentAndScheduledWorkout(
      enrollment.id,
      occurrence.scheduled.id,
    );

    return ok({
      enrolled: true,
      session: session === null ? null : toWorkoutSessionDto(session),
    });
  }
}
