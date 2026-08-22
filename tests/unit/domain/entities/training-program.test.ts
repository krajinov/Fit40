import { describe, expect, it } from 'vitest';

import {
  createTrainingProgram,
  type CreateTrainingProgramInput,
} from '@/domain/entities/training-program';
import { createWorkout, type Workout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import { createExerciseId, createScheduledWorkoutId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function validExerciseId() {
  const result = createExerciseId('ex-test');
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function validRepScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeWorkout(id: string, slug: string): Workout {
  const result = createWorkout({
    id,
    name: `Workout ${id}`,
    slug,
    description: 'A test workout.',
    estimatedDurationMinutes: 30,
    exercises: [
      {
        exerciseId: validExerciseId(),
        order: 1,
        prescription: validRepScheme(),
        restSeconds: 60,
      },
    ],
  });

  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeProgram(overrides: Partial<CreateTrainingProgramInput> = {}): ReturnType<typeof createTrainingProgram> {
  const workout = makeWorkout('wo-1', 'workout-1');
  const scheduledId = createScheduledWorkoutId('sched-1');
  if (!scheduledId.ok) throw new Error(scheduledId.error.message);

  const defaultInput = {
    id: 'prog-test',
    name: 'Test Program',
    slug: 'test-program',
    description: 'A test program.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: 1,
    workoutsPerWeek: 1,
    workouts: [workout],
    weeks: [
      {
        weekNumber: 1,
        scheduledWorkouts: [{ id: scheduledId.data, workoutId: workout.id, order: 1 }],
      },
    ],
  };

  return createTrainingProgram({ ...defaultInput, ...overrides });
}

describe('createTrainingProgram', () => {
  it('creates a valid program', () => {
    const result = makeProgram();

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.name).toBe('Test Program');
    expect(result.data.weeks).toHaveLength(1);
  });

  it('rejects empty weeks', () => {
    const result = makeProgram({ weeks: [] });

    expect(result.ok).toBe(false);
  });

  it('rejects when durationWeeks does not match weeks length', () => {
    const workout = makeWorkout('wo-1', 'workout-1');
    const scheduledId = createScheduledWorkoutId('sched-1');
    if (!scheduledId.ok) throw new Error(scheduledId.error.message);

    const result = makeProgram({
      durationWeeks: 2,
      weeks: [
        {
          weekNumber: 1,
          scheduledWorkouts: [{ id: scheduledId.data, workoutId: workout.id, order: 1 }],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects non-sequential week numbers', () => {
    const workout = makeWorkout('wo-1', 'workout-1');
    const scheduledId = createScheduledWorkoutId('sched-1');
    if (!scheduledId.ok) throw new Error(scheduledId.error.message);

    const result = makeProgram({
      durationWeeks: 1,
      weeks: [
        {
          weekNumber: 2,
          scheduledWorkouts: [{ id: scheduledId.data, workoutId: workout.id, order: 1 }],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects duplicate schedule positions within a week', () => {
    const workout = makeWorkout('wo-1', 'workout-1');
    const idA = createScheduledWorkoutId('sched-a');
    const idB = createScheduledWorkoutId('sched-b');
    if (!idA.ok || !idB.ok) throw new Error('Invalid id');

    const result = makeProgram({
      workoutsPerWeek: 2,
      weeks: [
        {
          weekNumber: 1,
          scheduledWorkouts: [
            { id: idA.data, workoutId: workout.id, order: 1 },
            { id: idB.data, workoutId: workout.id, order: 1 },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a scheduled workout referencing an unknown template', () => {
    const scheduledId = createScheduledWorkoutId('sched-1');
    if (!scheduledId.ok) throw new Error(scheduledId.error.message);

    const unknownWorkoutId = 'wo-unknown' as Workout['id'];

    const result = makeProgram({
      weeks: [
        {
          weekNumber: 1,
          scheduledWorkouts: [
            { id: scheduledId.data, workoutId: unknownWorkoutId, order: 1 },
          ],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects duplicate occurrence ids across the program', () => {
    const workout = makeWorkout('wo-1', 'workout-1');
    const duplicateId = createScheduledWorkoutId('sched-same');
    if (!duplicateId.ok) throw new Error(duplicateId.error.message);

    const result = makeProgram({
      durationWeeks: 2,
      workoutsPerWeek: 1,
      weeks: [
        { weekNumber: 1, scheduledWorkouts: [{ id: duplicateId.data, workoutId: workout.id, order: 1 }] },
        { weekNumber: 2, scheduledWorkouts: [{ id: duplicateId.data, workoutId: workout.id, order: 1 }] },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects a week whose workout count does not match workoutsPerWeek', () => {
    const workout = makeWorkout('wo-1', 'workout-1');
    const scheduledId = createScheduledWorkoutId('sched-1');
    if (!scheduledId.ok) throw new Error(scheduledId.error.message);

    const result = makeProgram({
      workoutsPerWeek: 2,
      weeks: [
        {
          weekNumber: 1,
          scheduledWorkouts: [{ id: scheduledId.data, workoutId: workout.id, order: 1 }],
        },
      ],
    });

    expect(result.ok).toBe(false);
  });
});