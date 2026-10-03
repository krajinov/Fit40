/**
 * @vitest-environment jsdom
 *
 * M17 final review — the session screen's recorded state.
 *
 * `SessionRecordedPanel` is the direct/bookmarked session route's view of an
 * occurrence recorded as not performed: it must state the stored fact, expose
 * the existing Undo affordance and offer NO Start control. It reuses the shared
 * recorded CTA band, so the copy/behaviour match the other M17 surfaces.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { undoActionMock } = vi.hoisted(() => ({ undoActionMock: vi.fn() }));

vi.mock('@/features/schedule/actions/undo-not-performed', () => ({
  undoNotPerformedAction: undoActionMock,
}));

import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import { SessionRecordedPanel } from '@/features/sessions/components/SessionRecordedPanel';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});

const WORKOUT: ScheduledWorkoutDetailDto = {
  programSlug: 'fit40-beginner-strength',
  programName: 'Fit40 Beginner Strength',
  weekNumber: 1,
  order: 2,
  workout: {
    id: 'wo-2',
    name: 'Lower Body B',
    slug: 'lower-body-b',
    description: 'Squat, hinge and carry.',
    estimatedDurationMinutes: 45,
    exercises: [],
  },
};

async function renderRecorded(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(SessionRecordedPanel, {
        workout: WORKOUT,
        programSlug: WORKOUT.programSlug,
        weekNumber: WORKOUT.weekNumber,
        workoutOrder: WORKOUT.order,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

describe('SessionRecordedPanel / recorded session route (M17 final review)', () => {
  it('states the recorded fact, offers Undo and never a Start control', async () => {
    const container = await renderRecorded();
    const text = container.textContent ?? '';

    expect(text).toContain('Recorded as not performed');
    expect(text).toContain('It goes back to not started.');
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Undo'),
    ).toBe(true);

    // No Start/Resume affordance of any kind on the recorded screen.
    expect(text).not.toContain('Start workout');
    expect(text).not.toContain('Resume workout');
    expect(text).not.toContain('Ready when you are');
  });

  it('keeps the authored workout reachable (header + mobile back link)', async () => {
    const container = await renderRecorded();

    expect(container.querySelector('a[href$="/weeks/1/workouts/2"]')).not.toBeNull();
    expect(container.textContent).toContain('Lower Body B');
  });
});
