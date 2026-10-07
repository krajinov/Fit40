/**
 * @vitest-environment jsdom
 *
 * M14 Slice 7 tests for the enrollment panel's completion surfacing: a
 * COMPLETE enrollment exposes "View completion summary" and reuses the
 * Slice 6 RestartProgramButton (ONE form, program slug only — no second
 * restart implementation) while Leave stays available; an INCOMPLETE
 * enrollment exposes neither and its next-workout/progress behavior is
 * unchanged.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { restartExecute } = vi.hoisted(() => ({ restartExecute: vi.fn() }));

// The Slice 6 restart leaf (reused as-is) and the Leave control post to
// Server Actions that pull the DB composition root — stubbed at the module
// boundary; the contracts under test are what each form submits.
vi.mock('@/features/enrollment/actions/restart-program', () => ({
  restartProgramAction: restartExecute,
}));

vi.mock('@/features/enrollment/actions/leave-program', () => ({
  leaveProgramAction: vi.fn(),
}));

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import { EnrolledProgramPanel } from '@/features/enrollment/components/EnrolledProgramPanel';
import type { EnrollmentActionState } from '@/features/enrollment/types/enrollment-action-state';

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

const PROGRAM = {
  slug: 'fit40-beginner-strength',
  name: 'Fit40 Beginner Strength',
  durationWeeks: 4,
} as const;

type EnrolledView = Extract<ProgramEnrollmentViewDto, { status: 'enrolled' }>;

function completeEnrollment(): EnrolledView {
  return {
    status: 'enrolled',
    enrolledAt: '2026-01-01T00:00:00.000Z',
    progress: { totalWorkouts: 12, completedWorkouts: 12, percentage: 100 },
    nextWorkout: null,
    completedScheduledWorkoutIds: [],
  };
}

function incompleteEnrollment(): EnrolledView {
  return {
    status: 'enrolled',
    enrolledAt: '2026-01-01T00:00:00.000Z',
    progress: { totalWorkouts: 12, completedWorkouts: 5, percentage: 42 },
    nextWorkout: { weekNumber: 1, workoutOrder: 2 },
    completedScheduledWorkoutIds: [],
  };
}

type PanelNextWorkout =
  | {
      readonly weekNumber: number;
      readonly workoutOrder: number;
      readonly workoutName: string;
      readonly metaLabel: string;
      readonly sessionState: 'not-started' | 'in-progress';
    }
  | 'unavailable'
  | null;

async function renderPanel(
  enrollment: EnrolledView,
  nextWorkout: PanelNextWorkout,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(EnrolledProgramPanel, {
        program: PROGRAM,
        enrollment,
        nextWorkout,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

function leaveButtons(container: HTMLElement): HTMLButtonElement[] {
  return Array.from(container.querySelectorAll('button')).filter(
    (button) => button.textContent === 'Leave plan',
  );
}

/** Submits the restart form (the Slice 6 leaf) and flushes its action state. */
async function submitRestart(container: HTMLElement): Promise<void> {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => candidate.textContent === 'Start program again',
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('missing restart button');
  const form = button.form;
  if (!(form instanceof HTMLFormElement)) throw new Error('missing restart form');
  await act(async () => {
    form.requestSubmit(button);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('EnrolledProgramPanel / complete enrollment (M14)', () => {
  beforeEach(() => {
    restartExecute.mockReset();
    restartExecute.mockResolvedValue({ ok: true } satisfies EnrollmentActionState);
  });

  it('exposes the summary link, the Slice 6 restart button, and keeps Leave', async () => {
    const container = await renderPanel(completeEnrollment(), null);

    const summary = container.querySelector<HTMLAnchorElement>(
      'a[href="/programs/fit40-beginner-strength/completed"]',
    );
    expect(summary?.textContent).toBe('View completion summary');
    // ≥44px touch targets from the locked button variants.
    expect(summary?.className).toContain('h-[52px]');

    const restart = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === 'Start program again',
    );
    expect(restart).toBeDefined();
    expect(restart?.className).toContain('h-[52px]');

    // Leave stays available in both placements (desktop header + mobile).
    expect(leaveButtons(container)).toHaveLength(2);
    expect(container.textContent).toContain('Program completed — every workout is done.');
  });

  it('submits ONE form carrying only the program slug — the shared Slice 6 leaf, no duplicate implementation', async () => {
    const container = await renderPanel(completeEnrollment(), null);

    // Exactly one form on the complete panel: the restart leaf's. Leave's
    // unconfirmed state renders no form, and no second restart form exists.
    expect(container.querySelectorAll('form')).toHaveLength(1);

    await submitRestart(container);

    expect(restartExecute).toHaveBeenCalledTimes(1);
    const fd = restartExecute.mock.calls[0]?.[0] as FormData;
    expect(Array.from(fd.keys())).toEqual(['programSlug']);
    expect(fd.get('programSlug')).toBe('fit40-beginner-strength');
    expect(fd.get('enrollmentId')).toBeNull();
    expect(fd.get('userId')).toBeNull();
  });
});

describe('EnrolledProgramPanel / incomplete enrollment (M14)', () => {
  beforeEach(() => {
    restartExecute.mockReset();
  });

  it('shows no completion-summary link and no restart button, with next-workout behavior unchanged', async () => {
    const container = await renderPanel(incompleteEnrollment(), {
      weekNumber: 1,
      workoutOrder: 2,
      workoutName: 'Push B',
      metaLabel: '6 exercises · about 45 minutes',
      sessionState: 'not-started',
    });

    expect(container.querySelector('a[href$="/completed"]')).toBeNull();
    expect(container.textContent).not.toContain('Start program again');
    expect(container.querySelectorAll('form')).toHaveLength(0);
    expect(restartExecute).not.toHaveBeenCalled();

    // Existing up-next/progress behavior is untouched.
    expect(container.textContent).toContain('UP NEXT · WEEK 1 · WORKOUT 2');
    expect(container.textContent).toContain('Push B');
    expect(container.textContent).toContain('5 of 12 workouts completed');
    const sessionLink = container.querySelector<HTMLAnchorElement>(
      'a[href="/programs/fit40-beginner-strength/weeks/1/workouts/2/session"]',
    );
    expect(sessionLink?.textContent).toBe('Start workout');
    expect(leaveButtons(container)).toHaveLength(2);
  });
});
