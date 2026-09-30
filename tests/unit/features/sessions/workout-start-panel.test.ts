/**
 * @vitest-environment jsdom
 *
 * M17 Slice 11 — the workout detail CTA band. A recorded occurrence states the
 * stored fact and offers `Undo` with its locked supporting copy, and NEVER a
 * Start/Resume link; every other state keeps its existing copy and CTA.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

const { undoActionMock } = vi.hoisted(() => ({ undoActionMock: vi.fn() }));

vi.mock('@/features/schedule/actions/undo-not-performed', () => ({
  undoNotPerformedAction: undoActionMock,
}));

import type { WorkoutCtaState } from '@/features/sessions/workout-detail-view';
import { WorkoutStartPanel } from '@/features/sessions/components/WorkoutStartPanel';

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
} as const;

async function renderPanel(ctaState: WorkoutCtaState): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(WorkoutStartPanel, { ...PROPS, ctaState }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

describe('WorkoutStartPanel', () => {
  it('20. suppresses Start for a recorded occurrence and exposes Undo with the locked copy', async () => {
    const container = await renderPanel('not-performed');

    expect(container.textContent).toContain('Recorded as not performed');
    expect(container.textContent).toContain('It goes back to not started.');
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Undo'),
    ).toBe(true);
    // No Start, no Resume, no session link at all.
    expect(container.textContent).not.toContain('Start workout');
    expect(container.textContent).not.toContain('Resume workout');
    expect(container.querySelector('a[href$="/session"]')).toBeNull();
  });

  it('21. keeps the existing Start CTA when the occurrence is not recorded', async () => {
    const container = await renderPanel('start');

    const start = container.querySelector<HTMLAnchorElement>('a[href$="/session"]');
    expect(start?.textContent).toBe('Start workout');
    expect(container.textContent).not.toContain('Recorded as not performed');
    expect(
      [...container.querySelectorAll('button')].some((button) => button.textContent === 'Undo'),
    ).toBe(false);
  });

  it('keeps Resume and View session states unchanged', async () => {
    const resumed = await renderPanel('resume');
    expect(resumed.querySelector('a[href$="/session"]')?.textContent).toBe('Resume workout');

    const completed = await renderPanel('completed');
    expect(completed.querySelector('a[href$="/session"]')?.textContent).toBe('View session');
  });
});
