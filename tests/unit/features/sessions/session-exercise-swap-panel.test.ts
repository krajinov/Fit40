/**
 * @vitest-environment jsdom
 *
 * Wiring tests for the swap panel's stale-state reload (PR #12 Codex P2):
 * both the substitute and the restore path must apply the centralized
 * predicate `shouldRefreshAfterSessionMutationError`
 * (`session-mutation-refresh.ts`) — reloading on all five stale server-state
 * outcomes (`SESSION_MODIFIED`, `SUBSTITUTION_NO_CHANGE`,
 * `EXERCISE_HAS_LOGGED_SETS`, `SESSION_ALREADY_COMPLETED`, `NOT_ENROLLED`)
 * and never on ordinary request/input failures or success. The
 * code-by-code matrix of the predicate itself lives in
 * `session-mutation-refresh.test.ts`. Rendered with react-dom (React 19 act)
 * because the behavior under test is the form action wiring
 * (`useActionState` + `router.refresh()`), which a pure function test cannot
 * cover.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { substituteExecute, restoreExecute, refreshMock } = vi.hoisted(() => ({
  substituteExecute: vi.fn(),
  restoreExecute: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('@/features/sessions/actions/substitute-exercise', () => ({
  substituteExerciseAction: substituteExecute,
}));

vi.mock('@/features/sessions/actions/restore-exercise', () => ({
  restoreExerciseAction: restoreExecute,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import { SessionExerciseSwapPanel } from '@/features/sessions/components/SessionExerciseSwapPanel';
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
  readonly submitSubstitute: () => Promise<void>;
  readonly submitRestore: () => Promise<void>;
}

async function renderPanel(): Promise<MountedPanel> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ container, root });
  const props = {
    sessionId: 's-1',
    exerciseOrder: 1,
    programSlug: 'prog-1',
    weekNumber: 1,
    workoutOrder: 1,
    substitution: {
      canRestore: true,
      candidates: [
        { exerciseId: 'ex-002', name: 'Incline DB Press', metaLabel: 'Dumbbell · Chest' },
      ],
      candidatesLimited: false,
    },
  };
  await act(async () => {
    root.render(createElement(SessionExerciseSwapPanel, props));
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
    // Make the substitute submission a faithful picker submission: check the
    // first candidate radio (the restore form has no radios at all).
    const radio = form.querySelector<HTMLInputElement>('input[name="replacementExerciseId"]');
    if (radio instanceof HTMLInputElement) {
      act(() => {
        radio.click();
      });
    }
    await act(async () => {
      form.requestSubmit(button);
      await Promise.resolve();
      await Promise.resolve();
    });
  }

  return {
    container,
    submitSubstitute: () => submitByButtonLabel('Swap exercise'),
    submitRestore: () => submitByButtonLabel('Restore original exercise'),
  };
}

beforeEach(() => {
  substituteExecute.mockReset();
  restoreExecute.mockReset();
  refreshMock.mockReset();
  substituteExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
  restoreExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
});

afterEach(async () => {
  for (const entry of mounted.splice(0)) {
    await act(async () => {
      entry.root.unmount();
    });
    entry.container.remove();
  }
});

describe('SessionExerciseSwapPanel stale-state reload (substitute path)', () => {
  it.each([
    'SESSION_MODIFIED',
    'SUBSTITUTION_NO_CHANGE',
    'EXERCISE_HAS_LOGGED_SETS',
    'SESSION_ALREADY_COMPLETED',
    'NOT_ENROLLED',
  ] as const)('reloads on stale server-state outcome %s', async (code) => {
    substituteExecute.mockResolvedValue(errorState(code, 'stale server state'));
    const panel = await renderPanel();
    await panel.submitSubstitute();
    expect(substituteExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not reload on an ordinary request failure (EXERCISE_LOG_NOT_FOUND)', async () => {
    substituteExecute.mockResolvedValue(errorState('EXERCISE_LOG_NOT_FOUND', 'no such occurrence'));
    const panel = await renderPanel();
    await panel.submitSubstitute();
    expect(substituteExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on a validation error (VALIDATION_ERROR)', async () => {
    substituteExecute.mockResolvedValue(errorState('VALIDATION_ERROR', 'invalid input'));
    const panel = await renderPanel();
    await panel.submitSubstitute();
    expect(substituteExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on success', async () => {
    const panel = await renderPanel();
    await panel.submitSubstitute();
    expect(substituteExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});

describe('SessionExerciseSwapPanel stale-state reload (restore path)', () => {
  it.each([
    'SESSION_MODIFIED',
    'SUBSTITUTION_NO_CHANGE',
    'EXERCISE_HAS_LOGGED_SETS',
    'SESSION_ALREADY_COMPLETED',
    'NOT_ENROLLED',
  ] as const)('reloads on stale server-state outcome %s', async (code) => {
    restoreExecute.mockResolvedValue(errorState(code, 'stale server state'));
    const panel = await renderPanel();
    await panel.submitRestore();
    expect(restoreExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it('does not reload on an ordinary request failure (EXERCISE_LOG_NOT_FOUND)', async () => {
    restoreExecute.mockResolvedValue(errorState('EXERCISE_LOG_NOT_FOUND', 'no such occurrence'));
    const panel = await renderPanel();
    await panel.submitRestore();
    expect(restoreExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on a validation error (VALIDATION_ERROR)', async () => {
    restoreExecute.mockResolvedValue(errorState('VALIDATION_ERROR', 'invalid input'));
    const panel = await renderPanel();
    await panel.submitRestore();
    expect(restoreExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not reload on success', async () => {
    const panel = await renderPanel();
    await panel.submitRestore();
    expect(restoreExecute).toHaveBeenCalledTimes(1);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
