/**
 * Data transfer objects for training program data crossing layer boundaries.
 *
 * DTOs are plain, serializable shapes. Branded IDs are stripped to plain strings.
 */

import type { Difficulty, EquipmentType } from '@/domain/types/exercise';
import type { ProgramGoal } from '@/domain/types/program';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

/**
 * Program data shown in the catalog list view.
 */
export interface ProgramSummaryDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly difficulty: Difficulty;
  readonly goal: ProgramGoal;
  readonly durationWeeks: number;
  readonly workoutsPerWeek: number;
}

/**
 * A single scheduled workout occurrence inside a week, for the program detail view.
 */
export interface ProgramScheduledWorkoutDto {
  readonly scheduledWorkoutId: string;
  readonly workoutId: string;
  readonly workoutName: string;
  readonly workoutSlug: string;
  readonly order: number;
  readonly estimatedDurationMinutes: number;
}

/**
 * A single week in the program detail view.
 */
export interface ProgramWeekDto {
  readonly weekNumber: number;
  readonly scheduledWorkouts: ReadonlyArray<ProgramScheduledWorkoutDto>;
}

/**
 * Program data shown in the detail view.
 */
export interface ProgramDetailDto {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly difficulty: Difficulty;
  readonly goal: ProgramGoal;
  readonly durationWeeks: number;
  readonly workoutsPerWeek: number;
  readonly weeks: ReadonlyArray<ProgramWeekDto>;
}

/**
 * A single exercise inside a scheduled workout detail view.
 */
export interface ScheduledWorkoutExerciseDto {
  readonly order: number;
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly exerciseSlug: string;
  /** Catalog equipment of the exercise (e.g. dumbbell, bodyweight). */
  readonly equipment: EquipmentType;
  readonly prescription: RepPrescription;
  readonly restSeconds: number;
  readonly notes: string | null;
}

/**
 * Workout data inside the scheduled workout detail view.
 */
export interface ScheduledWorkoutDetailDto {
  readonly programSlug: string;
  readonly programName: string;
  readonly weekNumber: number;
  readonly order: number;
  readonly workout: {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
    readonly description: string;
    readonly estimatedDurationMinutes: number;
    readonly exercises: ReadonlyArray<ScheduledWorkoutExerciseDto>;
  };
}