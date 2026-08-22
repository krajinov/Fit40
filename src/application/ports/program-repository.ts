/**
 * Program repository port.
 *
 * Defines the read-only contract that the in-memory (and future Drizzle)
 * repository must satisfy. The application layer depends only on this port.
 */

import type { TrainingProgram } from '@/domain/entities/training-program';

export interface ProgramRepository {
  /**
   * Returns all programs.
   */
  list(): Promise<ReadonlyArray<TrainingProgram>>;

  /**
   * Finds a single program by its slug, or null if not found.
   */
  findBySlug(slug: string): Promise<TrainingProgram | null>;
}