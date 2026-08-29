/**
 * Program repository port.
 *
 * Defines the read-only contract that the in-memory (and future Drizzle)
 * repository must satisfy. The application layer depends only on this port.
 */

import type { ScheduledWorkoutId } from '@/domain/types/ids';
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

  /**
   * Returns the slug of the program owning the given scheduled workout, or
   * null when no such scheduled workout exists. Lets use cases derive the
   * trusted owning-program route coordinate from session data instead of
   * client-supplied form fields.
   */
  findSlugByScheduledWorkoutId(scheduledWorkoutId: ScheduledWorkoutId): Promise<string | null>;
}