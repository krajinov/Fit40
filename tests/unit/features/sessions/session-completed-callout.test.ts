/**
 * @vitest-environment jsdom
 *
 * M14 Slice 7 placement tests for the Session Completed program-complete
 * callout: it renders ONLY from the server-resolved fact, with the locked
 * factual wording and the dedicated /programs/[slug]/completed link — while
 * workout detail (and the in-progress screen, pinned in
 * active-workout-screen.test.ts) receive no equivalent callout. A null fact
 * (incomplete / unavailable) renders nothing — never a false claim, and the
 * completed screen stays fully usable.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

// The panel's exercise cards pull the logger islands and their action
// modules — irrelevant to placement, stubbed at the boundary (as the
// existing screen tests do).
vi.mock('@/features/sessions/components/SessionExerciseCard', () => ({
  SessionExerciseCard: () => null,
}));

import type { ScheduledWorkoutDetailDto } from '@/application/dto/program';
import type { WorkoutSessionDto } from '@/application/dto/workout-session';
import { buildSessionProgress } from '@/features/sessions/active-workout-views';
import { SessionCompletedPanel } from '@/features/sessions/components/SessionCompletedPanel';
import { WorkoutDetail } from '@/features/sessions/components/WorkoutDetail';
import type { SessionProgramCompletionFact } from '@/features/sessions/program-completion-fact';
import type { WorkoutDetailView } from '@/features/sessions/workout-detail-view';

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
  programSlug: 'prog-1',
  programName: 'Program 1',
  weekNumber: 1,
  order: 1,
  workout: {
    id: 'w1',
    name: 'Push A',
    slug: 'push-a',
    description: 'A workout.',
    estimatedDurationMinutes: 45,
    exercises: [],
  },
};

const FACT: SessionProgramCompletionFact = {
  programName: 'Program 1',
  summaryHref: '/programs/prog-1/completed',
};

function completedSession(): WorkoutSessionDto {
  return {
    sessionId: 's-1',
    scheduledWorkoutId: 'sw-1',
    workoutId: 'w1',
    status: 'completed',
    startedAt: '2026-09-01T17:00:00.000Z',
    completedAt: '2026-09-01T17:05:00.000Z',
    version: 1,
    exerciseLogs: [],
    metrics: { totalSets: 0, totalReps: 0, totalDurationSeconds: 0, volume: 0 },
    prescribedSets: 0,
    skippedExerciseCount: 0,
  };
}

async function renderPanel(
  programCompletion: SessionProgramCompletionFact | null,
): Promise<HTMLElement> {
  const session = completedSession();
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(SessionCompletedPanel, {
        workout: WORKOUT,
        session,
        cards: [],
        progress: buildSessionProgress(session),
        programSlug: 'prog-1',
        weekNumber: 1,
        workoutOrder: 1,
        programCompletion,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

async function renderWorkoutDetail(): Promise<HTMLElement> {
  const view: WorkoutDetailView = {
    workout: WORKOUT,
    targets: [],
    hasRecommendations: false,
    ctaState: 'completed',
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(WorkoutDetail, { view }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

describe('SessionCompletedPanel / M14 program-complete callout', () => {
  it('renders the factual callout and the dedicated summary link when the fact is present', async () => {
    const container = await renderPanel(FACT);

    expect(container.textContent).toContain('Program complete');
    expect(container.textContent).toContain(
      "You've completed every scheduled workout in Program 1.",
    );

    const summaryLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/programs/prog-1/completed"]',
    );
    expect(summaryLink?.textContent).toBe('View completion summary');
    // ≥44px touch target from the locked primary button variant.
    expect(summaryLink?.className).toContain('h-[52px]');

    // Factual copy only — no gamification, no current-PB claims.
    expect(container.textContent).not.toMatch(/XP|achievement|personal best|calorie|e1RM/i);
  });

  it('renders no callout when the fact is absent — the completed screen stays usable', async () => {
    const container = await renderPanel(null);

    expect(container.textContent).not.toContain('Program complete');
    expect(container.querySelector('a[href$="/completed"]')).toBeNull();
    // The session's own completed content is untouched.
    expect(container.textContent).toContain('COMPLETED');
    expect(container.textContent).toContain('No sets logged');
  });
});

describe('WorkoutDetail / M14 callout exclusion', () => {
  it('receives no equivalent program-complete callout', async () => {
    const container = await renderWorkoutDetail();

    expect(container.textContent).not.toContain('Program complete');
    expect(container.querySelector('a[href$="/completed"]')).toBeNull();
  });
});
