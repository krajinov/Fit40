/**
 * Use case: resolve the authenticated user's enrollment view of a program.
 *
 * Read-only. Progress and the next workout are derived per enrollment from
 * the enrollment's completed sessions using the pure program-progress domain
 * services — nothing derived is persisted, and one user's completions never
 * affect another user's view.
 */

import type {
  NextScheduledWorkoutDto,
  ProgramEnrollmentViewDto,
} from '@/application/dto/enrollment';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import {
  calculateProgramProgress,
  getNextWorkout,
} from '@/domain/services/program-progress';
import { getCompletedScheduledWorkoutIds } from '@/domain/services/session-progress';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/lib/result';

export type GetProgramEnrollmentError =
  | { readonly code: 'PROGRAM_NOT_FOUND'; readonly slug: string; readonly message: string }
  | { readonly code: 'INVALID_INPUT'; readonly message: string; readonly field?: string };

export interface GetProgramEnrollmentInput {
  readonly userId: string;
  readonly programSlug: string;
}

export class GetProgramEnrollmentUseCase {
  constructor(
    private readonly programRepository: ProgramRepository,
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
  ) {}

  async execute(
    input: GetProgramEnrollmentInput,
  ): Promise<Result<ProgramEnrollmentViewDto, GetProgramEnrollmentError>> {
    const program = await this.programRepository.findBySlug(input.programSlug);
    if (program === null) {
      return err({
        code: 'PROGRAM_NOT_FOUND',
        slug: input.programSlug,
        message: `Program "${input.programSlug}" not found`,
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
      return ok({ status: 'not-enrolled' });
    }

    const completedSessions = await this.sessionRepository.listCompletedByEnrollmentId(
      enrollment.id,
    );
    const completedIds = getCompletedScheduledWorkoutIds(completedSessions);
    const progress = calculateProgramProgress(program, completedIds);
    const nextWorkout = resolveNextWorkout(program, completedIds);

    return ok({
      status: 'enrolled',
      enrolledAt: enrollment.enrolledAt.toISOString(),
      progress: {
        totalWorkouts: progress.totalWorkouts,
        completedWorkouts: progress.completedWorkouts,
        percentage: progress.percentage,
      },
      nextWorkout,
      completedScheduledWorkoutIds: completedIds,
    });
  }
}

function resolveNextWorkout(
  program: TrainingProgram,
  completedIds: Parameters<typeof getNextWorkout>[1],
): NextScheduledWorkoutDto | null {
  const next = getNextWorkout(program, completedIds);
  if (next === null) {
    return null;
  }

  // The next occurrence comes from the program's own weeks, so the enclosing
  // week always exists; the guard avoids a non-null assertion regardless.
  const week = program.weeks.find((w) =>
    w.scheduledWorkouts.some((scheduled) => scheduled.id === next.id),
  );
  if (week === undefined) {
    return null;
  }

  return { weekNumber: week.weekNumber, workoutOrder: next.order };
}
