import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { ProgramRepository } from '@/application/ports/program-repository';
import { GetScheduledWorkoutUseCase } from '@/application/use-cases/get-scheduled-workout';
import { createExercise } from '@/domain/entities/exercise';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import { createExerciseId, createScheduledWorkoutId } from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function validRepScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeExercise(id: string, name: string, slug: string) {
  const result = createExercise({
    id,
    name,
    slug,
    description: `The ${name} exercise.`,
    primaryMuscle: MuscleGroup.Chest,
    secondaryMuscles: [],
    equipment: EquipmentType.Dumbbell,
    difficulty: Difficulty.Beginner,
    movementPattern: MovementPattern.PushHorizontal,
    considerations: [],
  });

  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeWorkout(id: string, exerciseIds: ReadonlyArray<string>) {
  const result = createWorkout({
    id,
    name: `Workout ${id}`,
    slug: `workout-${id}`,
    description: 'A test workout.',
    estimatedDurationMinutes: 30,
    exercises: exerciseIds.map((exerciseId, index) => ({
      exerciseId: validExerciseIdFromString(exerciseId),
      order: index + 1,
      prescription: validRepScheme(),
      restSeconds: 60,
    })),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function validExerciseIdFromString(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeProgram() {
  const squat = makeWorkout('wo-squat', ['ex-squat']);
  const press = makeWorkout('wo-press', ['ex-press']);
  const idSquat1 = createScheduledWorkoutId('sched-squat-1');
  const idPress1 = createScheduledWorkoutId('sched-press-1');
  if (!idSquat1.ok || !idPress1.ok) throw new Error('Invalid id');

  const result = createTrainingProgram({
    id: 'prog-test',
    name: 'Test Program',
    slug: 'test-program',
    description: 'A test program.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: 1,
    workoutsPerWeek: 2,
    workouts: [squat, press],
    weeks: [
      {
        weekNumber: 1,
        scheduledWorkouts: [
          { id: idSquat1.data, workoutId: squat.id, order: 1 },
          { id: idPress1.data, workoutId: press.id, order: 2 },
        ],
      },
    ],
  });

  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function createMockProgramRepository(): ProgramRepository {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
  };
}

function createMockExerciseRepository(): ExerciseRepository {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
  };
}

describe('GetScheduledWorkoutUseCase', () => {
  it('returns an enriched workout detail when found', async () => {
    const programRepo = createMockProgramRepository();
    const exerciseRepo = createMockExerciseRepository();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    vi.mocked(exerciseRepo.list).mockResolvedValue([
      makeExercise('ex-squat', 'Squat', 'squat'),
      makeExercise('ex-press', 'Press', 'press'),
    ]);

    const useCase = new GetScheduledWorkoutUseCase(programRepo, exerciseRepo);
    const result = await useCase.execute({
      programSlug: 'test-program',
      weekNumber: 1,
      workoutOrder: 2,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.workout.name).toBe('Workout wo-press');
    expect(result.data.weekNumber).toBe(1);
    expect(result.data.order).toBe(2);
    expect(result.data.workout.exercises[0]?.exerciseName).toBe('Press');
  });

  it('returns PROGRAM_NOT_FOUND when the program does not exist', async () => {
    const programRepo = createMockProgramRepository();
    const exerciseRepo = createMockExerciseRepository();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(null);

    const useCase = new GetScheduledWorkoutUseCase(programRepo, exerciseRepo);
    const result = await useCase.execute({
      programSlug: 'missing',
      weekNumber: 1,
      workoutOrder: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
  });

  it('returns SCHEDULED_WORKOUT_NOT_FOUND for an invalid week', async () => {
    const programRepo = createMockProgramRepository();
    const exerciseRepo = createMockExerciseRepository();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());

    const useCase = new GetScheduledWorkoutUseCase(programRepo, exerciseRepo);
    const result = await useCase.execute({
      programSlug: 'test-program',
      weekNumber: 99,
      workoutOrder: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('SCHEDULED_WORKOUT_NOT_FOUND');
  });

  it('returns EXERCISE_NOT_FOUND when an exercise reference cannot be resolved', async () => {
    const programRepo = createMockProgramRepository();
    const exerciseRepo = createMockExerciseRepository();
    vi.mocked(programRepo.findBySlug).mockResolvedValue(makeProgram());
    vi.mocked(exerciseRepo.list).mockResolvedValue([]);

    const useCase = new GetScheduledWorkoutUseCase(programRepo, exerciseRepo);
    const result = await useCase.execute({
      programSlug: 'test-program',
      weekNumber: 1,
      workoutOrder: 1,
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
  });
});