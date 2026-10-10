/**
 * @vitest-environment jsdom
 *
 * M18 Slice 8 — ExerciseHistoryLoadComparison presentation contract: the
 * component renders the one sentence the view model decided (the period line or
 * the honest insufficiency note) and computes nothing of its own.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ExerciseHistoryLoadComparison } from '@/features/history/components/ExerciseHistoryLoadComparison';
import {
  NO_EXTERNAL_LOAD_IN_PERIOD_NOTE,
  NOT_ENOUGH_LOADED_WORKOUTS_NOTE,
} from '@/features/history/exercise-history-view';

// The view module transitively imports the feature composition root (DB client
// + env validation) via buildExerciseHistoryView. This test exercises the pure
// component and the two note constants only, so the services module is stubbed —
// the same boundary the other history component tests mock.
vi.mock('@/features/history/services', () => ({
  getExerciseHistoryUseCase: { execute: vi.fn() },
}));

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function render(node: ReactNode): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(node);
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

describe('ExerciseHistoryLoadComparison', () => {
  it('renders the period comparison sentence verbatim', async () => {
    const container = await render(
      createElement(ExerciseHistoryLoadComparison, {
        comparison: {
          text: 'Working load in the last 13 weeks: 20 kg (Jun 2) → 22.5 kg (Sep 8), increased',
          isNote: false,
        },
      }),
    );

    expect(container.textContent).toBe(
      'Working load in the last 13 weeks: 20 kg (Jun 2) → 22.5 kg (Sep 8), increased',
    );
  });

  it('renders the ≥2-points note as the only content when no comparison exists', async () => {
    const container = await render(
      createElement(ExerciseHistoryLoadComparison, {
        comparison: { text: NOT_ENOUGH_LOADED_WORKOUTS_NOTE, isNote: true },
      }),
    );

    expect(container.textContent).toBe(NOT_ENOUGH_LOADED_WORKOUTS_NOTE);
    expect(container.textContent).not.toContain('Working load in the last 13 weeks');
  });

  it('renders the no-external-load note for a loaded-looking period', async () => {
    const container = await render(
      createElement(ExerciseHistoryLoadComparison, {
        comparison: { text: NO_EXTERNAL_LOAD_IN_PERIOD_NOTE, isNote: true },
      }),
    );

    expect(container.textContent).toBe(NO_EXTERNAL_LOAD_IN_PERIOD_NOTE);
  });
});
