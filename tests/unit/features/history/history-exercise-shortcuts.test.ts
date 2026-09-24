/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the history screen's "recently trained exercises"
 * shortcuts: the section renders nothing when there is nothing to show and
 * otherwise presents one navigation link per resolved exercise. Rendered with
 * react-dom (React 19 act), same pattern as the other presentation tests.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { HistoryExerciseShortcuts } from '@/features/history/components/HistoryExerciseShortcuts';
import type { HistoryExerciseShortcutView } from '@/features/history/history-view';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderShortcuts(
  shortcuts: ReadonlyArray<HistoryExerciseShortcutView>,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(HistoryExerciseShortcuts, { shortcuts }));
  });
  mounted.push({ container, root });
  return container;
}

afterEach(() => {
  for (const { container, root } of mounted.splice(0)) {
    act(() => {
      root.unmount();
    });
    container.remove();
  }
});

const SHORTCUTS: ReadonlyArray<HistoryExerciseShortcutView> = [
  { exerciseId: 'ex-squat', name: 'Goblet Squat', href: '/history/exercises/goblet-squat' },
  { exerciseId: 'ex-bench', name: 'Dumbbell Bench Press', href: '/history/exercises/dumbbell-bench-press' },
];

describe('HistoryExerciseShortcuts', () => {
  it('renders nothing at all when there are no shortcuts', async () => {
    const container = await renderShortcuts([]);

    expect(container.innerHTML).toBe('');
    expect(container.textContent).not.toContain('Recently trained exercises');
  });

  it('renders the heading and one history link per exercise, in order', async () => {
    const container = await renderShortcuts(SHORTCUTS);

    expect(container.textContent).toContain('Recently trained exercises');

    const links = Array.from(container.querySelectorAll('a'));
    expect(links.map((link) => link.textContent)).toEqual([
      'Goblet Squat',
      'Dumbbell Bench Press',
    ]);
    expect(links.map((link) => link.getAttribute('href'))).toEqual([
      '/history/exercises/goblet-squat',
      '/history/exercises/dumbbell-bench-press',
    ]);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('exposes navigation only — no mutation controls', async () => {
    const container = await renderShortcuts(SHORTCUTS);

    expect(container.querySelectorAll('form')).toHaveLength(0);
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });

  it('gives every shortcut pill the 44px touch-target floor', async () => {
    const container = await renderShortcuts(SHORTCUTS);

    const links = Array.from(container.querySelectorAll('a'));
    expect(links).toHaveLength(2);
    for (const link of links) {
      // `h-11` = 2.75rem = 44px (docs/ui.md): the pill grows to the floor
      // while its radius, border, padding and type stay unchanged.
      expect(link.className).toContain('h-11');
      expect(link.className).not.toContain('h-9');
      expect(link.className).toContain('rounded-pill');
      expect(link.className).toContain('text-sm');
    }
  });
});