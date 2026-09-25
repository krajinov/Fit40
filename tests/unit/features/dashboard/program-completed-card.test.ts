/**
 * @vitest-environment jsdom
 *
 * M14 Slice 7 tests for the dashboard's completed-program card: the
 * primary completed-state navigation is "View summary" → the dedicated
 * completion route, "Browse programs" stays, and NO restart control (form,
 * button or action) exists on the dashboard — a locked M14 product
 * decision. Props are unchanged, so no dashboard data flow moved.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ProgramCompletedCard } from '@/features/dashboard/components/ProgramCompletedCard';

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

async function renderCard(): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ProgramCompletedCard, {
        programName: 'Fit40 Beginner Strength',
        programSlug: 'fit40-beginner-strength',
        completedWorkouts: 12,
        totalWorkouts: 12,
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  mounted.push({ container, root });
  return container;
}

describe('ProgramCompletedCard (M14)', () => {
  it('links "View summary" to the M14 completion route as the primary action', async () => {
    const container = await renderCard();

    const summary = container.querySelector<HTMLAnchorElement>(
      'a[href="/programs/fit40-beginner-strength/completed"]',
    );
    expect(summary?.textContent).toBe('View summary');
    expect(summary?.className).toContain('bg-primary');
    expect(summary?.className).toContain('h-[52px]');
  });

  it('keeps "Browse programs" pointing at the catalog', async () => {
    const container = await renderCard();

    const browse = container.querySelector<HTMLAnchorElement>('a[href="/programs"]');
    expect(browse?.textContent).toBe('Browse programs');
  });

  it('renders no restart form, button, or action on the dashboard', async () => {
    const container = await renderCard();

    expect(container.querySelectorAll('form')).toHaveLength(0);
    expect(container.textContent).not.toContain('Start program again');
    expect(container.textContent).not.toContain('Restart');
  });
});