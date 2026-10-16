/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: vi.fn() }) }));
vi.mock('@/features/sessions/actions/complete-session', () => ({ completeSessionAction: vi.fn() }));
// Exercise editing is unrelated to the finish/back navigation contract.
vi.mock('@/features/sessions/components/SessionOccurrence', () => ({ SessionOccurrence: () => null }));
vi.mock('@/features/sessions/components/SessionExerciseCard', () => ({ SessionExerciseCard: () => null }));
vi.mock('@/features/sessions/components/AddSessionExercisePanel', () => ({ AddSessionExercisePanel: () => null }));

import { ActiveWorkoutScreen } from '@/features/sessions/components/ActiveWorkoutScreen';
import { SessionCompletedPanel } from '@/features/sessions/components/SessionCompletedPanel';
import { buildSessionProgress } from '@/features/sessions/active-workout-views';
import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { WorkoutSessionDto } from '@/application/dto/workout-session';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const mounted: { container: HTMLElement; root: Root }[] = [];

afterEach(() => {
  for (const { root, container } of mounted.splice(0)) {
    act(() => root.unmount());
    container.remove();
  }
});

const workout: ScheduledWorkoutDetailDto = {
  programSlug: 'beginner', programName: 'Beginner', weekNumber: 1, order: 2,
  workout: {
    id: 'workout-1', name: 'Strength A', slug: 'strength-a', description: 'Strength',
    estimatedDurationMinutes: 45, exercises: [],
  },
};

const session: WorkoutSessionDto = {
  sessionId: 'session-1', scheduledWorkoutId: 'scheduled-1', workoutId: 'workout-1',
  status: 'in-progress', startedAt: '2026-10-01T10:00:00.000Z', completedAt: null,
  version: 0, exerciseLogs: [], prescribedSets: 0, skippedExerciseCount: 0,
  metrics: { totalSets: 0, totalReps: 0, totalDurationSeconds: 0, volume: 0, hasExternalLoad: false },
};

async function renderSession(completed: boolean): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  const displayedSession: WorkoutSessionDto = completed
    ? { ...session, status: 'completed', completedAt: '2026-10-01T10:45:00.000Z' }
    : session;
  const props = {
    workout, programCompletion: null, session: displayedSession, cards: [], progress: buildSessionProgress(displayedSession),
    programSlug: workout.programSlug, weekNumber: workout.weekNumber, workoutOrder: workout.order,
  };
  await act(async () => {
    root.render(completed
      ? createElement(SessionCompletedPanel, props)
      : createElement(ActiveWorkoutScreen, {
        ...props,
        view: {
          ...props, screenState: 'in-progress', addableExercises: [],
          notPerformedRecorded: false, programCompletion: null,
        },
      }));
  });
  return container;
}

describe('session navigation (S4)', () => {
  it('offers the finish action during a workout', async () => {
    const container = await renderSession(false);
    const finishControls = [...container.querySelectorAll<HTMLButtonElement>('button')]
      .filter((button) => button.textContent === 'Finish workout');

    expect(finishControls.length).toBeGreaterThan(0);
    for (const button of finishControls) {
      expect(button.disabled).toBe(false);
      expect(button.type).toBe('submit');
      expect(button.form).not.toBeNull();
    }
    // jsdom cannot determine which breakpoint-specific action is visible.
  });

  it('offers workout details after completion without another finish action', async () => {
    const container = await renderSession(true);
    expect([...container.querySelectorAll('button')].some((button) =>
      button.textContent === 'Finish workout')).toBe(false);
    expect(container.querySelector('a[href="/programs/beginner/weeks/1/workouts/2"]')).not.toBeNull();
    expect(container.textContent).toContain('COMPLETED');
  });
});
