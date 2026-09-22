/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the M11 removal control: the affordance is driven
 * ENTIRELY by the domain-derived `removalEligibility` the card view carries
 * (never by `source` or set counts), and the centralized
 * `shouldRefreshAfterSessionMutationError` predicate decides reloads.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { removeExecute, refreshMock } = vi.hoisted(() => ({
  removeExecute: vi.fn(),
  refreshMock: vi.fn(),
}));

vi.mock('@/features/sessions/actions/remove-exercise', () => ({
  removeExerciseAction: removeExecute,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ refresh: refreshMock }),
}));

import type { OccurrenceRemovalEligibilityDto } from '@/application/dto/workout-session';
import {
  REMOVAL_BLOCKED_LABEL,
  SessionRemovalControl,
} from '@/features/sessions/components/SessionRemovalControl';
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

const REMOVABLE: OccurrenceRemovalEligibilityDto = { canRemove: true, blockedBy: null };

const BASE_PROPS = {
  sessionId: 's-1',
  exerciseOrder: 2,
  expectedSessionVersion: 7,
  programSlug: 'prog-1',
  weekNumber: 1,
  workoutOrder: 1,
} as const;

async function renderControl(
  removalEligibility: OccurrenceRemovalEligibilityDto,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(SessionRemovalControl, { ...BASE_PROPS, removalEligibility }),
    );
  });
  mounted.push({ container, root });
  return container;
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

describe('SessionRemovalControl — affordance from removalEligibility', () => {
  beforeEach(() => {
    removeExecute.mockReset();
    refreshMock.mockReset();
    removeExecute.mockResolvedValue({ ok: true } satisfies SessionActionState);
  });

  it('renders the quiet Remove control when the domain says the occurrence is removable', async () => {
    const container = await renderControl(REMOVABLE);

    expect(submitButton(container).textContent).toContain('Remove exercise');
  });

  it('submits the trusted command fields with the route coordinates', async () => {
    const container = await renderControl(REMOVABLE);

    await submit(container);

    expect(removeExecute).toHaveBeenCalledTimes(1);
    const fd = removeExecute.mock.calls[0]?.[0] as FormData;
    expect(fd.get('sessionId')).toBe('s-1');
    expect(fd.get('exerciseOrder')).toBe('2');
    expect(fd.get('expectedSessionVersion')).toBe('7');
    expect(fd.get('programSlug')).toBe('prog-1');
    expect(fd.get('weekNumber')).toBe('1');
    expect(fd.get('workoutOrder')).toBe('1');
    // The command carries no domain-derived authority.
    expect(fd.get('occurrenceKey')).toBeNull();
    expect(fd.get('source')).toBeNull();
    expect(fd.get('userId')).toBeNull();
  });

  it('renders the truthful muted copy — and NO control — when logged sets block removal', async () => {
    const container = await renderControl({ canRemove: false, blockedBy: 'logged-sets' });

    expect(container.textContent).toContain(REMOVAL_BLOCKED_LABEL);
    expect(container.querySelector('form')).toBeNull();
    expect(container.textContent).not.toContain('Remove exercise');
  });

  it('renders NOTHING for a template-authored occurrence (Skip/Unskip is its mechanism)', async () => {
    const container = await renderControl({ canRemove: false, blockedBy: 'template-authored' });

    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('form')).toBeNull();
  });

  it('renders NOTHING once the session is completed (mutations are frozen)', async () => {
    const container = await renderControl({ canRemove: false, blockedBy: 'session-completed' });

    expect(container.textContent?.trim()).toBe('');
    expect(container.querySelector('form')).toBeNull();
  });

  it('renders NOTHING for a non-removable occurrence with no recorded block', async () => {
    const container = await renderControl({ canRemove: false, blockedBy: null });

    expect(container.textContent?.trim()).toBe('');
  });

  it('disables the control while the removal is pending', async () => {
    let resolveAction: (state: SessionActionState) => void = () => {};
    removeExecute.mockImplementation(
      () =>
        new Promise<SessionActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const container = await renderControl(REMOVABLE);

    await submit(container);

    expect(submitButton(container).disabled).toBe(true);
    expect(submitButton(container).textContent).toContain('Removing…');

    await act(async () => {
      resolveAction({ ok: true });
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(submitButton(container).disabled).toBe(false);
  });
});

describe('SessionRemovalControl — refresh & error semantics', () => {
  beforeEach(() => {
    removeExecute.mockReset();
    refreshMock.mockReset();
  });

  it.each([
    'SESSION_MODIFIED',
    'SESSION_ALREADY_COMPLETED',
    'NOT_ENROLLED',
    'EXERCISE_HAS_LOGGED_SETS',
  ] as const)('refreshes the route on the stale server-state code %s', async (code) => {
    removeExecute.mockResolvedValue({ ok: false, error: { code, message: `msg ${code}` } });
    const container = await renderControl(REMOVABLE);

    await submit(container);

    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it.each(['INVALID_INPUT', 'SESSION_NOT_FOUND', 'EXERCISE_LOG_NOT_FOUND'] as const)(
    'never refreshes on the ordinary failure %s',
    async (code) => {
      removeExecute.mockResolvedValue({ ok: false, error: { code, message: `msg ${code}` } });
      const container = await renderControl(REMOVABLE);

      await submit(container);

      expect(refreshMock).not.toHaveBeenCalled();
    },
  );

  it('surfaces EXERCISE_NOT_REMOVABLE truthfully and never turns it into a Skip', async () => {
    removeExecute.mockResolvedValue({
      ok: false,
      error: { code: 'EXERCISE_NOT_REMOVABLE', message: 'template-authored' },
    });
    const container = await renderControl(REMOVABLE);

    await submit(container);

    expect(container.textContent).toContain('Only exercises you added during this workout can be removed');
    // Truthful manual-recovery guidance, not a silent conversion.
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it('does not refresh on success', async () => {
    removeExecute.mockResolvedValue({ ok: true });
    const container = await renderControl(REMOVABLE);

    await submit(container);

    expect(refreshMock).not.toHaveBeenCalled();
  });
});
