/**
 * Program repository port.
 *
 * Defines the read-only contract that the in-memory (and future Drizzle)
 * repository must satisfy. The application layer depends only on this port.
 */

import type { ProgramId, ScheduledWorkoutId } from '@/domain/types/ids';
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

  /**
   * Returns lightweight display metadata (id, slug, name) for the given
   * program ids. Programs that no longer exist are omitted. Scoped to the
   * requested ids — callers must not use this to load the whole catalog.
   */
  listMetadataByIds(
    programIds: ReadonlyArray<ProgramId>,
  ): Promise<ReadonlyArray<ProgramMetadata>>;
}

/**
 * Lightweight program display metadata for enrollment list views.
 *
 * Deliberately carries no training content: hydrating full program
 * aggregates for these views would load workouts, exercises, weeks, and
 * scheduled workouts only to discard them.
 */
export interface ProgramMetadata {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
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