import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout, type Workout, type WorkoutExercise } from '@/domain/entities/workout';
import type { Difficulty } from '@/domain/types/exercise';
import type { ProgramGoal } from '@/domain/types/program';
import type { ExerciseId, ScheduledWorkoutId, WorkoutId } from '@/domain/types/ids';
import { createScheduledWorkoutId } from '@/domain/types/ids';

import { prescriptionToDomain } from './prescription-mapper';
import type {
  programWeeks,
  scheduledWorkouts,
  trainingPrograms,
  workoutExercises,
  workouts,
} from '../schema/programs';

type ProgramRow = typeof trainingPrograms.$inferSelect;
type WorkoutRow = typeof workouts.$inferSelect;
type WorkoutExerciseRow = typeof workoutExercises.$inferSelect;
type ProgramWeekRow = typeof programWeeks.$inferSelect;
type ScheduledWorkoutRow = typeof scheduledWorkouts.$inferSelect;

export function mapProgramToDomain(
  programRow: ProgramRow,
  workoutRows: ReadonlyArray<WorkoutRow>,
  exerciseRows: ReadonlyArray<WorkoutExerciseRow>,
  weekRows: ReadonlyArray<ProgramWeekRow>,
  scheduledRows: ReadonlyArray<ScheduledWorkoutRow>,
): TrainingProgram {
  const mappedWorkouts = workoutRows
    .filter((row) => row.programId === programRow.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((row) => mapWorkout(row, exerciseRows));

  const mappedWeeks = weekRows
    .filter((row) => row.programId === programRow.id)
    .sort((a, b) => a.weekNumber - b.weekNumber)
    .map((week) => {
      const weekScheduled = scheduledRows
        .filter((row) => row.programId === programRow.id && row.weekNumber === week.weekNumber)
        .sort((a, b) => a.orderInWeek - b.orderInWeek)
        .map((row) => ({
          id: createScheduledWorkoutIdOrThrow(row.id),
          workoutId: row.workoutId as WorkoutId,
          order: row.orderInWeek,
        }));

      return {
        weekNumber: week.weekNumber,
        scheduledWorkouts: weekScheduled,
      };
    });

  const result = createTrainingProgram({
    id: programRow.id,
    name: programRow.name,
    slug: programRow.slug,
    description: programRow.description,
    difficulty: programRow.difficulty as Difficulty,
    goal: programRow.goal as ProgramGoal,
    durationWeeks: programRow.durationWeeks,
    workoutsPerWeek: programRow.workoutsPerWeek,
    workouts: mappedWorkouts,
    weeks: mappedWeeks,
  });

  if (!result.ok) {
    throw new Error(`Corrupt program ${programRow.id}: ${result.error.message}`);
  }

  return result.data;
}

function mapWorkout(row: WorkoutRow, exerciseRows: ReadonlyArray<WorkoutExerciseRow>): Workout {
  const exercises: ReadonlyArray<WorkoutExercise> = exerciseRows
    .filter((exercise) => exercise.workoutId === row.id)
    .sort((a, b) => a.exerciseOrder - b.exerciseOrder)
    .map((exercise) => ({
      exerciseId: exercise.exerciseId as ExerciseId,
      order: exercise.exerciseOrder,
      prescription: prescriptionToDomain({
        prescriptionType: exercise.prescriptionType as 'reps' | 'duration',
        sets: exercise.sets,
        minReps: exercise.minReps,
        maxReps: exercise.maxReps,
        durationSeconds: exercise.durationSeconds,
      }),
      restSeconds: exercise.restSeconds,
      notes: exercise.notes ?? null,
    }));

  const result = createWorkout({
    id: row.id,
    name: row.name,
    slug: row.slug,
    description: row.description,
    estimatedDurationMinutes: row.estimatedDurationMinutes,
    exercises,
  });

  if (!result.ok) {
    throw new Error(`Corrupt workout ${row.id}: ${result.error.message}`);
  }

  return result.data;
}

function createScheduledWorkoutIdOrThrow(value: string): ScheduledWorkoutId {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) {
    throw new Error(`Invalid scheduled workout id stored in database: ${value}`);
  }

  return result.data;
}
