/**
 * Use case: one completed session of the authenticated user, for the
 * history detail screen.
 *
 * Read-only. The userId must come from the trusted authenticated session at
 * the presentation layer, never from client input; the sessionId is URL
 * input and is validated here before the repository is touched.
 *
 * The error contract is deliberately single-outcome: SESSION_NOT_FOUND is
 * returned for a missing session, another user's session, and a
 * still-in-progress session alike — an unresolvable detail URL must not
 * reveal whether an id exists for someone else. Infrastructure failures
 * (the repository throwing) stay unexpected and propagate to error
 * boundaries.
 */

import {
  toCompletedSessionDto,
  type CompletedSessionDto,
  type ExerciseMeta,
} from '@/application/dto/completed-session';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import { createUserId, createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetCompletedSessionError = {
  readonly code: 'INVALID_INPUT' | 'SESSION_NOT_FOUND';
  readonly message: string;
  readonly field?: string;
};

export interface GetCompletedSessionInput {
  readonly userId: string;
  readonly sessionId: string;
}

export class GetCompletedSessionUseCase {
  constructor(
    private readonly historyRepository: TrainingHistoryRepository,
    private readonly exerciseRepository: ExerciseRepository,
  ) {}

  async execute(
    input: GetCompletedSessionInput,
  ): Promise<Result<CompletedSessionDto, GetCompletedSessionError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({ code: 'INVALID_INPUT', message: userIdResult.error.message, field: 'userId' });
    }

    const sessionIdResult = createWorkoutSessionId(input.sessionId);
    if (!sessionIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: sessionIdResult.error.message,
        field: 'sessionId',
      });
    }

    const context = await this.historyRepository.findCompletedSessionById(
      userIdResult.data,
      sessionIdResult.data,
    );
    if (context === null) {
      return err({ code: 'SESSION_NOT_FOUND', message: 'Completed workout session not found' });
    }

    // One batched catalog read for display metadata only. Current catalog
    // state never overrides the persisted snapshot; a sparse map (unresolved
    // exercises) degrades to positional labels in the view instead of
    // failing the read.
    const exerciseIds = [...new Set(context.session.exerciseLogs.map((log) => log.exerciseId))];
    const catalogExercises = await this.exerciseRepository.findByIds(exerciseIds);
    const exerciseCatalog = new Map<string, ExerciseMeta>(
      catalogExercises.map((exercise) => [
        exercise.id,
        { name: exercise.name, slug: exercise.slug, equipment: exercise.equipment },
      ]),
    );

    return ok(toCompletedSessionDto(context, exerciseCatalog));
  }
}
