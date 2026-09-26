/**
 * @vitest-environment jsdom
 *
 * M15 Slice 7 tests for the move-workout form: a native disclosure with a
 * canonical `type="date"` field (no JavaScript Date conversion anywhere), a
 * label naming the workout, the authored coordinates injected from
 * server-rendered props so only the date travels in the form data, a disabled
 * pending submit, an alert-role error on failure, and no database identity in
 * the DOM.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { rescheduleActionMock } = vi.hoisted(() => ({ rescheduleActionMock: vi.fn() }));

vi.mock('@/features/schedule/actions/reschedule-planned-workout', () => ({
  reschedulePlannedWorkoutAction: rescheduleActionMock,
}));

import { MovePlannedWorkoutForm } from '@/features/schedule/components/MovePlannedWorkoutForm';
import type { ScheduleActionState } from '@/features/schedule/types/schedule-action-state';

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

const PROPS = {
  programSlug: 'fit40-beginner-strength',
  weekNumber: 2,
  workoutOrder: 3,
  plannedDate: '2026-09-30',
  workoutName: 'Lower Body B',
} as const;

async function renderForm(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(MovePlannedWorkoutForm, PROPS));
  });
  mounted.push({ container, root });
  return container;
}

function dateInput(container: HTMLElement): HTMLInputElement {
  const input = container.querySelector<HTMLInputElement>('input[name="date"]');
  if (input === null) throw new Error('missing date input');
  return input;
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
  if (button === null) throw new Error('missing submit button');
  return button;
}

async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('missing form');
  await act(async () => {
    form.requestSubmit(submitButton(container));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('MovePlannedWorkoutForm (M15 Slice 7)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    rescheduleActionMock.mockResolvedValue({ ok: true } satisfies ScheduleActionState);
  });

  it('exposes a native disclosure summary labelled Move', async () => {
    const container = await renderForm();

    const summary = container.querySelector('summary');
    expect(summary?.textContent).toBe('Move');
    expect(summary?.className).toContain('h-11');
    expect(container.querySelector('details')).not.toBeNull();
  });

  it('uses the canonical planned date directly in a native date field', async () => {
    const container = await renderForm();

    const input = dateInput(container);
    expect(input.type).toBe('date');
    expect(input.value).toBe('2026-09-30');
    expect(input.required).toBe(true);
  });

  it('ties the date label to the workout and the input', async () => {
    const container = await renderForm();

    const label = container.querySelector('label');
    expect(label?.textContent).toBe('New date for Lower Body B');
    expect(label?.getAttribute('for')).toBe(dateInput(container).id);
    expect(dateInput(container).id).toBe('move-date-2-3');
  });

  it('submits the injected authored coordinates plus the exact canonical date', async () => {
    const container = await renderForm();
    dateInput(container).value = '2026-10-05';

    await submit(container);

    expect(rescheduleActionMock).toHaveBeenCalledTimes(1);
    const formData = rescheduleActionMock.mock.calls[0]?.[0];
    expect(formData).toBeInstanceOf(FormData);
    if (!(formData instanceof FormData)) return;
    // The date is never converted through a Date: the browser's canonical
    // `YYYY-MM-DD` string travels unchanged.
    expect(formData.get('date')).toBe('2026-10-05');
    expect(formData.get('programSlug')).toBe(PROPS.programSlug);
    expect(formData.get('weekNumber')).toBe('2');
    expect(formData.get('workoutOrder')).toBe('3');
    expect(formData.get('enrollmentId')).toBeNull();
    expect(formData.get('scheduledWorkoutId')).toBeNull();
    expect(formData.get('sessionId')).toBeNull();
    expect(formData.get('userId')).toBeNull();
    expect([...formData.keys()].sort()).toEqual([
      'date',
      'programSlug',
      'weekNumber',
      'workoutOrder',
    ]);
  });

  it('carries no database identity in the DOM and only the date field', async () => {
    const container = await renderForm();

    const inputs = [...container.querySelectorAll<HTMLInputElement>('input')];
    expect(inputs.map((input) => input.name)).toEqual(['date']);
    expect(container.innerHTML).not.toContain('enr-');
    expect(container.innerHTML).not.toContain('sw-');
  });

  it('shows a submit control and disables it while moving', async () => {
    let resolveAction: ((state: ScheduleActionState) => void) | undefined;
    rescheduleActionMock.mockImplementation(
      () =>
        new Promise<ScheduleActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const container = await renderForm();

    expect(submitButton(container).textContent).toBe('Move workout');
    expect(submitButton(container).disabled).toBe(false);

    const form = container.querySelector('form');
    if (!(form instanceof HTMLFormElement)) throw new Error('missing form');
    await act(async () => {
      form.requestSubmit(submitButton(container));
      await Promise.resolve();
    });

    expect(submitButton(container).disabled).toBe(true);
    expect(submitButton(container).textContent).toBe('Moving…');

    await act(async () => {
      resolveAction?.({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(submitButton(container).disabled).toBe(false);
  });

  it('surfaces a failed move as an alert-role message and nothing on success', async () => {
    rescheduleActionMock.mockResolvedValue({
      ok: false,
      error: { code: 'DATE_ALREADY_PLANNED', message: 'Another planned workout is already scheduled for 2026-10-05.' },
    } satisfies ScheduleActionState);
    const container = await renderForm();
    await submit(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Another planned workout is already scheduled for 2026-10-05.',
    );

    rescheduleActionMock.mockResolvedValue({ ok: true } satisfies ScheduleActionState);
    const successContainer = await renderForm();
    await submit(successContainer);
    expect(successContainer.querySelector('[role="alert"]')).toBeNull();
  });
});