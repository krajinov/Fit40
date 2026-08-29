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
   * Resolves the trusted route coordinates of a scheduled workout occurrence:
   * the owning program's slug plus the occurrence's week number and workout
   * order — the exact coordinates of its canonical session URL. Null when the
   * scheduled workout (or its program) no longer exists. Use cases derive
   * revalidation targets from this server-side data instead of
   * client-supplied form fields.
   */
  findSessionRouteByScheduledWorkoutId(
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<SessionRoute | null>;
}

/**
 * The owning program and canonical route coordinates of a scheduled workout
 * occurrence, resolved server-side so presentation code never trusts
 * client-supplied route fields for cache invalidation.
 */
export interface SessionRoute {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
}