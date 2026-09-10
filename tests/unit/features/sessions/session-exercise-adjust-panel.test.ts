/**
 * @vitest-environment jsdom
 *
 * Wiring tests for the M10 skip panel: both the skip and the unskip path must
 * apply the centralized predicate `shouldRefreshAfterSessionMutationError`
 * (`session-mutation-refresh.ts`) — reloading on all stale server-state
 * outcomes and never on ordinary request/input failures or success. The
 * code-by-code matrix of the predicate itself lives in
 * `session-mutation-refresh.test.ts`. Rendered with react-dom (React 19 act)
 * because the behavior under test is the form action wiring
 * (`useActionState` + `router.refresh()`), which a pure function test cannot
 * cover — same pattern as `session-exercise-swap-panel.test.ts`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { skipExecute, unskipExecute, refreshMock } = vi.hoisted(() => ({
  skipExecute: vi.fn(),
  unskipExecute: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('@/features/sessions/actions/skip-exercise', () => ({
  skipExerciseAction: skipExecute,
}));

vi.mock('@/features/sessions/actions/unskip-exercise', () => ({
  unskipExerciseAction: unskipExecute,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { SessionExerciseAdjustPanel } from '@/features/sessions/components/SessionExerciseAdjustPanel';
import type {
  SessionActionErrorCode,
  SessionActionState,
} from '@/features/sessions/types/session-action-state';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

function errorState(code: SessionActionErrorCode, message: string): SessionActionState {
  return { ok: false, error: { code, message } };
}

interface MountedPanel {
  readonly container: HTMLElement;
  readonly submitSkip: () => Promise<void>;
  readonly submitUnskip: () => Promise<void>;
}

async function renderPanel(state: 'open' | 'skipped'): Promise<MountedPanel> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  const props = {
    sessionId: 's-1',
    exerciseOrder: 2,
    programSlug: 'prog-1',
    weekNumber: 1,
    workoutOrder: 1,
    state,
  };
  await act(async () => {
    root.render(createElement(SessionExerciseAdjustPanel, props));
    // React schedules the root render on a macrotask; yielding to a timer
    // inside the act scope lets that commit happen while still inside
    // act's batching window (no "not wrapped in act" warnings, no flakes).
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  async function submitByButtonLabel(label: string): Promise<void> {
    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => (candidate.textContent ?? '').trim() === label,
    );
    if (!(button instanceof HTMLButtonElement)) throw new Error(`missing "${label}" button`);
    const form = button.form;
    if (!(form instanceof HTMLFormElement)) throw new Error(`missing form of "${label}"`);
    await act(async () => {
      form.requestSubmit(button);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  return {
    container,
    submitSkip: () => submitByButtonLabel('Skip exercise'),
    submitUnskip: () => submitByButtonLabel('Undo skip'),
  };
}

beforeEach(() => {
  skipExecute.mockReset();
  unskipExecute.mockReset();
  refreshMock.mockReset();
  skipExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
  unskipExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
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
  it('renders only the Skip control in the open state', async () => {
    const panel = await renderPanel('open');

    expect(panel.container.textContent).toContain('Skip exercise');
    expect(panel.container.textContent).not.toContain('Undo skip');
  });

  it('renders only the Undo-skip control in the skipped state', async () => {
    const panel = await renderPanel('skipped');

    expect(panel.container.textContent).toContain('Undo skip');
    expect(panel.container.textContent).not.toContain('Skip exercise');
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
    const panel = await renderPanel('open');
    await panel.submitSkip();
    expect(skipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not reload on an ordinary request failure (EXERCISE_LOG_NOT_FOUND)', async () => {
    skipExecute.mockResolvedValue(errorState('EXERCISE_LOG_NOT_FOUND', 'no such occurrence'));
    const panel = await renderPanel('open');
    await panel.submitSkip();
    expect(skipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on a validation error (VALIDATION_ERROR)', async () => {
    skipExecute.mockResolvedValue(errorState('VALIDATION_ERROR', 'invalid input'));
    const panel = await renderPanel('open');
    await panel.submitSkip();
    expect(skipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on success', async () => {
    const panel = await renderPanel('open');
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
    const panel = await renderPanel('skipped');
    await panel.submitUnskip();
    expect(unskipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not reload on an ordinary request failure (EXERCISE_LOG_NOT_FOUND)', async () => {
    unskipExecute.mockResolvedValue(errorState('EXERCISE_LOG_NOT_FOUND', 'no such occurrence'));
    const panel = await renderPanel('skipped');
    await panel.submitUnskip();
    expect(unskipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on a validation error (VALIDATION_ERROR)', async () => {
    unskipExecute.mockResolvedValue(errorState('VALIDATION_ERROR', 'invalid input'));
    const panel = await renderPanel('skipped');
    await panel.submitUnskip();
    expect(unskipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on success', async () => {
    const panel = await renderPanel('skipped');
    await panel.submitUnskip();
    expect(unskipExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
