/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the LoggedSetRow edit lifecycle: Cancel and a
 * confirmed update reset the editor from the persisted set, failures keep
 * the user's typed values, and nothing resets while editing. Rendered with
 * react-dom (React 19 act) since the state transitions under test ARE the
 * component's controlled-input behavior — they cannot be covered by a pure
 * function test.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { updateExecute, deleteExecute, refreshMock } = vi.hoisted(() => ({
  updateExecute: vi.fn(),
  deleteExecute: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('@/features/sessions/actions/update-set', () => ({
  updateSetAction: updateExecute,
}));

vi.mock('@/features/sessions/actions/delete-set', () => ({
  deleteSetAction: deleteExecute,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { LoggedSetRow } from '@/features/sessions/components/LoggedSetRow';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';
import type { WorkoutSessionSetDto } from '@/application/dto/workout-session';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function makeSet(
  overrides?: Partial<Extract<WorkoutSessionSetDto, { type: 'reps' }>>,
): WorkoutSessionSetDto {
  return { setNumber: 1, type: 'reps', reps: 10, weightKg: 50, rpe: null, ...overrides };
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  });
}

function requiredInput(form: HTMLFormElement, name: string): HTMLInputElement {
  const input = form.querySelector<HTMLInputElement>(`input[name="${name}"]`);
  if (!(input instanceof HTMLInputElement)) throw new Error(`missing input "${name}"`);
  return input;
}

/**
 * The edit form is the only one containing the editable inputs; the delete
 * control is wrapped in its own form. `document.forms` never contains the
 * edit form while the row is in display mode.
 */
function findEditForm(container: HTMLElement): HTMLFormElement | null {
  for (const form of Array.from(container.querySelectorAll('form'))) {
    if (form.querySelector('input[name="weightKg"]') instanceof HTMLInputElement) {
      return form;
    }
  }
  return null;
}

function setInput(form: HTMLFormElement, name: string, value: string): void {
  const input = requiredInput(form, name);
  // The native setter bypasses React's value-tracking dedupe so the change
  // always reaches the controlled input's onChange.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  act(() => {
    if (setValue !== undefined) {
      setValue.call(input, value);
    } else {
      input.value = value;
    }
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

interface MountedRow {
  readonly container: HTMLElement;
  readonly root: Root;
}

const mounted: MountedRow[] = [];

async function renderRow(set: WorkoutSessionSetDto): Promise<{
  readonly container: HTMLElement;
  rerender: (nextSet: WorkoutSessionSetDto) => Promise<void>;
  edit: () => void;
  cancel: () => void;
  save: () => void;
  editForm: () => HTMLFormElement;
  countInputName: () => 'reps' | 'durationSeconds';
  inputValues: () => { weight: string; count: string; rpe: string };
}> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  const isReps = set.type === 'reps';
  const props = {
    sessionId: 's-1',
    set,
    exerciseOrder: 1,
    programSlug: 'prog-1',
    weekNumber: 1,
    workoutOrder: 1,
    isReps,
    valueLabel: '50 kg × 10',
  };
  const render = async (nextSet: WorkoutSessionSetDto): Promise<void> => {
    await act(async () => {
      root.render(createElement(LoggedSetRow, { ...props, set: nextSet }));
      // React schedules the root render on a macrotask; yielding to a timer
      // inside the act scope lets that commit happen while still inside
      // act's batching window (no "not wrapped in act" warnings, no flakes).
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  };
  await render(set);

  const inputByName = (name: string): HTMLInputElement => {
    const input = container.querySelector(`input[name="${name}"]`);
    if (!(input instanceof HTMLInputElement)) {
      throw new Error(`missing input "${name}"`);
    }
    return input;
  };
  const required = (selector: string): Element => {
    const element = container.querySelector(selector);
    if (element === null) throw new Error(`missing element "${selector}"`);
    return element;
  };

  return {
    container,
    rerender(nextSet: WorkoutSessionSetDto) {
      return render(nextSet);
    },
    edit: () => click(required(`[aria-label="Edit set ${set.setNumber}"]`)),
    cancel: () => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Cancel',
      );
      if (button === undefined) throw new Error('missing Cancel button');
      click(button);
    },
    save: () => {
      const button = Array.from(container.querySelectorAll('button')).find(
        (candidate) => candidate.textContent === 'Save',
      );
      if (!(button instanceof HTMLButtonElement)) throw new Error('missing Save button');
      const form = findEditForm(container);
      if (form === null) throw new Error('missing edit form');
      form.requestSubmit(button);
    },
    editForm: () => {
      const form = findEditForm(container);
      if (form === null) throw new Error('missing edit form');
      return form;
    },
    countInputName: () => (isReps ? 'reps' : 'durationSeconds'),
    inputValues: () => ({
      weight: inputByName('weightKg').value,
      count: inputByName(isReps ? 'reps' : 'durationSeconds').value,
      rpe: inputByName('rpe').value,
    }),
  };
}

beforeEach(() => {
  updateExecute.mockReset();
  deleteExecute.mockReset();
  refreshMock.mockReset();
  updateExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
  deleteExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
});

describe('LoggedSetRow editor lifecycle', () => {
  it('cancel discards changes: reopening shows the persisted values', async () => {
    const row = await renderRow(makeSet());
    row.edit();
    setInput(row.editForm(), 'weightKg', '99');
    setInput(row.editForm(), 'reps', '3');
    row.cancel();

    // Editor closed — no edit form left behind (the delete control keeps
    // its own form, which is always present).
    expect(findEditForm(row.container)).toBeNull();

    row.edit();
    expect(row.inputValues()).toEqual({ weight: '50', count: '10', rpe: '' });
  });

  it('cancel restores RPE from the persisted set', async () => {
    const row = await renderRow(makeSet({ rpe: 7 }));
    row.edit();
    setInput(row.editForm(), 'rpe', '');
    row.cancel();
    row.edit();
    expect(row.inputValues().rpe).toBe('7');
  });

  it('a confirmed update closes the editor', async () => {
    const row = await renderRow(makeSet());
    row.edit();
    setInput(row.editForm(), 'weightKg', '52.5');

    await act(async () => {
      row.save();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(findEditForm(row.container)).toBeNull();
  });

  it('reopening after a successful save starts from the updated set', async () => {
    const updated = makeSet({ weightKg: 52.5, reps: 8 });
    const row = await renderRow(makeSet());
    row.edit();
    setInput(row.editForm(), 'weightKg', '52.5');
    setInput(row.editForm(), 'reps', '8');

    await act(async () => {
      row.save();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(findEditForm(row.container)).toBeNull();

    // Simulate the post-revalidation refresh delivering the updated set.
    await row.rerender(updated);
    row.edit();
    expect(row.inputValues()).toEqual({ weight: '52.5', count: '8', rpe: '' });
  });

  it('a failed update keeps the editor open with the typed values', async () => {
    updateExecute.mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'Invalid set input.' },
    } satisfies SessionActionState);
    const row = await renderRow(makeSet());
    row.edit();
    setInput(row.editForm(), 'weightKg', '52.5');
    setInput(row.editForm(), 'reps', '8');

    await act(async () => {
      row.save();
      await Promise.resolve();
      await Promise.resolve();
    });

    const form = findEditForm(row.container);
    if (form === null) throw new Error('editor should stay open after a failed update');
    expect((form.querySelector<HTMLInputElement>('input[name="weightKg"]') ?? null)?.value).toBe('52.5');
    expect((form.querySelector<HTMLInputElement>('input[name="reps"]') ?? null)?.value).toBe('8');
  });

  it('nothing resets while the user is editing (unrelated rerender keeps typing)', async () => {
    const row = await renderRow(makeSet());
    row.edit();
    setInput(row.editForm(), 'weightKg', '60');
    // A parent rerender re-delivering the unchanged persisted set must not
    // overwrite the in-progress draft.
    await row.rerender(makeSet());
    expect(row.inputValues()).toEqual({ weight: '60', count: '10', rpe: '' });
  });

  it('duration sets reset the seconds field, and RPE follows the same lifecycle', async () => {
    const duration: WorkoutSessionSetDto = {
      setNumber: 2,
      type: 'duration',
      durationSeconds: 40,
      weightKg: null,
      rpe: 6,
    };
    const row = await renderRow(duration);
    row.edit();
    expect(row.inputValues()).toEqual({ weight: '', count: '40', rpe: '6' });

    setInput(row.editForm(), row.countInputName(), '55');
    setInput(row.editForm(), 'rpe', '8');
    row.cancel();
    row.edit();
    expect(row.inputValues()).toEqual({ weight: '', count: '40', rpe: '6' });

    setInput(row.editForm(), row.countInputName(), '55');
    await act(async () => {
      row.save();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(findEditForm(row.container)).toBeNull();
  });
});

