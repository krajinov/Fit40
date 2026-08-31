/**
 * Exercise repository port.
 *
 * Defines the contract that the in-memory (and future Drizzle) repository
 * must satisfy. The application layer depends only on this port, not on any
 * concrete data store.
 */

import type { Exercise } from '@/domain/entities/exercise';
import type { ExerciseId } from '@/domain/types/ids';

export interface ExerciseRepository {
  /**
   * Returns all exercises in the catalog.
   */
  list(): Promise<ReadonlyArray<Exercise>>;

  /**
   * Finds a single exercise by its slug, or null if not found.
   */
  findBySlug(slug: string): Promise<Exercise | null>;

  /**
   * Returns the exercises with the given ids.
   *
   * Contract:
   * - Exercises that no longer exist are omitted; the caller decides whether
   *   absence is an error (a workout referencing a deleted exercise) or is
   *   skipped defensively.
   * - At most one exercise per distinct id: duplicate ids in the input
   *   collapse to a single result.
   * - Scoped to exactly the requested ids — callers must not use this to
   *   load the whole catalog.
   * - An empty `ids` returns an empty result without querying.
   */
  findByIds(ids: ReadonlyArray<ExerciseId>): Promise<ReadonlyArray<Exercise>>;
}