/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the M14 completion screen (Slice 6): the summary
 * renders the completed-run facts truthfully, and the restart leaf submits
 * ONLY the program slug (no user id, no enrollment id — nothing else in the
 * form), disables repeat submission while pending, and surfaces typed action
 * errors through the established accessible inline pattern. Records stay
 * historical: exact count, capped-list note, honest empty state, and rows
 * that link to the owning session.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { restartExecute } = vi.hoisted(() => ({ restartExecute: vi.fn() }));

vi.mock('@/features/enrollment/actions/restart-program', () => ({
  restartProgramAction: restartExecute,
}));

import type { ProgramCompletionCompletedDto } from '@/application/dto/program-completion';
import { buildProgramCompletionView } from '@/features/enrollment/completion-view';
import { ProgramCompletionSummary } from '@/features/enrollment/components/ProgramCompletionSummary';
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

function recordEvent(
  overrides?: Partial<ProgramCompletionCompletedDto['recordEvents'][number]>,
): ProgramCompletionCompletedDto['recordEvents'][number] {
  return {
    exerciseId: 'ex-1',
    exerciseName: 'Goblet Squat',
    exerciseSlug: 'goblet-squat',
    metric: 'max-load',
    value: 82.5,
    previousBest: 80,
    sessionId: 'session-1',
    completedAt: '2026-02-10T18:00:00.000Z',
    ...overrides,
  };
}

function completedDto(
  overrides?: Partial<ProgramCompletionCompletedDto>,
): ProgramCompletionCompletedDto {
  return {
    status: 'completed',
    programName: 'Fit40 Beginner Strength',
    programSlug: 'fit40-beginner-strength',
    completedWorkouts: 12,
    totalWorkouts: 12,
    completedAt: '2026-02-15T10:30:00.000Z',
    distinctExercises: 7,
    recordEventCount: 1,
    recordEvents: [recordEvent()],
    ...overrides,
  };
}

async function renderSummary(
  dto: ProgramCompletionCompletedDto = completedDto(),
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ProgramCompletionSummary, { view: buildProgramCompletionView(dto) }));
    // Let React's scheduled render commit inside the act window.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

function restartButton(container: HTMLElement): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) =>
      (candidate.textContent ?? '').includes('Start program again') ||
      (candidate.textContent ?? '').includes('Restarting'),
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error('missing restart button');
  return button;
}

/** Submits the native restart form and flushes the resulting action state. */
async function submit(container: HTMLElement): Promise<void> {
  const button = restartButton(container);
  const form = button.form;
  if (!(form instanceof HTMLFormElement)) throw new Error('missing restart form');
  await act(async () => {
    form.requestSubmit(button);
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('ProgramCompletionSummary — completed-run facts and restart form', () => {
  beforeEach(() => {
    restartExecute.mockReset();
    restartExecute.mockResolvedValue({ ok: true } satisfies EnrollmentActionState);
  });

  it('renders the completed-run facts and the historical records wording', async () => {
    const container = await renderSummary();

    expect(container.textContent).toContain('Program completed');
    expect(container.textContent).toContain('Fit40 Beginner Strength');
    expect(container.textContent).toContain('12 of 12');
    expect(container.textContent).toContain('Feb 15, 2026');
    expect(container.textContent).toContain('Exercises trained');
    expect(container.textContent).toContain('Personal records during this program');
    expect(container.textContent).toContain('historical records, not current personal bests');
    // Never M13's current-PB language, and no gamification.
    expect(container.textContent).not.toContain('Current PBs');
    expect(container.textContent).not.toContain('this week');
    expect(container.textContent).not.toMatch(/XP|achievement|calorie|e1RM|adherence/i);
  });

  it('submits only the program slug — no user id, no enrollment id, no other fields', async () => {
    const container = await renderSummary();

    await submit(container);

    expect(restartExecute).toHaveBeenCalledTimes(1);
    const fd = restartExecute.mock.calls[0]?.[0] as FormData;
    expect(Array.from(fd.keys())).toEqual(['programSlug']);
    expect(fd.get('programSlug')).toBe('fit40-beginner-strength');
    expect(fd.get('userId')).toBeNull();
    expect(fd.get('enrollmentId')).toBeNull();
    // Nothing identity-bearing is rendered into the form either.
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0);
    expect(container.innerHTML).not.toContain('enrollmentId');
  });

  it('disables repeat submission while pending and restores the label afterwards', async () => {
    let resolveAction: (state: EnrollmentActionState) => void = () => {};
    restartExecute.mockImplementation(
      () =>
        new Promise<EnrollmentActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const container = await renderSummary();

    await submit(container);

    expect(restartButton(container).disabled).toBe(true);
    expect(restartButton(container).textContent).toBe('Restarting…');

    // A realistic user click on the disabled button dispatches nothing.
    act(() => {
      restartButton(container).click();
    });
    expect(restartExecute).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAction({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(restartButton(container).disabled).toBe(false);
    expect(restartButton(container).textContent).toBe('Start program again');
  });

  it('renders a typed action error accessibly via role="alert"', async () => {
    restartExecute.mockResolvedValue({
      ok: false,
      error: { code: 'PROGRAM_NOT_COMPLETE', message: 'This program run is not complete yet.' },
    });
    const container = await renderSummary();

    await submit(container);

    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe('This program run is not complete yet.');
  });
});

describe('ProgramCompletionSummary — records section', () => {
  beforeEach(() => {
    restartExecute.mockReset();
    restartExecute.mockResolvedValue({ ok: true } satisfies EnrollmentActionState);
  });

  it('renders the exact event count and the truthful capped-list note', async () => {
    const five = [5, 4, 3, 2, 1].map((n) => recordEvent({ sessionId: `s${n}` }));
    const container = await renderSummary(
      completedDto({ recordEventCount: 9, recordEvents: five }),
    );

    expect(container.textContent).toContain('9 during this run');
    expect(container.textContent).toContain('Showing the 5 most recent.');
    // The DTO's five rows render as supplied — the four omitted events are
    // acknowledged by the count, never reconstructed.
    expect(container.querySelectorAll('ul a')).toHaveLength(5);
  });

  it('renders an honest empty state for zero PR events', async () => {
    const container = await renderSummary(
      completedDto({ recordEventCount: 0, recordEvents: [] }),
    );

    expect(container.textContent).toContain('No personal records during this program');
    expect(container.textContent).toContain('No records during this run.');
    expect(container.textContent).not.toContain('Showing the');
    expect(container.querySelectorAll('ul a')).toHaveLength(0);
  });

  it('renders each PR event as one link to the session that owns it', async () => {
    const container = await renderSummary();

    const rows = container.querySelectorAll<HTMLAnchorElement>('ul a');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.getAttribute('href')).toBe('/history/sessions/session-1');
    expect(rows[0]?.textContent).toContain('Goblet Squat');
    expect(rows[0]?.textContent).toContain('Heaviest load');
    expect(rows[0]?.textContent).toContain('82.5 kg');
    expect(rows[0]?.textContent).toContain('Feb 10, 2026');
  });

  it('offers exactly the two required actions: restart and choose another program', async () => {
    const container = await renderSummary();

    const secondary = container.querySelector<HTMLAnchorElement>('a[href="/programs"]');
    expect(secondary?.textContent).toBe('Choose another program');
    expect(restartButton(container).textContent).toBe('Start program again');
  });
});
