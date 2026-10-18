import { toExerciseHistoryPresenceDto, type ExerciseHistoryPresenceDto } from '@/application/dto/exercise-history-presence';
import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import type { ExerciseNotFoundError } from '@/application/use-cases/get-exercise-by-slug';
import { createUserId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

export type GetExerciseHistoryPresenceError = ExerciseNotFoundError | {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field: 'userId';
};

/** Read-only; userId must come from the trusted authenticated session. */
export class GetExerciseHistoryPresenceUseCase {
  constructor(
    private readonly trainingHistoryRepository: TrainingHistoryRepository,
    private readonly exerciseRepository: ExerciseRepository,
  ) {}

  async execute(input: {
    readonly userId: string;
    readonly slug: string;
  }): Promise<Result<ExerciseHistoryPresenceDto, GetExerciseHistoryPresenceError>> {
    const userId = createUserId(input.userId);
    if (!userId.ok) {
      return err({ code: 'INVALID_INPUT', message: userId.error.message, field: 'userId' });
    }
    const exercise = await this.exerciseRepository.findBySlug(input.slug);
    if (exercise === null) {
      return err({ code: 'EXERCISE_NOT_FOUND', slug: input.slug, message: `Exercise "${input.slug}" not found` });
    }

    // Catch only the optional history read. Public catalog lookup and framework
    // navigation stay outside this seam. The port already owns completed-only,
    // logged-set, detached-session and performed-exercise attribution contracts.
    try {
      const occurrences = await this.trainingHistoryRepository.listCompletedExerciseOccurrences(
        userId.data, exercise.id, 1,
      );
      return ok(toExerciseHistoryPresenceDto(occurrences.length > 0));
    } catch (cause) {
      return ok({ status: 'unavailable', cause });
    }
  }
}
