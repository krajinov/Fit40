/**
 * @vitest-environment jsdom
 *
 * M17 Slice 11 — recorded state on the authored weekly schedule cards. The
 * recorded key arrives from the M15 read (passed through by ProgramDetail),
 * so the card states the stored fact, is never also "up next", keeps its
 * detail link and exposes Undo alone — no Start, no Move.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { undoActionMock } = vi.hoisted(() => ({ undoActionMock: vi.fn() }));

vi.mock('@/features/schedule/actions/undo-not-performed', () => ({
  undoNotPerformedAction: undoActionMock,
}));

import type { ProgramWeekDto } from '@/application/dto/program';
import { ProgramWeekSection } from '@/features/programs/components/ProgramWeekSection';
import type { ProgramWeekLifecycle } from '@/application/dto/program-week-lifecycle';

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

const SLUG = 'fit40-beginner-strength';

const WEEK: ProgramWeekDto = {
  weekNumber: 1,
  scheduledWorkouts: [
    {
      scheduledWorkoutId: 'sw-1',
      workoutId: 'wo-a',
      workoutName: 'Upper Body A',
      workoutSlug: 'upper-body-a',
      order: 1,
      estimatedDurationMinutes: 45,
    },
    {
      scheduledWorkoutId: 'sw-2',
      workoutId: 'wo-b',
      workoutName: 'Lower Body B',
      workoutSlug: 'lower-body-b',
      order: 2,
      estimatedDurationMinutes: 45,
    },
  ],
};

async function renderWeek(
  options: {
    readonly status?: ProgramWeekLifecycle;
    readonly completedIds?: ReadonlySet<string>;
    readonly notPerformedIds?: ReadonlySet<string>;
    readonly upNextOccurrenceId?: string | null;
  } = {},
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ProgramWeekSection, {
        programSlug: SLUG,
        week: WEEK,
        status: options.status ?? 'in-progress',
        completedIds: options.completedIds ?? new Set<string>(),
        notPerformedIds: options.notPerformedIds,
        upNextOccurrenceId: options.upNextOccurrenceId ?? 'sw-a',
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

function cardFor(container: HTMLElement, name: string): HTMLElement {
  const cards = [...container.querySelectorAll('a, div')].filter(
    (node) => node.textContent?.includes(name) && node.className.includes('rounded-callout'),
  );
  const card = cards.at(-1);
  if (!(card instanceof HTMLElement)) throw new Error(`no card for ${name}`);
  return card;
}

describe('ProgramWeekSection / recorded state (M17 Slice 11)', () => {
  it('states the stored fact on a recorded card and exposes Undo only', async () => {
    const container = await renderWeek({ notPerformedIds: new Set(['sw-1']) });

    const card = cardFor(container, 'Upper Body A');
    expect(card.textContent).toContain('Recorded as not performed');
    expect(
      [...card.querySelectorAll('button')].some((button) => button.textContent === 'Undo'),
    ).toBe(true);
    // The occurrence keeps its detail link; no Start control exists on a card.
    expect(card.querySelector('a[href$="/weeks/1/workouts/1"]')).not.toBeNull();
    expect(card.textContent).not.toContain('Start');
    expect(card.textContent).not.toContain('Scheduled');
  });

  it('never also marks a recorded card as up next, even when it is the next key', async () => {
    const container = await renderWeek({
      notPerformedIds: new Set(['sw-1']),
      upNextOccurrenceId: 'sw-1',
    });

    const card = cardFor(container, 'Upper Body A');
    expect(card.getAttribute('aria-current')).toBeNull();
    expect(card.textContent).not.toContain('Up next');
    // …and the sibling card keeps its ordinary scheduled state.
    const other = cardFor(container, 'Lower Body B');
    expect(other.textContent).toContain('Scheduled');
    expect(
      [...other.querySelectorAll('button')].some((button) => button.textContent === 'Undo'),
    ).toBe(false);
  });

  it('keeps the existing up-next and completed cards free of settlement controls', async () => {
    const container = await renderWeek({
      completedIds: new Set(['sw-2']),
      upNextOccurrenceId: 'sw-1',
    });

    const upNext = cardFor(container, 'Upper Body A');
    expect(upNext.textContent).toContain('Up next');
    expect(upNext.getAttribute('aria-current')).toBe('true');
    expect(
      [...upNext.querySelectorAll('button')].some((button) => button.textContent === 'Undo'),
    ).toBe(false);

    const completed = cardFor(container, 'Lower Body B');
    expect(completed.textContent).toContain('Completed');
    expect(
      [...completed.querySelectorAll('button')].some((button) => button.textContent === 'Undo'),
    ).toBe(false);
  });
});

describe('ProgramWeekSection / settled-but-incomplete week (M17 final review)', () => {
  it('states a settled week factually — never "Completed" and no completion vocabulary', async () => {
    const container = await renderWeek({
      status: 'settled',
      completedIds: new Set(['sw-1']),
      notPerformedIds: new Set(['sw-2']),
      upNextOccurrenceId: null,
    });
    // The week HEADER badge is the settlement verdict; individual cards still
    // state their own completed / recorded facts.
    const headerText = container.querySelector('header')?.textContent ?? '';

    expect(headerText).toContain('Settled');
    expect(headerText).not.toContain('Completed');
    expect(headerText).not.toContain('Failed');
    expect(headerText).not.toContain('Missed');
    expect(headerText).not.toContain('Skipped');
    expect(headerText).not.toContain('Incomplete');
  });

  it('still marks a genuinely completed week Completed', async () => {
    const container = await renderWeek({
      status: 'completed',
      completedIds: new Set(['sw-1', 'sw-2']),
      upNextOccurrenceId: null,
    });

    expect(container.querySelector('header')?.textContent).toContain('Completed');
  });

  it('still marks the current week In progress', async () => {
    const container = await renderWeek({ status: 'in-progress', upNextOccurrenceId: 'sw-1' });

    expect(container.querySelector('header')?.textContent).toContain('In progress');
  });
});

