/**
 * In-memory implementation of the ProgramRepository port.
 *
 * Backed by the validated seed programs. A future Drizzle implementation can
 * replace this class without changing domain or application code.
 */

import type { ProgramRepository } from '@/application/ports/program-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import type { ScheduledWorkoutId } from '@/domain/types/ids';
import { seedPrograms } from '@/infrastructure/programs/seed-programs';

export class InMemoryProgramRepository implements ProgramRepository {
  async list(): Promise<ReadonlyArray<TrainingProgram>> {
    // Return a shallow copy so callers cannot mutate the source catalog.
    return [...seedPrograms];
  }

  async findBySlug(slug: string): Promise<TrainingProgram | null> {
    return seedPrograms.find((program) => program.slug === slug) ?? null;
  }

  async findSlugByScheduledWorkoutId(
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<string | null> {
    for (const program of seedPrograms) {
      for (const week of program.weeks) {
        if (week.scheduledWorkouts.some((scheduled) => scheduled.id === scheduledWorkoutId)) {
          return program.slug;
        }
      }
    }
    return null;
  }
}