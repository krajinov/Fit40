import { asc, eq, inArray } from 'drizzle-orm';

import type { ProgramRepository, SessionRoute } from '@/application/ports/program-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';
import type { ScheduledWorkoutId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapProgramRows } from '../mappers/program-read-mapper';
import {
  programWeeks,
  scheduledWorkouts,
  trainingPrograms,
  workoutExercises,
  workouts,
} from '../schema';

interface ProgramChildren {
  readonly workouts: ReadonlyArray<typeof workouts.$inferSelect>;
  readonly workoutExercises: ReadonlyArray<typeof workoutExercises.$inferSelect>;
  readonly weeks: ReadonlyArray<typeof programWeeks.$inferSelect>;
  readonly scheduledWorkouts: ReadonlyArray<typeof scheduledWorkouts.$inferSelect>;
}

function groupByProgram<T extends { programId: string }>(rows: ReadonlyArray<T>): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const row of rows) {
    const list = map.get(row.programId) ?? [];
    list.push(row);
    map.set(row.programId, list);
  }
  return map;
}

/**
 * Drizzle implementation of the read-only ProgramRepository port.
 *
 * `list()` loads all programs and their children with a small fixed number of
 * batched queries, then assembles each aggregate in memory (no N+1).
 */
export class DrizzleProgramRepository implements ProgramRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<ReadonlyArray<TrainingProgram>> {
    const programRows = await this.db
      .select()
      .from(trainingPrograms)
      .orderBy(asc(trainingPrograms.name));

    if (programRows.length === 0) {
      return [];
    }

    return this.hydrate(programRows);
  }

  async findBySlug(slug: string): Promise<TrainingProgram | null> {
    const programRows = await this.db
      .select()
      .from(trainingPrograms)
      .where(eq(trainingPrograms.slug, slug))
      .limit(1);

    if (programRows.length === 0) {
      return null;
    }

    const programs = await this.hydrate(programRows);
    return programs[0] ?? null;
  }

  async findSessionRouteByScheduledWorkoutId(
    scheduledWorkoutId: ScheduledWorkoutId,
  ): Promise<SessionRoute | null> {
    const rows = await this.db
      .select({
        programSlug: trainingPrograms.slug,
        weekNumber: scheduledWorkouts.weekNumber,
        workoutOrder: scheduledWorkouts.orderInWeek,
      })
      .from(scheduledWorkouts)
      .innerJoin(trainingPrograms, eq(scheduledWorkouts.programId, trainingPrograms.id))
      .where(eq(scheduledWorkouts.id, scheduledWorkoutId))
      .limit(1);

    return rows[0] ?? null;
  }

  private async loadChildren(programIds: string[]): Promise<ProgramChildren> {
    const workoutRows = await this.db
      .select()
      .from(workouts)
      .where(inArray(workouts.programId, programIds));

    const workoutIds = workoutRows.map((row) => row.id);
    const workoutExerciseRows =
      workoutIds.length === 0
        ? []
        : await this.db
            .select()
            .from(workoutExercises)
            .where(inArray(workoutExercises.workoutId, workoutIds));

    const weekRows = await this.db
      .select()
      .from(programWeeks)
      .where(inArray(programWeeks.programId, programIds));

    const scheduledWorkoutRows = await this.db
      .select()
      .from(scheduledWorkouts)
      .where(inArray(scheduledWorkouts.programId, programIds));

    return {
      workouts: workoutRows,
      workoutExercises: workoutExerciseRows,
      weeks: weekRows,
      scheduledWorkouts: scheduledWorkoutRows,
    };
  }

  private async hydrate(
    programRows: ReadonlyArray<typeof trainingPrograms.$inferSelect>,
  ): Promise<TrainingProgram[]> {
    const children = await this.loadChildren(programRows.map((row) => row.id));

    const workoutsByProgram = groupByProgram(children.workouts);
    const weeksByProgram = groupByProgram(children.weeks);
    const scheduledByProgram = groupByProgram(children.scheduledWorkouts);

    return programRows.map((program) => {
      const programWorkouts = workoutsByProgram.get(program.id) ?? [];
      const workoutIds = new Set(programWorkouts.map((workout) => workout.id));

      return mapProgramRows({
        program,
        workouts: programWorkouts,
        workoutExercises: children.workoutExercises.filter((row) => workoutIds.has(row.workoutId)),
        weeks: weeksByProgram.get(program.id) ?? [],
        scheduledWorkouts: scheduledByProgram.get(program.id) ?? [],
      });
    });
  }
}
