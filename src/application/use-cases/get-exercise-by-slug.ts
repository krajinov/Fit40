/**
 * Use case: retrieve a single exercise by slug.
 *
 * Returns a Result so the caller can distinguish "not found" from success.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { ExerciseDetailDto } from '@/application/dto/exercise';
import type { Exercise } from '@/domain/entities/exercise';
import { err, ok, type Result } from '@/lib/result';

export interface ExerciseNotFoundError {
  readonly code: 'EXERCISE_NOT_FOUND';
  readonly slug: string;
  readonly message: string;
}

function toDetailDto(exercise: Exercise): ExerciseDetailDto {
  return {
    id: exercise.id,
    name: exercise.name,
    slug: exercise.slug,
    description: exercise.description,
    primaryMuscle: exercise.primaryMuscle,
    secondaryMuscles: exercise.secondaryMuscles,
    equipment: exercise.equipment,
    difficulty: exercise.difficulty,
    movementPattern: exercise.movementPattern,
    considerations: exercise.considerations,
  };
}

export class GetExerciseBySlugUseCase {
  constructor(private readonly exerciseRepository: ExerciseRepository) {}

  async execute(
    slug: string,
  ): Promise<Result<ExerciseDetailDto, ExerciseNotFoundError>> {
    const exercise = await this.exerciseRepository.findBySlug(slug);

    if (exercise === null) {
      return err({
        code: 'EXERCISE_NOT_FOUND',
        slug,
        message: `Exercise "${slug}" not found`,
      });
    }

    return ok(toDetailDto(exercise));
  }
}