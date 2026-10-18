import { describe, expect, it, vi } from 'vitest';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { CompletedExerciseOccurrence, TrainingHistoryRepository } from '@/application/ports/training-history-repository';
import { GetExerciseHistoryPresenceUseCase } from '@/application/use-cases/get-exercise-history-presence';
import { createExercise } from '@/domain/entities/exercise';
import { createWorkoutSessionId } from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function setup() {
  const exercise = createExercise({
    id: 'resolved-exercise', slug: 'goblet-squat', name: 'Goblet Squat',
    description: 'A squat.', primaryMuscle: 'quadriceps', secondaryMuscles: [],
    equipment: 'dumbbell', difficulty: 'beginner', movementPattern: 'squat', considerations: [],
  });
  if (!exercise.ok) throw new Error(exercise.error.message);
  const exercises = {
    findBySlug: vi.fn().mockResolvedValue(exercise.data), list: vi.fn(), findByIds: vi.fn(),
  } satisfies ExerciseRepository;
  const history = {
    listCompletedSessions: vi.fn(), listCompletedExerciseOccurrences: vi.fn().mockResolvedValue([]),
    listCompletedExerciseOccurrencesSince: vi.fn(), listRecentCompletedExercisePerformances: vi.fn(),
    listCompletedSessionActivity: vi.fn(), listProgressSessionActivity: vi.fn(),
    listCompletedSessionsSince: vi.fn(), getTotals: vi.fn(), findCompletedSessionById: vi.fn(),
  } satisfies TrainingHistoryRepository;
  return { exercises, history, useCase: new GetExerciseHistoryPresenceUseCase(history, exercises) };
}

function occurrence(): CompletedExerciseOccurrence {
  const id = createWorkoutSessionId('session-1');
  const prescription = createRepScheme(1, 8, 10);
  if (!id.ok || !prescription.ok) throw new Error('Invalid fixture');
  return {
    sessionId: id.data, exerciseOrder: 1, startedAt: new Date('2026-01-01T10:00Z'),
    completedAt: new Date('2026-01-01T11:00Z'), programName: 'Program', workoutName: 'Workout',
    prescription: prescription.data,
    sets: [{ type: 'reps', setNumber: 1, reps: 8, weightKg: null, rpe: null }],
  };
}

const input = { userId: 'owner', slug: 'goblet-squat' };

describe('GetExerciseHistoryPresenceUseCase', () => {
  it.each(['', '   '])('rejects invalid userId %j without touching either repository', async (userId) => {
    const { useCase, exercises, history } = setup();
    expect(await useCase.execute({ ...input, userId })).toMatchObject({
      ok: false, error: { code: 'INVALID_INPUT', field: 'userId' },
    });
    for (const method of [...Object.values(exercises), ...Object.values(history)]) {
      expect(method).not.toHaveBeenCalled();
    }
  });

  it('preserves EXERCISE_NOT_FOUND and skips history for unknown slugs', async () => {
    const { useCase, exercises, history } = setup();
    exercises.findBySlug.mockResolvedValue(null);
    expect(await useCase.execute(input)).toMatchObject({
      ok: false, error: { code: 'EXERCISE_NOT_FOUND', slug: input.slug },
    });
    expect(exercises.findBySlug).toHaveBeenCalledWith(input.slug);
    expect(history.listCompletedExerciseOccurrences).not.toHaveBeenCalled();
  });

  it('returns present for a completed occurrence and forwards the resolved id with limit exactly 1', async () => {
    const { useCase, history } = setup();
    history.listCompletedExerciseOccurrences.mockResolvedValue([occurrence()]);
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'present' } });
    expect(history.listCompletedExerciseOccurrences).toHaveBeenCalledExactlyOnceWith('owner', 'resolved-exercise', 1);
  });

  it('returns absent only after a successful empty read', async () => {
    expect(await setup().useCase.execute(input)).toEqual({ ok: true, data: { status: 'absent' } });
  });

  it('preserves a rejected history read as observable unavailable', async () => {
    const { useCase, history } = setup();
    const error = new Error('Database unavailable');
    history.listCompletedExerciseOccurrences.mockRejectedValue(error);
    expect(await useCase.execute(input)).toEqual({ ok: true, data: { status: 'unavailable', cause: error } });
  });

  it('does not mask a public exercise lookup failure', async () => {
    const { useCase, exercises } = setup();
    const error = new Error('Catalog unavailable');
    exercises.findBySlug.mockRejectedValue(error);
    await expect(useCase.execute(input)).rejects.toBe(error);
  });
});
