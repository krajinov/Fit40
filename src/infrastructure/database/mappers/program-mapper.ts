import {
  createTrainingProgram,
  type ProgramWeek,
  type ScheduledWorkout,
  type TrainingProgram,
} from '@/domain/entities/training-program';
import { createWorkout, type Workout, type WorkoutExercise } from '@/domain/entities/workout';
import { DIFFICULTY_VALUES, type Difficulty } from '@/domain/types/exercise';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createWorkoutId,
  type ExerciseId,
  type ScheduledWorkoutId,
  type WorkoutId,
} from '@/domain/types/ids';
import { PROGRAM_GOAL_VALUES, type ProgramGoal } from '@/domain/types/program';

import type {
  programWeeks,
  scheduledWorkouts,
  trainingPrograms,
  workoutExercises,
  workouts,
} from '../schema/programs';
import { prescriptionFromColumns, prescriptionToColumns } from './prescription-mapper';

type ProgramRow = typeof trainingPrograms.$inferSelect;
type WorkoutRow = typeof workouts.$inferSelect;
type WorkoutExerciseRow = typeof workoutExercises.$inferSelect;
type ProgramWeekRow = typeof programWeeks.$inferSelect;
type ScheduledWorkoutRow = typeof scheduledWorkouts.$inferSelect;

const DIFFICULTIES = new Set<string>(DIFFICULTY_VALUES);
const GOALS = new Set<string>(PROGRAM_GOAL_VALUES);

function parseDifficulty(value: string): Difficulty {
  if (!DIFFICULTIES.has(value)) {
    throw new Error(`Corrupt program data: unknown difficulty "${value}"`);
  }
  return value as Difficulty;
}

function parseGoal(value: string): ProgramGoal {
  if (!GOALS.has(value)) {
    throw new Error(`Corrupt program data: unknown goal "${value}"`);
  }
  return value as ProgramGoal;
}

function parseExerciseId(value: string, context: string): ExerciseId {
  const result = createExerciseId(value);
  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }
  return result.data;
}

function parseScheduledWorkoutId(value: string, context: string): ScheduledWorkoutId {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }
  return result.data;
}

function parseWorkoutId(value: string, context: string): WorkoutId {
  const result = createWorkoutId(value);
  if (!result.ok) {
    throw new Error(`Corrupt data in ${context}: ${result.error.message}`);
  }
  return result.data;
}

function mapWorkoutExercise(row: WorkoutExerciseRow): WorkoutExercise {
  const context = `workout_exercises (workout_id=${row.workoutId}, exercise_order=${row.exerciseOrder})`;
  return {
    exerciseId: parseExerciseId(row.exerciseId, context),
    order: row.exerciseOrder,
    prescription: prescriptionFromColumns(row, context),
    restSeconds: row.restSeconds,
    notes: row.notes,
  };
}

function mapScheduledWorkout(row: ScheduledWorkoutRow): ScheduledWorkout {
  return {
    id: parseScheduledWorkoutId(row.id, `scheduled_workouts (id=${row.id})`),
    workoutId: parseWorkoutId(row.workoutId, `scheduled_workouts (id=${row.id})`),
    order: row.orderInWeek,
  };
}

export interface ProgramRows {
  readonly program: ProgramRow;
  readonly workouts: ReadonlyArray<WorkoutRow>;
  readonly workoutExercises: ReadonlyArray<WorkoutExerciseRow>;
  readonly weeks: ReadonlyArray<ProgramWeekRow>;
  readonly scheduledWorkouts: ReadonlyArray<ScheduledWorkoutRow>;
}

/**
 * Reconstructs a `TrainingProgram` aggregate from its persisted rows.
 *
 * Child rows are grouped and sorted by their position columns so the domain
 * factory's sequential-order invariants are evaluated against ordered data.
 */
export function mapProgramRows(rows: ProgramRows): TrainingProgram {
  const exercisesByWorkout = new Map<string, WorkoutExerciseRow[]>();
  for (const row of rows.workoutExercises) {
    const list = exercisesByWorkout.get(row.workoutId) ?? [];
    list.push(row);
    exercisesByWorkout.set(row.workoutId, list);
  }

  const workoutObjects: Workout[] = rows.workouts.map((row) => {
    const exerciseRows = (exercisesByWorkout.get(row.id) ?? [])
      .slice()
      .sort((a, b) => a.exerciseOrder - b.exerciseOrder)
      .map(mapWorkoutExercise);

    const result = createWorkout({
      id: row.id,
      name: row.name,
      slug: row.slug,
      description: row.description,
      estimatedDurationMinutes: row.estimatedDurationMinutes,
      exercises: exerciseRows,
    });

    if (!result.ok) {
      throw new Error(`Corrupt workout row "${row.id}": ${result.error.message}`);
    }

    return result.data;
  });

  const scheduledByWeek = new Map<number, ScheduledWorkoutRow[]>();
  for (const row of rows.scheduledWorkouts) {
    const list = scheduledByWeek.get(row.weekNumber) ?? [];
    list.push(row);
    scheduledByWeek.set(row.weekNumber, list);
  }

  const weekObjects: ProgramWeek[] = rows.weeks
    .slice()
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((weekRow) => ({
      weekNumber: weekRow.weekNumber,
      scheduledWorkouts: (scheduledByWeek.get(weekRow.weekNumber) ?? [])
        .slice()
        .sort((a, b) => a.orderInWeek - b.orderInWeek)
        .map(mapScheduledWorkout),
    }));

  const result = createTrainingProgram({
    id: rows.program.id,
    name: rows.program.name,
    slug: rows.program.slug,
    description: rows.program.description,
    difficulty: parseDifficulty(rows.program.difficulty),
    goal: parseGoal(rows.program.goal),
    durationWeeks: rows.program.durationWeeks,
    workoutsPerWeek: rows.program.workoutsPerWeek,
    workouts: workoutObjects,
    weeks: weekObjects,
  });

  if (!result.ok) {
    throw new Error(`Corrupt program row "${rows.program.id}": ${result.error.message}`);
  }

  return result.data;
}

export interface ProgramRowsForInsert {
  readonly program: typeof trainingPrograms.$inferInsert;
  readonly workouts: ReadonlyArray<typeof workouts.$inferInsert>;
  readonly workoutExercises: ReadonlyArray<typeof workoutExercises.$inferInsert>;
  readonly weeks: ReadonlyArray<typeof programWeeks.$inferInsert>;
  readonly scheduledWorkouts: ReadonlyArray<typeof scheduledWorkouts.$inferInsert>;
}

/**
 * Flattens a `TrainingProgram` aggregate into the persistable rows for its five
 * tables, in FK-safe insertion order (program → workouts → workout_exercises →
 * weeks → scheduled_workouts).
 */
export function mapProgramToRows(program: TrainingProgram): ProgramRowsForInsert {
  const workoutRows = program.workouts.map((workout) => ({
    id: workout.id,
    programId: program.id,
    name: workout.name,
    slug: workout.slug,
    description: workout.description,
    estimatedDurationMinutes: workout.estimatedDurationMinutes,
  }));

  const workoutExerciseRows = program.workouts.flatMap((workout) =>
    workout.exercises.map((exercise) => ({
      workoutId: workout.id,
      exerciseOrder: exercise.order,
      exerciseId: exercise.exerciseId,
      ...prescriptionToColumns(exercise.prescription),
      restSeconds: exercise.restSeconds,
      notes: exercise.notes,
    })),
  );

  const weekRows = program.weeks.map((week) => ({
    programId: program.id,
    weekNumber: week.weekNumber,
  }));

  const scheduledWorkoutRows = program.weeks.flatMap((week) =>
    week.scheduledWorkouts.map((scheduled) => ({
      id: scheduled.id,
      programId: program.id,
      weekNumber: week.weekNumber,
      workoutId: scheduled.workoutId,
      orderInWeek: scheduled.order,
    })),
  );

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
    workouts: workoutRows,
    workoutExercises: workoutExerciseRows,
    weeks: weekRows,
    scheduledWorkouts: scheduledWorkoutRows,
  };
}
