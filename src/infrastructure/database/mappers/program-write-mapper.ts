import type { TrainingProgram } from '@/domain/entities/training-program';

import type {
  programWeeks,
  scheduledWorkouts,
  trainingPrograms,
  workoutExercises,
  workouts,
} from '../schema/programs';
import { prescriptionToColumns } from './prescription-mapper';

export interface ProgramRowsForInsert {
  readonly program: typeof trainingPrograms.$inferInsert;
  readonly workouts: ReadonlyArray<typeof workouts.$inferInsert>;
  readonly workoutExercises: ReadonlyArray<typeof workoutExercises.$inferInsert>;
  readonly weeks: ReadonlyArray<typeof programWeeks.$inferInsert>;
  readonly scheduledWorkouts: ReadonlyArray<typeof scheduledWorkouts.$inferInsert>;
}

function mapWorkoutRows(program: TrainingProgram): Array<typeof workouts.$inferInsert> {
  return program.workouts.map((workout) => ({
    id: workout.id,
    programId: program.id,
    name: workout.name,
    slug: workout.slug,
    description: workout.description,
    estimatedDurationMinutes: workout.estimatedDurationMinutes,
  }));
}

function mapWorkoutExerciseRows(
  program: TrainingProgram,
): Array<typeof workoutExercises.$inferInsert> {
  return program.workouts.flatMap((workout) =>
    workout.exercises.map((exercise) => ({
      workoutId: workout.id,
      exerciseOrder: exercise.order,
      exerciseId: exercise.exerciseId,
      ...prescriptionToColumns(exercise.prescription),
      restSeconds: exercise.restSeconds,
      notes: exercise.notes,
    })),
  );
}

function mapWeekRows(program: TrainingProgram): Array<typeof programWeeks.$inferInsert> {
  return program.weeks.map((week) => ({
    programId: program.id,
    weekNumber: week.weekNumber,
  }));
}

function mapScheduledWorkoutRows(
  program: TrainingProgram,
): Array<typeof scheduledWorkouts.$inferInsert> {
  return program.weeks.flatMap((week) =>
    week.scheduledWorkouts.map((scheduled) => ({
      id: scheduled.id,
      programId: program.id,
      weekNumber: week.weekNumber,
      workoutId: scheduled.workoutId,
      orderInWeek: scheduled.order,
    })),
  );
}

/**
 * Flattens a `TrainingProgram` aggregate into the persistable rows for its five
 * tables, in FK-safe insertion order (program → workouts → workout_exercises →
 * weeks → scheduled_workouts).
 */
export function mapProgramToRows(program: TrainingProgram): ProgramRowsForInsert {
  return {
    program: {
      id: program.id,
      slug: program.slug,
      name: program.name,
      description: program.description,
      difficulty: program.difficulty,
      goal: program.goal,
      durationWeeks: program.durationWeeks,
      workoutsPerWeek: program.workoutsPerWeek,
    },
    workouts: mapWorkoutRows(program),
    workoutExercises: mapWorkoutExerciseRows(program),
    weeks: mapWeekRows(program),
    scheduledWorkouts: mapScheduledWorkoutRows(program),
  };
}
