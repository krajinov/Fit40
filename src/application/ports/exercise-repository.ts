/**
 * Exercise repository port.
 *
 * Defines the contract that the in-memory (and future Drizzle) repository
 * must satisfy. The application layer depends only on this port, not on any
 * concrete data store.
 */

import type { Exercise } from '@/domain/entities/exercise';

export interface ExerciseRepository {
  /**
   * Returns all exercises in the catalog.
   */
  list(): Promise<ReadonlyArray<Exercise>>;

  /**
   * Finds a single exercise by its slug, or null if not found.
   */
  findBySlug(slug: string): Promise<Exercise | null>;
}