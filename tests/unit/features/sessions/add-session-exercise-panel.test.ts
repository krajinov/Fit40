/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the M11 Add Exercise panel: the explicit affordance,
 * display-only catalog search, explicit exercise/scheme selection, the empty
 * explicit prescription fields, the pending guard against duplicate submits,
 * truthful error surfacing, and the ONE-OWNER draft semantics (PR #14 review
 * finding): an expected failure preserves the COMPLETE draft (exercise +
 * scheme + numbers) and a successful Add clears it as one unit, so a stale
 * prescription can never ride along with the next Add. The children
 * (`AddExerciseCatalogOptions`, `AddExercisePrescriptionFields`) and the real
 * `SetLoggerForm` are NOT mocked — the draft under test is the panel's; only
 * the Server Action and the router are mocked.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const routerMocks = vi.hoisted(() => ({ refresh: vi.fn() }));

vi.mock('@/features/sessions/actions/add-exercise', () => ({ addExerciseAction: vi.fn() }));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: routerMocks.refresh }),
}));

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import { addExerciseAction } from '@/features/sessions/actions/add-exercise';
import { ADDED_DURING_WORKOUT_LABEL } from '@/features/sessions/session-provenance-views';
import { AddSessionExercisePanel } from '@/features/sessions/components/AddSessionExercisePanel';
import type { SessionActionState } from '@/features/sessions/types/session-action-state';

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

function summary(id: string, name: string, equipment: ExerciseSummaryDto['equipment']): ExerciseSummaryDto {
  return {
    id,
    name,
    slug: id,
    primaryMuscle: 'quadriceps',
    equipment,
    difficulty: 'beginner',
    movementPattern: 'squat',
  };
}

const CATALOG: ReadonlyArray<ExerciseSummaryDto> = [
  summary('ex-squat', 'Goblet Squat', 'dumbbell'),
  summary('ex-bench', 'Bench Press', 'barbell'),
  summary('ex-row', 'Bent-Over Row', 'barbell'),
];

const BASE_PROPS = {
  sessionId: 's-1',
  expectedSessionVersion: 7,
  programSlug: 'prog-1',
  weekNumber: 1,
  workoutOrder: 2,
} as const;

async function renderPanel(
  addableExercises: ReadonlyArray<ExerciseSummaryDto> = CATALOG,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(AddSessionExercisePanel, { ...BASE_PROPS, addableExercises }));
  });
  mounted.push({ container, root });
  return container;
}

/** Types into a React controlled input the way a real browser does. */
async function typeInto(input: HTMLInputElement, value: string): Promise<void> {
  const nativeSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype,
    'value',
  )?.set;
  if (nativeSetter === undefined) throw new Error('missing native input value setter');
  await act(async () => {
    nativeSetter.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    await Promise.resolve();
  });
}

/** Clicks a React-controlled element the way a real browser does. */
async function click(element: Element): Promise<void> {
  await act(async () => {
    (element as HTMLElement).click();
    await Promise.resolve();
  });
}

function required<T extends Element>(container: HTMLElement, selector: string): T {
  const element = container.querySelector<T>(selector);
  if (element === null) throw new Error(`missing element for ${selector}`);
  return element;
}

function optionIds(container: HTMLElement): string[] {
  return Array.from(container.querySelectorAll<HTMLInputElement>('input[name="exerciseId"]')).map(
    (input) => input.value,
  );
}

/** The checked values of one radio group (order = document order). */
function checkedValues(container: HTMLElement, name: string): string[] {
  return Array.from(
    container.querySelectorAll<HTMLInputElement>(`input[name="${name}"]:checked`),
  ).map((input) => input.value);
}

/** The draft's selected catalog exercise (`null` when nothing is selected). */
function selectedExerciseId(container: HTMLElement): string | null {
  return checkedValues(container, 'exerciseId')[0] ?? null;
}

/** The FormData handed to the Server Action on a given submission. */
function submittedFormData(index: number): FormData {
  const call = vi.mocked(addExerciseAction).mock.calls[index];
  if (call === undefined) throw new Error(`missing addExerciseAction call ${index}`);
  return call[0];
}

/** Fills the explicit prescription for a reps add. */
async function fillRepsFields(container: HTMLElement, sets = '3', targetReps = '8'): Promise<void> {
  await click(required(container, 'input[name="scheme"][value="reps"]'));
  await typeInto(required<HTMLInputElement>(container, 'input[name="sets"]'), sets);
  await typeInto(required<HTMLInputElement>(container, 'input[name="targetReps"]'), targetReps);
}

function submitButton(container: HTMLElement): HTMLButtonElement {
  return required<HTMLButtonElement>(container, 'form button[type="submit"]');
}

function form(container: HTMLElement): HTMLFormElement {
  return required<HTMLFormElement>(container, 'form');
}

/** Submits the native form and flushes the resulting action state. */
async function submitForm(container: HTMLElement): Promise<void> {
  await act(async () => {
    form(container).requestSubmit(submitButton(container));
    await Promise.resolve();
    await Promise.resolve();
  });
}

describe('AddSessionExercisePanel — explicit flow', () => {
  beforeEach(() => {
    vi.mocked(addExerciseAction).mockReset();
    routerMocks.refresh.mockReset();
  });

  it('renders the explicit Add exercise affordance with the catalog', async () => {
    const container = await renderPanel();

    expect(container.textContent).toContain('Add exercise');
    expect(container.textContent).toContain('Add to workout');
    expect(optionIds(container)).toEqual(['ex-squat', 'ex-bench', 'ex-row']);
    // No exercise is auto-selected.
    expect(
      Array.from(container.querySelectorAll<HTMLInputElement>('input[name="exerciseId"]')).some(
        (input) => input.checked,
      ),
    ).toBe(false);
  });

  it('shows no prescription fields until the user explicitly chooses a scheme', async () => {
    const container = await renderPanel();

    expect(container.querySelector('input[name="sets"]')).toBeNull();
    expect(container.querySelector('input[name="targetReps"]')).toBeNull();
    expect(container.querySelector('input[name="durationSeconds"]')).toBeNull();

    await click(required(container, 'input[name="scheme"][value="reps"]'));

    // The fields appear EMPTY: no default 3x10 prescription.
    const sets = required<HTMLInputElement>(container, 'input[name="sets"]');
    const target = required<HTMLInputElement>(container, 'input[name="targetReps"]');
    expect(sets.value).toBe('');
    expect(target.value).toBe('');
    expect(container.querySelector('input[name="durationSeconds"]')).toBeNull();
  });

  it('filters the catalog for display only and never mutates server state', async () => {
    const container = await renderPanel();
    const search = required<HTMLInputElement>(container, 'input[type="search"]');

    await typeInto(search, 'bench');

    expect(optionIds(container)).toEqual(['ex-bench']);
    // Filtering is display-only: no action was invoked.
    expect(addExerciseAction).not.toHaveBeenCalled();

    await typeInto(search, 'barbell');

    expect(optionIds(container)).toEqual(['ex-bench', 'ex-row']);

    await typeInto(search, 'no-such-exercise');

    expect(optionIds(container)).toEqual([]);
    expect(container.textContent).toContain('No exercises match your search.');

    await typeInto(search, '');

    expect(optionIds(container)).toEqual(['ex-squat', 'ex-bench', 'ex-row']);
  });

  it('renders the duration fields when the user chooses Duration', async () => {
    const container = await renderPanel();

    await click(required(container, 'input[name="scheme"][value="duration"]'));

    expect(container.querySelector('input[name="durationSeconds"]')).not.toBeNull();
    expect(container.querySelector('input[name="targetReps"]')).toBeNull();
    expect(required<HTMLInputElement>(container, 'input[name="durationSeconds"]').value).toBe('');
  });

  it('submits the explicit exercise id, session version and route with the trusted route fields', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({ ok: true });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-bench"]'));
    await fillRepsFields(container, '4', '6');
    await submitForm(container);

    expect(addExerciseAction).toHaveBeenCalledTimes(1);
    const submitted = vi.mocked(addExerciseAction).mock.calls[0]?.[0];
    expect(submitted).toBeInstanceOf(FormData);
    const fd = submitted as FormData;
    expect(fd.get('sessionId')).toBe('s-1');
    expect(fd.get('exerciseId')).toBe('ex-bench');
    expect(fd.get('scheme')).toBe('reps');
    expect(fd.get('sets')).toBe('4');
    expect(fd.get('targetReps')).toBe('6');
    expect(fd.get('expectedSessionVersion')).toBe('7');
    expect(fd.get('programSlug')).toBe('prog-1');
    expect(fd.get('weekNumber')).toBe('1');
    expect(fd.get('workoutOrder')).toBe('2');
  });

  it('submits a duration payload', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({ ok: true });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-row"]'));
    await click(required(container, 'input[name="scheme"][value="duration"]'));
    await typeInto(required<HTMLInputElement>(container, 'input[name="sets"]'), '2');
    await typeInto(required<HTMLInputElement>(container, 'input[name="durationSeconds"]'), '45');
    await submitForm(container);

    const fd = vi.mocked(addExerciseAction).mock.calls[0]?.[0] as FormData;
    expect(fd.get('exerciseId')).toBe('ex-row');
    expect(fd.get('scheme')).toBe('duration');
    expect(fd.get('sets')).toBe('2');
    expect(fd.get('durationSeconds')).toBe('45');
    expect(fd.get('targetReps')).toBeNull();
  });

  it('disables the submit control while the action is pending, preventing a duplicate submit', async () => {
    let resolveAction: (state: SessionActionState) => void = () => {};
    vi.mocked(addExerciseAction).mockImplementation(
      () =>
        new Promise<SessionActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );

    const container = await renderPanel();
    await click(required(container, 'input[name="exerciseId"][value="ex-squat"]'));
    await fillRepsFields(container);

    await submitForm(container);

    const button = submitButton(container);
    expect(button.disabled).toBe(true);
    expect(button.textContent).toContain('Adding…');

    // A second submit while pending cannot dispatch another action call — a
    // realistic click is a no-op on the disabled button.
    await click(submitButton(container));
    expect(addExerciseAction).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveAction({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(submitButton(container).disabled).toBe(false);
  });

  it('surfaces an expected error truthfully without silently substituting another exercise', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({
      ok: false,
      error: { code: 'EXERCISE_NOT_FOUND', message: 'gone' },
    });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-squat"]'));
    await fillRepsFields(container);
    await submitForm(container);

    // Truthful catalog error copy — never a silent substitution.
    expect(container.textContent).toContain('no longer available in the exercise catalog');
    // The command carried exactly the exercise the user chose.
    const fd = vi.mocked(addExerciseAction).mock.calls[0]?.[0] as FormData;
    expect(fd.get('exerciseId')).toBe('ex-squat');
  });

  it('maps INVALID_INPUT to truthful copy and keeps the typed prescription', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad' },
    });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-squat"]'));
    await fillRepsFields(container, '5', '12');
    await submitForm(container);

    expect(container.textContent).toContain('Invalid selection');
    // Controlled fields survive the failed submit.
    expect(required<HTMLInputElement>(container, 'input[name="sets"]').value).toBe('5');
    expect(required<HTMLInputElement>(container, 'input[name="targetReps"]').value).toBe('12');
  });

  it('renders an honest empty state when the catalog is unavailable', async () => {
    const container = await renderPanel([]);

    expect(container.textContent).toContain('The exercise catalog is unavailable right now.');
  });

  it('introduces no Remove control (that is the Remove slice)', async () => {
    const container = await renderPanel();

    expect(container.textContent).not.toContain('Remove');
    expect(container.textContent).not.toContain(ADDED_DURING_WORKOUT_LABEL);
  });

  it('preserves the COMPLETE reps draft — exercise, scheme, sets and reps — on an expected failure', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({
      ok: false,
      error: { code: 'VALIDATION_ERROR', message: 'bad' },
    });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-bench"]'));
    await fillRepsFields(container, '5', '12');
    await submitForm(container);

    // The same exercise and the same scheme stay selected…
    expect(selectedExerciseId(container)).toBe('ex-bench');
    expect(checkedValues(container, 'scheme')).toEqual(['reps']);
    // …and the numeric prescription is unchanged: nothing is partially cleared.
    expect(required<HTMLInputElement>(container, 'input[name="sets"]').value).toBe('5');
    expect(required<HTMLInputElement>(container, 'input[name="targetReps"]').value).toBe('12');
  });

  it('preserves the COMPLETE duration draft on an expected failure', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({
      ok: false,
      error: { code: 'EXERCISE_NOT_FOUND', message: 'gone' },
    });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-row"]'));
    await click(required(container, 'input[name="scheme"][value="duration"]'));
    await typeInto(required<HTMLInputElement>(container, 'input[name="sets"]'), '2');
    await typeInto(required<HTMLInputElement>(container, 'input[name="durationSeconds"]'), '45');
    await submitForm(container);

    expect(selectedExerciseId(container)).toBe('ex-row');
    expect(checkedValues(container, 'scheme')).toEqual(['duration']);
    expect(required<HTMLInputElement>(container, 'input[name="sets"]').value).toBe('2');
    expect(required<HTMLInputElement>(container, 'input[name="durationSeconds"]').value).toBe('45');
  });

  it('preserves the complete draft across a stale-state failure that refreshes the route', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({
      ok: false,
      error: { code: 'SESSION_MODIFIED', message: 'stale' },
    });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-squat"]'));
    await fillRepsFields(container, '4', '6');
    await submitForm(container);

    // The centralized stale-state behavior refreshes the route…
    expect(routerMocks.refresh).toHaveBeenCalledTimes(1);
    // …and the panel refreshes nothing on its own: the draft stays complete.
    expect(selectedExerciseId(container)).toBe('ex-squat');
    expect(checkedValues(container, 'scheme')).toEqual(['reps']);
    expect(required<HTMLInputElement>(container, 'input[name="sets"]').value).toBe('4');
    expect(required<HTMLInputElement>(container, 'input[name="targetReps"]').value).toBe('6');
  });

  it('resubmits the preserved draft unchanged after an expected failure', async () => {
    vi.mocked(addExerciseAction)
      .mockResolvedValueOnce({
        ok: false,
        error: { code: 'SESSION_ALREADY_COMPLETED', message: 'done' },
      })
      .mockResolvedValueOnce({ ok: true });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-bench"]'));
    await fillRepsFields(container, '5', '12');
    await submitForm(container);

    // No re-entry: the user just submits the preserved draft again.
    await submitForm(container);

    const retry = submittedFormData(1);
    expect(retry.getAll('exerciseId')).toEqual(['ex-bench']);
    expect(retry.get('scheme')).toBe('reps');
    expect(retry.get('sets')).toBe('5');
    expect(retry.get('targetReps')).toBe('12');
  });

  it('clears the COMPLETE reps draft after a successful Add', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({ ok: true });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-row"]'));
    await fillRepsFields(container, '3', '8');
    await submitForm(container);

    expect(selectedExerciseId(container)).toBeNull();
    expect(checkedValues(container, 'scheme')).toEqual([]);
    // The scheme reset hides the numeric fields: nothing is left to reuse.
    expect(container.querySelector('input[name="sets"]')).toBeNull();
    expect(container.querySelector('input[name="targetReps"]')).toBeNull();
    expect(container.querySelector('input[name="durationSeconds"]')).toBeNull();
  });

  it('clears the duration draft after a successful Add and starts the next Add empty', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({ ok: true });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-bench"]'));
    await click(required(container, 'input[name="scheme"][value="duration"]'));
    await typeInto(required<HTMLInputElement>(container, 'input[name="sets"]'), '2');
    await typeInto(required<HTMLInputElement>(container, 'input[name="durationSeconds"]'), '45');
    await submitForm(container);

    expect(selectedExerciseId(container)).toBeNull();
    expect(checkedValues(container, 'scheme')).toEqual([]);
    expect(container.querySelector('input[name="durationSeconds"]')).toBeNull();

    // Re-choosing the scheme shows EMPTY fields — never the previous 2 x 45s.
    await click(required(container, 'input[name="scheme"][value="duration"]'));

    expect(required<HTMLInputElement>(container, 'input[name="sets"]').value).toBe('');
    expect(required<HTMLInputElement>(container, 'input[name="durationSeconds"]').value).toBe('');
  });

  it('cannot resubmit a stale prescription for the next Add without entering it again', async () => {
    vi.mocked(addExerciseAction).mockResolvedValue({ ok: true });
    const container = await renderPanel();

    await click(required(container, 'input[name="exerciseId"][value="ex-row"]'));
    await fillRepsFields(container, '3', '8');
    await submitForm(container);

    // Second Add: only an exercise is chosen — no prescription re-entered.
    await click(required(container, 'input[name="exerciseId"][value="ex-squat"]'));
    await submitForm(container);

    const second = submittedFormData(1);
    expect(second.getAll('exerciseId')).toEqual(['ex-squat']);
    expect(second.get('scheme')).toBeNull();
    expect(second.get('sets')).toBeNull();
    expect(second.get('targetReps')).toBeNull();
    expect(second.get('durationSeconds')).toBeNull();
  });
});
