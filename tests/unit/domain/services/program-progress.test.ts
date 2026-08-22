import { describe, expect, it } from 'vitest';

import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import {
  createExerciseId,
  createScheduledWorkoutId,
  type ScheduledWorkoutId,
} from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import {
  calculateProgramProgress,
  getNextWorkout,
  listScheduledWorkoutsInOrder,
} from '@/domain/services/program-progress';
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

function makeWorkout(id: string) {
  const result = createWorkout({
    id,
    name: `Workout ${id}`,
    slug: `workout-${id}`,
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

function scheduledIds(ids: ReadonlyArray<string>): ReadonlyArray<ScheduledWorkoutId> {
  return ids.map((id) => {
    const result = createScheduledWorkoutId(id);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
}

function makeTwoWeekProgram(): TrainingProgram {
  const workoutA = makeWorkout('wo-a');
  const workoutB = makeWorkout('wo-b');
  const idA1 = createScheduledWorkoutId('sched-a1');
  const idA2 = createScheduledWorkoutId('sched-a2');
  const idB1 = createScheduledWorkoutId('sched-b1');
  const idB2 = createScheduledWorkoutId('sched-b2');

  if (!idA1.ok || !idA2.ok || !idB1.ok || !idB2.ok) {
    throw new Error('Invalid scheduled workout id');
  }

  const result = createTrainingProgram({
    id: 'prog-test',
    name: 'Test Program',
    slug: 'test-program',
    description: 'A test program.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: 2,
    workoutsPerWeek: 2,
    workouts: [workoutA, workoutB],
    weeks: [
      {
        weekNumber: 1,
        scheduledWorkouts: [
          { id: idA1.data, workoutId: workoutA.id, order: 1 },
          { id: idB1.data, workoutId: workoutB.id, order: 2 },
        ],
      },
      {
        weekNumber: 2,
        scheduledWorkouts: [
          { id: idA2.data, workoutId: workoutA.id, order: 1 },
          { id: idB2.data, workoutId: workoutB.id, order: 2 },
        ],
      },
    ],
  });

  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('listScheduledWorkoutsInOrder', () => {
  it('returns scheduled workouts in week then order sequence', () => {
    const program = makeTwoWeekProgram();

    const ordered = listScheduledWorkoutsInOrder(program);

    expect(ordered).toHaveLength(4);
    expect(ordered[0]?.id).toBe('sched-a1');
    expect(ordered[1]?.id).toBe('sched-b1');
    expect(ordered[2]?.id).toBe('sched-a2');
    expect(ordered[3]?.id).toBe('sched-b2');
  });
});

describe('calculateProgramProgress', () => {
  it('reports 0% when no workouts are completed', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, []);

    expect(progress.totalWorkouts).toBe(4);
    expect(progress.completedWorkouts).toBe(0);
    expect(progress.remainingWorkouts).toBe(4);
    expect(progress.percentage).toBe(0);
    expect(progress.unrecognizedIds).toHaveLength(0);
  });

  it('reports partial progress', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, scheduledIds(['sched-a1']));

    expect(progress.totalWorkouts).toBe(4);
    expect(progress.completedWorkouts).toBe(1);
    expect(progress.remainingWorkouts).toBe(3);
    expect(progress.percentage).toBe(25);
  });

  it('reports 100% when all workouts are completed', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, scheduledIds([
      'sched-a1',
      'sched-b1',
      'sched-a2',
      'sched-b2',
    ]));

    expect(progress.totalWorkouts).toBe(4);
    expect(progress.completedWorkouts).toBe(4);
    expect(progress.remainingWorkouts).toBe(0);
    expect(progress.percentage).toBe(100);
  });

  it('counts duplicate completion ids only once', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, scheduledIds([
      'sched-a1',
      'sched-a1',
      'sched-a1',
    ]));

    expect(progress.completedWorkouts).toBe(1);
    expect(progress.percentage).toBe(25);
  });

  it('surfaces unrecognized completion ids and ignores them in the count', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, scheduledIds([
      'sched-a1',
      'unknown-id',
    ]));

    expect(progress.completedWorkouts).toBe(1);
    expect(progress.unrecognizedIds).toEqual(['unknown-id']);
  });
});

describe('getNextWorkout', () => {
  it('returns the first workout when nothing is completed', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, []);

    expect(next?.id).toBe('sched-a1');
  });

  it('returns the first uncompleted workout in program order', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, scheduledIds(['sched-a1']));

    expect(next?.id).toBe('sched-b1');
  });

  it('handles out-of-order completion input', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, scheduledIds(['sched-b1']));

    expect(next?.id).toBe('sched-a1');
  });

  it('returns null when all workouts are completed', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, scheduledIds([
      'sched-a1',
      'sched-b1',
      'sched-a2',
      'sched-b2',
    ]));

    expect(next).toBeNull();
  });

  it('ignores unknown completion ids', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, scheduledIds(['unknown-id']));

    expect(next?.id).toBe('sched-a1');
  });
});