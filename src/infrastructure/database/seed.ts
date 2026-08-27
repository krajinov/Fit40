import { seedExercises } from '@/infrastructure/exercises/seed-exercises';
import { seedPrograms } from '@/infrastructure/programs/seed-programs';

import type { Database } from './client';
import { mapExerciseToRow } from './mappers/exercise-mapper';
import { mapProgramToRows } from './mappers/program-write-mapper';
import {
  exercises,
  programWeeks,
  scheduledWorkouts,
  trainingPrograms,
  workoutExercises,
  workouts,
} from './schema';

export interface SeedCount {
  readonly inserted: number;
  readonly skipped: number;
}

export interface SeedSummary {
  readonly exercises: SeedCount;
  readonly programs: SeedCount;
  readonly workouts: SeedCount;
  readonly workoutExercises: SeedCount;
  readonly weeks: SeedCount;
  readonly scheduledWorkouts: SeedCount;
}

/**
 * Seeds reference data (exercises + training programs) with insert-if-missing
 * semantics. Re-running is safe: existing rows are skipped via ON CONFLICT DO
 * NOTHING. This is intentionally not a synchronization — existing rows are
 * never updated.
 */
export async function seedDatabase(db: Database): Promise<SeedSummary> {
  return db.transaction(async (tx) => {
    const exerciseRows = seedExercises.map(mapExerciseToRow);
    const insertedExercises = await tx
      .insert(exercises)
      .values(exerciseRows)
      .onConflictDoNothing({ target: exercises.id })
      .returning({ id: exercises.id });

    const programRows = [];
    const workoutRows = [];
    const workoutExerciseRows = [];
    const weekRows = [];
    const scheduledWorkoutRows = [];

    for (const program of seedPrograms) {
      const rows = mapProgramToRows(program);
      programRows.push(rows.program);
      workoutRows.push(...rows.workouts);
      workoutExerciseRows.push(...rows.workoutExercises);
      weekRows.push(...rows.weeks);
      scheduledWorkoutRows.push(...rows.scheduledWorkouts);
    }

    const insertedPrograms = await tx
      .insert(trainingPrograms)
      .values(programRows)
      .onConflictDoNothing({ target: trainingPrograms.id })
      .returning({ id: trainingPrograms.id });

    const insertedWorkouts = await tx
      .insert(workouts)
      .values(workoutRows)
      .onConflictDoNothing({ target: workouts.id })
      .returning({ id: workouts.id });

    const insertedWorkoutExercises = await tx
      .insert(workoutExercises)
      .values(workoutExerciseRows)
      .onConflictDoNothing({ target: [workoutExercises.workoutId, workoutExercises.exerciseOrder] })
      .returning({ workoutId: workoutExercises.workoutId });

    const insertedWeeks = await tx
      .insert(programWeeks)
      .values(weekRows)
      .onConflictDoNothing({ target: [programWeeks.programId, programWeeks.weekNumber] })
      .returning({ programId: programWeeks.programId });

    const insertedScheduledWorkouts = await tx
      .insert(scheduledWorkouts)
      .values(scheduledWorkoutRows)
      .onConflictDoNothing({ target: scheduledWorkouts.id })
      .returning({ id: scheduledWorkouts.id });

    return {
      exercises: summary(exerciseRows.length, insertedExercises.length),
      programs: summary(programRows.length, insertedPrograms.length),
      workouts: summary(workoutRows.length, insertedWorkouts.length),
      workoutExercises: summary(workoutExerciseRows.length, insertedWorkoutExercises.length),
      weeks: summary(weekRows.length, insertedWeeks.length),
      scheduledWorkouts: summary(scheduledWorkoutRows.length, insertedScheduledWorkouts.length),
    };
  });
}

function summary(attempted: number, inserted: number): SeedCount {
  return { inserted, skipped: attempted - inserted };
}

const isDirectRun = process.argv[1]?.endsWith('seed.ts') ?? false;

if (isDirectRun) {
  void (async () => {
    // Load .env (if present) so `pnpm db:seed` works without exporting
    // DATABASE_URL in the shell. Existing shell variables take precedence.
    try {
      process.loadEnvFile('.env');
    } catch {
      // No .env file — rely on the caller's environment.
    }

    const { db } = await import('./client');
    const result = await seedDatabase(db);
    console.log('Seed complete (insert-if-missing):');
    console.log(JSON.stringify(result, null, 2));
  })().catch((error: unknown) => {
    console.error('Seed failed:', error);
    process.exitCode = 1;
  });
}
