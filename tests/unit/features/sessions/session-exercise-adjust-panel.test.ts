/**
 * @vitest-environment jsdom
 *
 * Wiring tests for the M10 adjustment panel — the skip/unskip paths AND the
 * adjacent-move path (Slice 6) must apply the centralized predicate
 * `shouldRefreshAfterSessionMutationError` (`session-mutation-refresh.ts`):
 * reloading on all stale server-state outcomes and never on ordinary
 * request/input failures or success (the action itself revalidated the
 * session path on success, so the canonical server order arrives via the
 * established revalidation, not a client-side refresh). The code-by-code
 * matrix of the predicate itself lives in `session-mutation-refresh.test.ts`.
 * Rendered with react-dom (React 19 act) because the behavior under test is
 * the form action wiring (`useActionState` + `router.refresh()`), which a
 * pure function test cannot cover — same pattern as
 * `session-exercise-swap-panel.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { skipExecute, unskipExecute, moveExecute, refreshMock } = vi.hoisted(() => ({
  skipExecute: vi.fn(),
  unskipExecute: vi.fn(),
  moveExecute: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('@/features/sessions/actions/skip-exercise', () => ({
  skipExerciseAction: skipExecute,
}));

vi.mock('@/features/sessions/actions/unskip-exercise', () => ({
  unskipExerciseAction: unskipExecute,
}));

vi.mock('@/features/sessions/actions/move-exercise', () => ({
  moveExerciseAction: moveExecute,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { SessionExerciseAdjustPanel } from '@/features/sessions/components/SessionExerciseAdjustPanel';
import type {
  SessionActionErrorCode,
  SessionActionState,
} from '@/features/sessions/types/session-action-state';
import type { SessionAdjustmentView } from '@/features/sessions/session-adjustment-views';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

function errorState(code: SessionActionErrorCode, message: string): SessionActionState {
  return { ok: false, error: { code, message } };
}

interface MoveFlags {
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

/**
 * The view-mapper output under test: the skip state plus the domain's move
 * facts copied verbatim (`canMoveUp`/`canMoveDown`).
 */
function adjustmentView(
  state: SessionAdjustmentView['state'],
  moves: MoveFlags = { canMoveUp: true, canMoveDown: true },
): SessionAdjustmentView {
  return {
    state,
    blockedLabel:
      state === 'blocked-logged-sets'
        ? 'Delete your logged sets to skip this exercise.'
        : null,
    ...moves,
  };
}

interface MountedPanel {
  readonly container: HTMLElement;
  readonly submitSkip: () => Promise<void>;
  readonly submitUnskip: () => Promise<void>;
  readonly submitMoveUp: () => Promise<void>;
  readonly submitMoveDown: () => Promise<void>;
  readonly clickByLabel: (label: string) => void;
}

async function renderPanel(adjustment: SessionAdjustmentView): Promise<MountedPanel> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  const props = {
    sessionId: 's-1',
    exerciseOrder: 2,
    expectedSessionVersion: 0,
    programSlug: 'prog-1',
    weekNumber: 1,
    workoutOrder: 1,
    adjustment,
  };
  await act(async () => {
    root.render(createElement(SessionExerciseAdjustPanel, props));
    // React schedules the root render on a macrotask; yielding to a timer
    // inside the act scope lets that commit happen while still inside
    // act's batching window (no "not wrapped in act" warnings, no flakes).
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  async function submitByButtonLabel(label: string): Promise<void> {
    const button = buttonByLabel(container, label);
    const form = button.form;
    if (!(form instanceof HTMLFormElement)) throw new Error(`missing form of "${label}"`);
    await act(async () => {
      form.requestSubmit(button);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  /** A realistic user click — unlike requestSubmit, a no-op on a disabled button. */
  function clickByLabel(label: string): void {
    const button = buttonByLabel(container, label);
    act(() => {
      button.click();
    });
  }

  return {
    container,
    submitSkip: () => submitByButtonLabel('Skip exercise'),
    submitUnskip: () => submitByButtonLabel('Undo skip'),
    submitMoveUp: () => submitByButtonLabel('Move up'),
    submitMoveDown: () => submitByButtonLabel('Move down'),
    clickByLabel,
  };
}

function buttonByLabel(container: HTMLElement, label: string): HTMLButtonElement {
  const button = Array.from(container.querySelectorAll('button')).find(
    (candidate) => (candidate.textContent ?? '').trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`missing "${label}" button`);
  return button;
}

/** The FormData the mocked action received for a given call index. */
function submittedFormData(mock: ReturnType<typeof vi.fn>, call = 0): FormData {
  return mock.mock.calls[call]?.[0] as FormData;
}

beforeEach(() => {
  skipExecute.mockReset();
  unskipExecute.mockReset();
  moveExecute.mockReset();
  refreshMock.mockReset();
  skipExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
  unskipExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
  moveExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
});

describe('SessionExerciseAdjustPanel renders by state', () => {
  it('renders the Skip control in the open state', async () => {
    const panel = await renderPanel(adjustmentView('open'));

    expect(panel.container.textContent).toContain('Skip exercise');
    expect(panel.container.textContent).not.toContain('Undo skip');
  });

  it('renders the Undo-skip control in the skipped state', async () => {
    const panel = await renderPanel(adjustmentView('skipped'));

    expect(panel.container.textContent).toContain('Undo skip');
    expect(panel.container.textContent).not.toContain('Skip exercise');
  });

  it('renders the blocked copy and no skip control, but keeps the move controls', async () => {
    // Logged sets block the SKIP decision only — they must never hide the
    // move controls (the whole occurrence swaps as one unit).
    const panel = await renderPanel(adjustmentView('blocked-logged-sets'));

    expect(panel.container.textContent).toContain(
      'Delete your logged sets to skip this exercise.',
    );
    expect(panel.container.textContent).not.toContain('Skip exercise');
    expect(panel.container.textContent).toContain('Move up');
    expect(panel.container.textContent).toContain('Move down');
  });

  it('renders no mutation controls in the hidden state', async () => {
    const panel = await renderPanel(
      adjustmentView('hidden', { canMoveUp: false, canMoveDown: false }),
    );

    expect(panel.container.textContent).not.toContain('Skip exercise');
    expect(panel.container.textContent).not.toContain('Undo skip');
    expect(panel.container.textContent).not.toContain('Move up');
    expect(panel.container.textContent).not.toContain('Move down');
  });

  it('renders no move controls for a single-occurrence panel', async () => {
    const panel = await renderPanel(
      adjustmentView('open', { canMoveUp: false, canMoveDown: false }),
    );

    expect(panel.container.textContent).toContain('Skip exercise');
    expect(panel.container.textContent).not.toContain('Move up');
    expect(panel.container.textContent).not.toContain('Move down');
  });

  it('renders only Move down when the domain says the occurrence is first', async () => {
    const panel = await renderPanel(
      adjustmentView('open', { canMoveUp: false, canMoveDown: true }),
    );

    expect(panel.container.textContent).not.toContain('Move up');
    expect(panel.container.textContent).toContain('Move down');
  });

  it('renders only Move up when the domain says the occurrence is last', async () => {
    const panel = await renderPanel(
      adjustmentView('open', { canMoveUp: true, canMoveDown: false }),
    );

    expect(panel.container.textContent).toContain('Move up');
    expect(panel.container.textContent).not.toContain('Move down');
  });

  it('keeps move controls on a skipped occurrence (a skip may still move)', async () => {
    const panel = await renderPanel(adjustmentView('skipped'));

    expect(panel.container.textContent).toContain('Undo skip');
    expect(panel.container.textContent).toContain('Move up');
    expect(panel.container.textContent).toContain('Move down');
  });
});

describe('SessionExerciseAdjustPanel move submissions', () => {
  it('submits Move up with the exact up direction and the occurrence coordinates', async () => {
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveUp();

    expect(moveExecute).toHaveBeenCalledTimes(1);
    const formData = submittedFormData(moveExecute);
    expect(formData.get('direction')).toBe('up');
    expect(formData.get('sessionId')).toBe('s-1');
    expect(formData.get('exerciseOrder')).toBe('2');
    expect(formData.get('programSlug')).toBe('prog-1');
    expect(formData.get('weekNumber')).toBe('1');
    expect(formData.get('workoutOrder')).toBe('1');
  });

  it('submits Move down with the exact down direction', async () => {
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveDown();

    expect(moveExecute).toHaveBeenCalledTimes(1);
    expect(submittedFormData(moveExecute).get('direction')).toBe('down');
  });

  it('a move never submits the skip action', async () => {
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveUp();

    expect(moveExecute).toHaveBeenCalledTimes(1);
    expect(skipExecute).not.toHaveBeenCalled();
    expect(unskipExecute).not.toHaveBeenCalled();
  });

  it('reloads on MOVE_OUT_OF_RANGE through the centralized stale-state predicate', async () => {
    moveExecute.mockResolvedValue(errorState('MOVE_OUT_OF_RANGE', 'stale boundary'));
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveUp();

    expect(moveExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    'SESSION_MODIFIED',
    'ADJUSTMENT_NO_CHANGE',
    'EXERCISE_HAS_LOGGED_SETS',
    'SESSION_ALREADY_COMPLETED',
    'NOT_ENROLLED',
  ] as const)('reloads on stale server-state outcome %s (move path)', async (code) => {
    moveExecute.mockResolvedValue(errorState(code, 'stale server state'));
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveUp();

    expect(moveExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it.each(
    ['EXERCISE_LOG_NOT_FOUND', 'VALIDATION_ERROR', 'FORBIDDEN'] as const,
  )('does not reload on ordinary request/input failure %s (move path)', async (code) => {
    moveExecute.mockResolvedValue(errorState(code, 'ordinary failure'));
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveUp();

    expect(moveExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not client-refresh on move success — the action revalidated the session path', async () => {
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveUp();

    expect(moveExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('surfaces the expected move error as user-facing copy', async () => {
    moveExecute.mockResolvedValue(errorState('MOVE_OUT_OF_RANGE', 'stale boundary'));
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveUp();

    expect(panel.container.textContent).toContain('can no longer be moved');
  });
});

describe('SessionExerciseAdjustPanel pending state (Slice 6)', () => {
  it('prevents a duplicate move submission while one is pending', async () => {
    // Hold the move in-flight so the pending state persists across clicks.
    let release: (state: SessionActionState) => void = () => {};
    moveExecute.mockImplementation(
      () =>
        new Promise<SessionActionState>((resolve) => {
          release = resolve;
        }),
    );
    const panel = await renderPanel(adjustmentView('open'));

    await panel.submitMoveUp();
    // Let React commit the combined pending flag: every control of the
    // panel must now be disabled.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    const moveUp = buttonByLabel(panel.container, 'Moving…');
    const skip = buttonByLabel(panel.container, 'Skip exercise');
    expect(moveUp.disabled).toBe(true);
    expect(skip.disabled).toBe(true);

    // A realistic second click on the disabled button is a DOM no-op — it
    // must not submit a duplicate move (or the skip form instead).
    panel.clickByLabel('Moving…');
    panel.clickByLabel('Skip exercise');

    expect(moveExecute).toHaveBeenCalledTimes(1);
    expect(skipExecute).not.toHaveBeenCalled();
    expect(refreshMock).not.toHaveBeenCalled();

    release({ ok: true });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
  });
});

describe('SessionExerciseAdjustPanel stale-state reload (skip path)', () => {
  it.each([
    'SESSION_MODIFIED',
    'ADJUSTMENT_NO_CHANGE',
    'EXERCISE_HAS_LOGGED_SETS',
    'SESSION_ALREADY_COMPLETED',
    'NOT_ENROLLED',
  ] as const)('reloads on stale server-state outcome %s', async (code) => {
    skipExecute.mockResolvedValue(errorState(code, 'stale server state'));
    const panel = await renderPanel(adjustmentView('open'));
    await panel.submitSkip();
    expect(skipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not reload on an ordinary request failure (EXERCISE_LOG_NOT_FOUND)', async () => {
    skipExecute.mockResolvedValue(errorState('EXERCISE_LOG_NOT_FOUND', 'no such occurrence'));
    const panel = await renderPanel(adjustmentView('open'));
    await panel.submitSkip();
    expect(skipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on a validation error (VALIDATION_ERROR)', async () => {
    skipExecute.mockResolvedValue(errorState('VALIDATION_ERROR', 'invalid input'));
    const panel = await renderPanel(adjustmentView('open'));
    await panel.submitSkip();
    expect(skipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on success', async () => {
    const panel = await renderPanel(adjustmentView('open'));
    await panel.submitSkip();
    expect(skipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe('SessionExerciseAdjustPanel stale-state reload (unskip path)', () => {
  it.each([
    'SESSION_MODIFIED',
    'ADJUSTMENT_NO_CHANGE',
    'EXERCISE_HAS_LOGGED_SETS',
    'SESSION_ALREADY_COMPLETED',
    'NOT_ENROLLED',
  ] as const)('reloads on stale server-state outcome %s', async (code) => {
    unskipExecute.mockResolvedValue(errorState(code, 'stale server state'));
    const panel = await renderPanel(adjustmentView('skipped'));
    await panel.submitUnskip();
    expect(unskipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not reload on an ordinary request failure (EXERCISE_LOG_NOT_FOUND)', async () => {
    unskipExecute.mockResolvedValue(errorState('EXERCISE_LOG_NOT_FOUND', 'no such occurrence'));
    const panel = await renderPanel(adjustmentView('skipped'));
    await panel.submitUnskip();
    expect(unskipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on a validation error (VALIDATION_ERROR)', async () => {
    unskipExecute.mockResolvedValue(errorState('VALIDATION_ERROR', 'invalid input'));
    const panel = await renderPanel(adjustmentView('skipped'));
    await panel.submitUnskip();
    expect(unskipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on success', async () => {
    const panel = await renderPanel(adjustmentView('skipped'));
    await panel.submitUnskip();
    expect(unskipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
