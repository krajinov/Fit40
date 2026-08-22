/**
 * TrainingProgram aggregate root and factory.
 *
 * A TrainingProgram owns its workout templates and the schedule of their
 * occurrences. It is the aggregate root; external code accesses scheduled
 * workouts and workout templates through it.
 */

import { err, ok, type Result } from '@/lib/result';

import type { Difficulty } from '@/domain/types/exercise';
import type { ProgramGoal } from '@/domain/types/program';
import { createProgramId, type ProgramId, type ScheduledWorkoutId, type WorkoutId } from '@/domain/types/ids';
import type { Workout } from '@/domain/entities/workout';

export interface ScheduledWorkout {
  readonly id: ScheduledWorkoutId;
  readonly workoutId: WorkoutId;
  readonly order: number;
}

export interface ProgramWeek {
  readonly weekNumber: number;
  readonly scheduledWorkouts: ReadonlyArray<ScheduledWorkout>;
}

export interface TrainingProgram {
  readonly id: ProgramId;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly difficulty: Difficulty;
  readonly goal: ProgramGoal;
  readonly durationWeeks: number;
  readonly workoutsPerWeek: number;
  readonly workouts: ReadonlyArray<Workout>;
  readonly weeks: ReadonlyArray<ProgramWeek>;
}

export interface CreateTrainingProgramInput {
  readonly id: string;
  readonly name: string;
  readonly slug: string;
  readonly description: string;
  readonly difficulty: Difficulty;
  readonly goal: ProgramGoal;
  readonly durationWeeks: number;
  readonly workoutsPerWeek: number;
  readonly workouts: ReadonlyArray<Workout>;
  readonly weeks: ReadonlyArray<ProgramWeek>;
}

export interface ProgramValidationError {
  readonly code: 'INVALID_PROGRAM';
  readonly message: string;
  readonly field?: string;
}

function programValidationError(message: string, field?: string): ProgramValidationError {
  return { code: 'INVALID_PROGRAM', message, field };
}

const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

export function createTrainingProgram(
  input: CreateTrainingProgramInput,
): Result<TrainingProgram, ProgramValidationError> {
  const name = input.name.trim();
  const slug = input.slug.trim();
  const description = input.description.trim();

  if (input.id.trim().length === 0) {
    return err(programValidationError('id is required', 'id'));
  }

  if (name.length === 0) {
    return err(programValidationError('name is required', 'name'));
  }

  if (slug.length === 0) {
    return err(programValidationError('slug is required', 'slug'));
  }

  if (!SLUG_PATTERN.test(slug)) {
    return err(
      programValidationError(
        'slug must be kebab-case and contain only lowercase letters, numbers, and hyphens',
        'slug',
      ),
    );
  }

  if (description.length === 0) {
    return err(programValidationError('description is required', 'description'));
  }

  if (!Number.isInteger(input.durationWeeks) || input.durationWeeks < 1) {
    return err(programValidationError('durationWeeks must be a positive integer', 'durationWeeks'));
  }

  if (!Number.isInteger(input.workoutsPerWeek) || input.workoutsPerWeek < 1) {
    return err(
      programValidationError('workoutsPerWeek must be a positive integer', 'workoutsPerWeek'),
    );
  }

  if (input.workouts.length === 0) {
    return err(programValidationError('program must contain at least one workout template', 'workouts'));
  }

  const workoutIds = input.workouts.map((workout) => workout.id);
  const uniqueWorkoutIds = new Set(workoutIds);
  if (uniqueWorkoutIds.size !== workoutIds.length) {
    return err(programValidationError('workout template ids must be unique', 'workouts'));
  }

  if (input.weeks.length === 0) {
    return err(programValidationError('program must contain at least one week', 'weeks'));
  }

  if (input.durationWeeks !== input.weeks.length) {
    return err(
      programValidationError(
        'durationWeeks must match the number of weeks',
        'durationWeeks',
      ),
    );
  }

  const expectedWeekNumbers = Array.from({ length: input.weeks.length }, (_, index) => index + 1);
  const actualWeekNumbers = input.weeks.map((week) => week.weekNumber);
  const weeksInOrder = expectedWeekNumbers.every(
    (value, index) => value === actualWeekNumbers[index],
  );

  if (!weeksInOrder) {
    return err(
      programValidationError(
        'week numbers must be sequential starting at 1 and match array order',
        'weeks',
      ),
    );
  }

  const scheduledIds = new Set<string>();
  const validWorkoutIdSet = new Set<string>(workoutIds);

  for (const week of input.weeks) {
    if (!Number.isInteger(week.weekNumber) || week.weekNumber < 1) {
      return err(programValidationError('weekNumber must be a positive integer', 'weeks'));
    }

    if (week.scheduledWorkouts.length !== input.workoutsPerWeek) {
      return err(
        programValidationError(
          `week ${week.weekNumber} must contain exactly ${input.workoutsPerWeek} scheduled workouts`,
          'weeks',
        ),
      );
    }

    const expectedOrders = Array.from(
      { length: week.scheduledWorkouts.length },
      (_, index) => index + 1,
    );
    const actualOrders = week.scheduledWorkouts.map((scheduled) => scheduled.order).sort((a, b) => a - b);
    const ordersValid = expectedOrders.every((value, index) => value === actualOrders[index]);

    if (!ordersValid) {
      return err(
        programValidationError(
          `scheduled workout orders in week ${week.weekNumber} must be unique and sequential starting at 1`,
          'weeks',
        ),
      );
    }

    for (const scheduled of week.scheduledWorkouts) {
      if (!validWorkoutIdSet.has(scheduled.workoutId)) {
        return err(
          programValidationError(
            `scheduled workout ${scheduled.id} references unknown workout template ${scheduled.workoutId}`,
            'weeks',
          ),
        );
      }

      if (scheduledIds.has(scheduled.id)) {
        return err(
          programValidationError(
            `scheduled workout id ${scheduled.id} is duplicated`,
            'weeks',
          ),
        );
      }

      scheduledIds.add(scheduled.id);
    }
  }

  const idResult = createProgramId(input.id);
  if (!idResult.ok) {
    return err(programValidationError(idResult.error.message, 'id'));
  }

  return ok({
    id: idResult.data,
    name,
    slug,
    description,
    difficulty: input.difficulty,
    goal: input.goal,
    durationWeeks: input.durationWeeks,
    workoutsPerWeek: input.workoutsPerWeek,
    workouts: input.workouts,
    weeks: input.weeks,
  });
}