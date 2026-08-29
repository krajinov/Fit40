import { describe, expect, it, vi } from 'vitest';

import type { ProgramRepository } from '@/application/ports/program-repository';
import { GetProgramBySlugUseCase } from '@/application/use-cases/get-program-by-slug';
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

function makeProgram(slug: string) {
  const workout = makeWorkout('wo-1');
  const scheduledId = createScheduledWorkoutId('sched-1');
  if (!scheduledId.ok) throw new Error(scheduledId.error.message);

  const result = createTrainingProgram({
    id: 'prog-test',
    name: 'Test Program',
    slug,
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
  });

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

function createMockRepository(): ProgramRepository {
  return {
    list: vi.fn(),
    findBySlug: vi.fn(),
    findSessionRouteByScheduledWorkoutId: vi.fn(),
    listMetadataByIds: vi.fn(),
  };
}

describe('GetProgramBySlugUseCase', () => {
  it('returns a detail DTO with schedule when found', async () => {
    const repo = createMockRepository();
    const program = makeProgram('test-program');
    vi.mocked(repo.findBySlug).mockResolvedValue(program);

    const useCase = new GetProgramBySlugUseCase(repo);
    const result = await useCase.execute('test-program');

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.detail.name).toBe('Test Program');
    expect(result.data.detail.weeks).toHaveLength(1);
    expect(result.data.detail.weeks[0]?.scheduledWorkouts[0]?.workoutName).toBe('Workout wo-1');
    // The loaded aggregate is returned alongside the DTO so one request can
    // reuse the hydration (page + enrollment view) without a second lookup.
    expect(result.data.program).toBe(program);
  });

  it('returns PROGRAM_NOT_FOUND when the program does not exist', async () => {
    const repo = createMockRepository();
    vi.mocked(repo.findBySlug).mockResolvedValue(null);

    const useCase = new GetProgramBySlugUseCase(repo);
    const result = await useCase.execute('missing');

    expect(result.ok).toBe(false);
    if (result.ok) return;

    expect(result.error.code).toBe('PROGRAM_NOT_FOUND');
    expect(result.error.slug).toBe('missing');
  });
});