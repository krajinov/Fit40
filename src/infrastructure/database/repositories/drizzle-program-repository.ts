import type { ProgramRepository } from '@/application/ports/program-repository';
import type { TrainingProgram } from '@/domain/entities/training-program';

import { eq, inArray } from 'drizzle-orm';

import { mapProgramToDomain } from '../mappers/program-mapper';
import {
  programWeeks,
  scheduledWorkouts,
  trainingPrograms,
  workoutExercises,
  workouts,
} from '../schema';

import type { DrizzleDatabase } from './types';

export class DrizzleProgramRepository implements ProgramRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async list(): Promise<ReadonlyArray<TrainingProgram>> {
    const programs = await this.db.select().from(trainingPrograms);

    return this.loadPrograms(programs);
  }

  async findBySlug(slug: string): Promise<TrainingProgram | null> {
    const programs = await this.db.select().from(trainingPrograms).where(eq(trainingPrograms.slug, slug));
    const program = programs[0];

    if (program === undefined) {
      return null;
    }

    const loaded = await this.loadPrograms([program]);

    return loaded[0] ?? null;
  }

  private async loadPrograms(programRows: ReadonlyArray<typeof trainingPrograms.$inferSelect>): Promise<ReadonlyArray<TrainingProgram>> {
    const programIds = programRows.map((row) => row.id);

    if (programIds.length === 0) {
      return [];
    }

    const workoutRows = await this.db
      .select()
      .from(workouts)
      .where(inArray(workouts.programId, programIds))
      .orderBy(workouts.id);

    const workoutIds = workoutRows.map((row) => row.id);
    const exerciseRows =
      workoutIds.length > 0
        ? await this.db
            .select()
            .from(workoutExercises)
            .where(inArray(workoutExercises.workoutId, workoutIds))
            .orderBy(workoutExercises.workoutId, workoutExercises.exerciseOrder)
        : [];

    const weekRows = await this.db
      .select()
      .from(programWeeks)
      .where(inArray(programWeeks.programId, programIds))
      .orderBy(programWeeks.programId, programWeeks.weekNumber);

    const scheduledRows = await this.db
      .select()
      .from(scheduledWorkouts)
      .where(inArray(scheduledWorkouts.programId, programIds))
      .orderBy(scheduledWorkouts.programId, scheduledWorkouts.weekNumber, scheduledWorkouts.orderInWeek);

    return programRows.map((programRow) =>
      mapProgramToDomain(
        programRow,
        workoutRows.filter((row) => row.programId === programRow.id),
        exerciseRows,
        weekRows.filter((row) => row.programId === programRow.id),
        scheduledRows.filter((row) => row.programId === programRow.id),
      ),
    );
  }
}
