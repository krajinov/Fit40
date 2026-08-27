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
import { prescriptionFromColumns } from './prescription-mapper';

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
 * Reconstructs the `Workout` templates of a program from their rows, grouping
 * `workout_exercises` by workout and ordering them by `exercise_order`.
 */
function mapWorkouts(
  workoutRows: ReadonlyArray<WorkoutRow>,
  workoutExerciseRows: ReadonlyArray<WorkoutExerciseRow>,
): Workout[] {
  const exercisesByWorkout = new Map<string, WorkoutExerciseRow[]>();
  for (const row of workoutExerciseRows) {
    const list = exercisesByWorkout.get(row.workoutId) ?? [];
    list.push(row);
    exercisesByWorkout.set(row.workoutId, list);
  }

  return workoutRows.map((row) => {
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
}

/**
 * Reconstructs the `ProgramWeek` schedule from its rows, ordering weeks by
 * `week_number` and scheduled workouts by `order_in_week`.
 */
function mapWeeks(
  weekRows: ReadonlyArray<ProgramWeekRow>,
  scheduledWorkoutRows: ReadonlyArray<ScheduledWorkoutRow>,
): ProgramWeek[] {
  const scheduledByWeek = new Map<number, ScheduledWorkoutRow[]>();
  for (const row of scheduledWorkoutRows) {
    const list = scheduledByWeek.get(row.weekNumber) ?? [];
    list.push(row);
    scheduledByWeek.set(row.weekNumber, list);
  }

  return weekRows
    .slice()
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((weekRow) => ({
      weekNumber: weekRow.weekNumber,
      scheduledWorkouts: (scheduledByWeek.get(weekRow.weekNumber) ?? [])
        .slice()
        .sort((a, b) => a.orderInWeek - b.orderInWeek)
        .map(mapScheduledWorkout),
    }));
}

/**
 * Reconstructs a `TrainingProgram` aggregate from its persisted rows.
 *
 * Child rows are grouped and sorted by their position columns so the domain
 * factory's sequential-order invariants are evaluated against ordered data.
 */
export function mapProgramRows(rows: ProgramRows): TrainingProgram {
  const result = createTrainingProgram({
    id: rows.program.id,
    name: rows.program.name,
    slug: rows.program.slug,
    description: rows.program.description,
    difficulty: parseDifficulty(rows.program.difficulty),
    goal: parseGoal(rows.program.goal),
    durationWeeks: rows.program.durationWeeks,
    workoutsPerWeek: rows.program.workoutsPerWeek,
    workouts: mapWorkouts(rows.workouts, rows.workoutExercises),
    weeks: mapWeeks(rows.weeks, rows.scheduledWorkouts),
  });

  if (!result.ok) {
    throw new Error(`Corrupt program row "${rows.program.id}": ${result.error.message}`);
  }

  return result.data;
}
