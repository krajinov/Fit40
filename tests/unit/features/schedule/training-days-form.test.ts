/**
 * @vitest-environment jsdom
 *
 * M15 Slice 7 tests for the training-days form: seven labelled weekday
 * controls with native checked semantics, a fresh (never pre-checked)
 * selection in both modes — M15 stores planned dates, not weekdays, so no
 * stored preference is claimed — the approved setup/change labels and
 * replacement copy, only public weekday values in the form, the server-
 * rendered slug injected on submit, a disabled pending submit, an alert-role
 * error, and a selection that survives a failed save.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { configureActionMock } = vi.hoisted(() => ({ configureActionMock: vi.fn() }));

vi.mock('@/features/schedule/actions/configure-training-days', () => ({
  configureTrainingDaysAction: configureActionMock,
}));

import {
  CHANGE_TRAINING_DAYS_COPY,
  TrainingDaysForm,
} from '@/features/schedule/components/TrainingDaysForm';
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

const PROGRAM_SLUG = 'fit40-beginner-strength';

async function renderForm(mode: 'setup' | 'change'): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(TrainingDaysForm, { programSlug: PROGRAM_SLUG, mode }));
  });
  mounted.push({ container, root });
  return container;
}

function weekdayInputs(container: HTMLElement): HTMLInputElement[] {
  return [...container.querySelectorAll<HTMLInputElement>('input[name="weekday"]')];
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector<HTMLButtonElement>('form button[type="submit"]');
  if (button === null) throw new Error('missing submit button');
  return button;
}

/** Submits the native form and flushes the resulting action state. */
async function submit(container: HTMLElement): Promise<void> {
  const form = container.querySelector('form');
  if (!(form instanceof HTMLFormElement)) throw new Error('missing form');
  await act(async () => {
    form.requestSubmit(submitButton(container));
    await Promise.resolve();
    await Promise.resolve();
  });
}

async function toggle(container: HTMLElement, weekday: number): Promise<void> {
  const input = weekdayInputs(container).find((candidate) => candidate.value === String(weekday));
  if (input === undefined) throw new Error(`missing weekday ${weekday}`);
  await act(async () => {
    input.click();
    await Promise.resolve();
  });
}

describe('TrainingDaysForm (M15 Slice 7)', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    configureActionMock.mockResolvedValue({ ok: true } satisfies ScheduleActionState);
  });

  it('renders seven labelled weekday controls in a labelled group', async () => {
    const container = await renderForm('setup');

    expect(container.querySelector('legend')?.textContent).toBe('Training days');

    const inputs = weekdayInputs(container);
    expect(inputs).toHaveLength(7);
    expect(inputs.map((input) => input.value)).toEqual(['1', '2', '3', '4', '5', '6', '7']);
    expect(inputs.every((input) => input.type === 'checkbox')).toBe(true);
    expect(inputs.every((input) => input.checked === false)).toBe(true);

    const labels = [...container.querySelectorAll('label')].map((label) =>
      label.textContent?.trim(),
    );
    expect(labels).toEqual(['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  });

  it('never presents a persisted weekday preference in either mode', async () => {
    for (const mode of ['setup', 'change'] as const) {
      const container = await renderForm(mode);
      expect(weekdayInputs(container).every((input) => input.checked === false)).toBe(true);
    }
  });

  it('labels the setup submit "Set training days" without change copy', async () => {
    const container = await renderForm('setup');

    expect(submitButton(container).textContent).toBe('Set training days');
    expect(submitButton(container).disabled).toBe(false);
    expect(container.textContent).not.toContain(CHANGE_TRAINING_DAYS_COPY);
  });

  it('exposes the change affordance copy and its own submit label', async () => {
    const container = await renderForm('change');

    expect(container.textContent).toContain(CHANGE_TRAINING_DAYS_COPY);
    expect(container.textContent).toContain('replaces the dates of future workouts');
    expect(container.textContent).toContain('in-progress workouts keep their current date');
    expect(submitButton(container).textContent).toBe('Save training days');
  });

  it('carries only public weekday fields — no slug, enrollment or user id in the form', async () => {
    const container = await renderForm('setup');

    const names = [...container.querySelectorAll<HTMLInputElement>('input')].map(
      (input) => input.name,
    );
    expect(names).toEqual(Array(7).fill('weekday'));
    expect(container.innerHTML).not.toContain('enr-');
    expect(container.innerHTML).not.toContain('enrollmentId');
    expect(container.innerHTML).not.toContain('userId');
  });

  it('submits the selected weekdays with the server-rendered slug injected', async () => {
    const container = await renderForm('setup');
    await toggle(container, 1);
    await toggle(container, 3);
    await toggle(container, 5);

    await submit(container);

    expect(configureActionMock).toHaveBeenCalledTimes(1);
    const formData = configureActionMock.mock.calls[0]?.[0];
    expect(formData).toBeInstanceOf(FormData);
    if (!(formData instanceof FormData)) return;
    expect(formData.getAll('weekday')).toEqual(['1', '3', '5']);
    expect(formData.get('programSlug')).toBe(PROGRAM_SLUG);
    expect(formData.get('enrollmentId')).toBeNull();
    expect(formData.get('userId')).toBeNull();
  });

  it('keeps the selection and shows an alert-role error when the save fails', async () => {
    configureActionMock.mockResolvedValue({
      ok: false,
      error: {
        code: 'SCHEDULE_CHANGED',
        message: 'Your training schedule changed while saving. Please reload and try again.',
      },
    } satisfies ScheduleActionState);
    const container = await renderForm('setup');
    await toggle(container, 2);
    await toggle(container, 4);

    await submit(container);

    expect(container.querySelector('[role="alert"]')?.textContent).toBe(
      'Your training schedule changed while saving. Please reload and try again.',
    );
    const checked = weekdayInputs(container)
      .filter((input) => input.checked)
      .map((input) => input.value);
    expect(checked).toEqual(['2', '4']);
  });

  it('shows no error alert after a successful save', async () => {
    const container = await renderForm('setup');
    await toggle(container, 1);

    await submit(container);

    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
});