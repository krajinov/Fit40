import { describe, expect, it, vi } from 'vitest';
import type { NextWorkoutDto } from '@/application/dto/dashboard';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import {
  nextWorkoutPreviewState,
  toNextWorkoutView,
  type NextWorkoutView,
} from '@/features/sessions/next-workout-view';

// The view module imports the session composition root for
// buildNextWorkoutView; the pure mapper under test never calls it, and the
// stub keeps the infrastructure wiring out of this unit test.
vi.mock('@/features/sessions/services', () => ({
  resolveNextWorkoutUseCase: { execute: vi.fn() },
}));

function rep() {
  const r = createRepScheme(3, 8, 10);
  if (!r.ok) throw Error(r.error.message);
  return r.data;
}

const DTO: NextWorkoutDto = {
  programSlug: 'prog-1',
  weekNumber: 2,
  workoutOrder: 1,
  workoutName: 'Push A',
  exerciseCount: 4,
  estimatedMinutes: 45,
  preview: [
    { order: 1, exerciseName: 'Bench Press', prescription: rep() },
    { order: 2, exerciseName: 'Bench Press', prescription: rep() },
  ],
  sessionState: 'in-progress',
};

describe('toNextWorkoutView', () => {
  it('keeps the scheduled occurrence order so repeated names key uniquely', () => {
    const view = toNextWorkoutView(DTO);
    expect(view.preview.map((exercise) => exercise.order)).toEqual([1, 2]);
    expect(new Set(view.preview.map((exercise) => exercise.order)).size).toBe(
      view.preview.length,
    );
  });

  it('formats the prescription label and passes workout state through', () => {
    const view = toNextWorkoutView(DTO);
    expect(view.workoutName).toBe('Push A');
    expect(view.sessionState).toBe('in-progress');
    expect(view.preview[0]?.exerciseName).toBe('Bench Press');
    expect(view.preview[0]?.prescriptionLabel).toBe('3 × 8–10');
  });
});

describe('nextWorkoutPreviewState', () => {
  it('reports completion only when the enrollment has no scheduled next workout', () => {
    const state = nextWorkoutPreviewState(null, null);
    expect(state).toEqual({ status: 'complete' });
  });

  it('reports completion keyed on the enrollment, not on the view argument', () => {
    // Defensive symmetry: a stale resolved view must not flip the state of a
    // genuinely completed program.
    const state = nextWorkoutPreviewState(null, toNextWorkoutView(DTO));
    expect(state).toEqual({ status: 'complete' });
  });

  it('reports available with the resolved view when preview resolution succeeds', () => {
    const workout: NextWorkoutView = toNextWorkoutView(DTO);
    const state = nextWorkoutPreviewState({ weekNumber: 2, workoutOrder: 1 }, workout);
    expect(state).toEqual({ status: 'available', workout });
  });

  it('reports unavailable — never complete — when the preview fails to resolve', () => {
    const state = nextWorkoutPreviewState({ weekNumber: 2, workoutOrder: 1 }, null);
    expect(state.status).toBe('unavailable');
    expect(state.status).not.toBe('complete');
    expect(state).not.toHaveProperty('workout');
  });
});
