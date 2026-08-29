/**
 * In-memory implementation of the ProgramRepository port.
 *
 * Backed by the validated seed programs. A future Drizzle implementation can
 * replace this class without changing domain or application code.
 */

import type {
  ProgramMetadata,
  ProgramRepository,
  SessionRoute,
} from '@/application/ports/program-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import type { ProgramId, ScheduledWorkoutId } from '@/domain/types/ids';
import { seedPrograms } from '@/infrastructure/programs/seed-programs';

export class InMemoryProgramRepository implements ProgramRepository {
  async list(): Promise<ReadonlyArray<TrainingProgram>> {
    // Return a shallow copy so callers cannot mutate the source catalog.
    return [...seedPrograms];
  }

  async findBySlug(slug: string): Promise<TrainingProgram | null> {
    return seedPrograms.find((program) => program.slug === slug) ?? null;
  }

  async findSessionRouteByScheduledWorkoutId(
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<SessionRoute | null> {
    for (const program of seedPrograms) {
      for (const week of program.weeks) {
        const scheduled = week.scheduledWorkouts.find(
          (candidate) => candidate.id === scheduledWorkoutId,
        );
        if (scheduled !== undefined) {
          return {
            programSlug: program.slug,
            weekNumber: week.weekNumber,
            workoutOrder: scheduled.order,
          };
        }
      }
    }
    return null;
  }

  async listMetadataByIds(
    programIds: ReadonlyArray<ProgramId>,
  ): Promise<ReadonlyArray<ProgramMetadata>> {
    const requested = new Set<string>(programIds);
    return seedPrograms
      .filter((program) => requested.has(program.id))
      .map((program) => ({ id: program.id, slug: program.slug, name: program.name }));
  }
}