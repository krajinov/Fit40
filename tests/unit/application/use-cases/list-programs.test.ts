import { describe, expect, it, vi } from 'vitest';

import type { ProgramRepository } from '@/application/ports/program-repository';
import { ListProgramsUseCase } from '@/application/use-cases/list-programs';
import { createTrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
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

function makeProgram(id: string, name: string, slug: string) {
  const workout = makeWorkout(`wo-${id}`);
  const scheduledId = createScheduledWorkoutId(`sched-${id}`);
  if (!scheduledId.ok) throw new Error(scheduledId.error.message);

  const result = createTrainingProgram({
    id: `prog-${id}`,
    name,
    slug,
    description: `The ${name} program.`,
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
  });

  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function createMockRepository(): ProgramRepository {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findSessionRouteByScheduledWorkoutId: vi.fn(),
  };
}

describe('ListProgramsUseCase', () => {
  it('returns summary DTOs for all programs', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.list).mockResolvedValue([
      makeProgram('a', 'Alpha', 'alpha'),
      makeProgram('b', 'Beta', 'beta'),
    ]);

    const useCase = new ListProgramsUseCase(repo);
    const result = await useCase.execute();

    expect(result).toHaveLength(2);
    expect(result[0]?.name).toBe('Alpha');
    expect(result[1]?.name).toBe('Beta');
    expect(result[0]?.slug).toBe('alpha');
  });

  it('returns an empty array when the repository is empty', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.list).mockResolvedValue([]);

    const useCase = new ListProgramsUseCase(repo);
    const result = await useCase.execute();

    expect(result).toHaveLength(0);
  });
});