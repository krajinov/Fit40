/**
 * In-memory implementation of the ExerciseRepository port.
 *
 * Backed by the validated seed catalog. A future Drizzle implementation can
 * replace this class without changing domain or application code.
 */

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { Exercise } from '@/domain/entities/exercise';
import type { ExerciseId } from '@/domain/types/ids';
import { seedExercises } from '@/infrastructure/exercises/seed-exercises';

export class InMemoryExerciseRepository implements ExerciseRepository {
  async list(): Promise<ReadonlyArray<Exercise>> {
    // Return a shallow copy so callers cannot mutate the source catalog.
    return [...seedExercises];
  }

  async findBySlug(slug: string): Promise<Exercise | null> {
    return seedExercises.find((exercise) => exercise.slug === slug) ?? null;
  }

  async findByIds(ids: ReadonlyArray<ExerciseId>): Promise<ReadonlyArray<Exercise>> {
    if (ids.length === 0) {
      return [];
    }

    const requested = new Set(ids);
    return seedExercises.filter((exercise) => requested.has(exercise.id));
  }
}