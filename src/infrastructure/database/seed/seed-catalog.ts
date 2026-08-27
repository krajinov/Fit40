import { seedExercises } from '@/infrastructure/exercises/seed-exercises';
import { seedPrograms } from '@/infrastructure/programs/seed-programs';

import { exerciseToRow } from '../mappers/exercise-mapper';
import { prescriptionToRow } from '../mappers/prescription-mapper';
import type { DrizzleDatabase } from '../repositories/types';
import * as schema from '../schema';

export async function seedCatalog(db: DrizzleDatabase): Promise<void> {
  await db.transaction(async (tx) => {
    await seedExercisesTable(tx);
    await seedProgramsTable(tx);
  });
}

async function seedExercisesTable(tx: DrizzleDatabase): Promise<void> {
  const rows = seedExercises.map((exercise) => exerciseToRow(exercise));

  if (rows.length === 0) {
    return;
  }

  await tx.insert(schema.exercises).values(rows).onConflictDoNothing();
}

async function seedProgramsTable(tx: DrizzleDatabase): Promise<void> {
  for (const program of seedPrograms) {
    await tx
      .insert(schema.trainingPrograms)
      .values({
        id: program.id,
        slug: program.slug,
        name: program.name,
        description: program.description,
        difficulty: program.difficulty,
        goal: program.goal,
        durationWeeks: program.durationWeeks,
        workoutsPerWeek: program.workoutsPerWeek,
      })
      .onConflictDoNothing();

    for (const workout of program.workouts) {
      await tx
        .insert(schema.workouts)
        .values({
          id: workout.id,
          programId: program.id,
          slug: workout.slug,
          name: workout.name,
          description: workout.description,
          estimatedDurationMinutes: workout.estimatedDurationMinutes,
        })
        .onConflictDoNothing();

      const exerciseRows = workout.exercises.map((exercise) => {
        const prescription = prescriptionToRow(exercise.prescription);

        return {
          workoutId: workout.id,
          exerciseOrder: exercise.order,
          exerciseId: exercise.exerciseId,
          ...prescription,
          restSeconds: exercise.restSeconds,
          notes: exercise.notes,
        };
      });

      if (exerciseRows.length > 0) {
        await tx.insert(schema.workoutExercises).values(exerciseRows).onConflictDoNothing();
      }
    }

    for (const week of program.weeks) {
      await tx
        .insert(schema.programWeeks)
        .values({
          programId: program.id,
          weekNumber: week.weekNumber,
        })
        .onConflictDoNothing();

      const scheduledRows = week.scheduledWorkouts.map((scheduled) => ({
        id: scheduled.id,
        programId: program.id,
        weekNumber: week.weekNumber,
        workoutId: scheduled.workoutId,
        orderInWeek: scheduled.order,
      }));

      if (scheduledRows.length > 0) {
        await tx.insert(schema.scheduledWorkouts).values(scheduledRows).onConflictDoNothing();
      }
    }
  }
}
