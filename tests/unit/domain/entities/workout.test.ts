import { describe, expect, it } from 'vitest';

import { createWorkout, type CreateWorkoutInput } from '@/domain/entities/workout';
import { createExerciseId } from '@/domain/types/ids';
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

function validWorkoutInput(): CreateWorkoutInput {
  return {
    id: 'wo-test',
    name: 'Test Workout',
    slug: 'test-workout',
    description: 'A test workout.',
    estimatedDurationMinutes: 30,
    exercises: [
      {
        exerciseId: validExerciseId(),
        order: 1,
        prescription: validRepScheme(),
        restSeconds: 60,
        notes: null,
      },
    ],
  };
}

describe('createWorkout', () => {
  it('creates a valid workout', () => {
    const result = createWorkout(validWorkoutInput());

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.name).toBe('Test Workout');
    expect(result.data.exercises).toHaveLength(1);
  });

  it('rejects an empty name', () => {
    const result = createWorkout({ ...validWorkoutInput(), name: '   ' });

    expect(result.ok).toBe(false);
  });

  it('rejects an empty slug', () => {
    const result = createWorkout({ ...validWorkoutInput(), slug: '' });

    expect(result.ok).toBe(false);
  });

  it('rejects an invalid slug', () => {
    const result = createWorkout({ ...validWorkoutInput(), slug: 'Test Workout' });

    expect(result.ok).toBe(false);
  });

  it('rejects an empty description', () => {
    const result = createWorkout({ ...validWorkoutInput(), description: '' });

    expect(result.ok).toBe(false);
  });

  it('rejects zero or negative estimated duration', () => {
    expect(createWorkout({ ...validWorkoutInput(), estimatedDurationMinutes: 0 }).ok).toBe(false);
    expect(createWorkout({ ...validWorkoutInput(), estimatedDurationMinutes: -5 }).ok).toBe(false);
  });

  it('rejects a workout with no exercises', () => {
    const result = createWorkout({ ...validWorkoutInput(), exercises: [] });

    expect(result.ok).toBe(false);
  });

  it('rejects duplicate exercise orders', () => {
    const input = validWorkoutInput();
    const exercise = input.exercises[0];
    if (!exercise) throw new Error('Missing exercise');

    const result = createWorkout({
      ...input,
      exercises: [
        { ...exercise, order: 1 },
        { ...exercise, order: 1 },
      ],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects non-sequential exercise orders', () => {
    const input = validWorkoutInput();
    const exercise = input.exercises[0];
    if (!exercise) throw new Error('Missing exercise');

    const result = createWorkout({
      ...input,
      exercises: [{ ...exercise, order: 2 }],
    });

    expect(result.ok).toBe(false);
  });

  it('rejects negative rest seconds', () => {
    const input = validWorkoutInput();
    const exercise = input.exercises[0];
    if (!exercise) throw new Error('Missing exercise');

    const result = createWorkout({
      ...input,
      exercises: [{ ...exercise, restSeconds: -1 }],
    });

    expect(result.ok).toBe(false);
  });
});