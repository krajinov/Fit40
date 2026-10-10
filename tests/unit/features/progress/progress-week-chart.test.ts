/**
 * @vitest-environment jsdom
 *
 * M18 Slice 4 — ProgressWeekChart presentation contract: text-first rendering,
 * the current week marked by word and `aria-current`, bars as decoration only,
 * and absent external-load weeks stated in words (never as a fabricated zero).
 * Rendered with react-dom (React 19 act), following the M13 card tests.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ProgressWeekChart } from '@/features/progress/components/ProgressWeekChart';
import {
  NO_LOADED_SETS_NOTE,
  THIS_WEEK_LABEL,
} from '@/features/progress/progress-labels';
import type { ProgressChartView } from '@/features/progress/progress-view';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
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

function chart(overrides: Partial<ProgressChartView> = {}): ProgressChartView {
  return {
    title: 'Completed workouts',
    caption: 'Completed workouts per week.',
    ariaLabel: 'Completed workouts by week',
    note: null,
    points: [
      {
        key: '2026-06-29T00:00:00.000Z',
        rangeLabel: 'Jun 29 – Jul 5',
        valueLabel: '3 workouts',
        isCurrentWeek: false,
        isAbsent: false,
        barHeightPx: 100,
      },
      {
        key: '2026-09-21T00:00:00.000Z',
        rangeLabel: 'Sep 21 – Sep 27',
        valueLabel: '1 workout',
        isCurrentWeek: true,
        isAbsent: false,
        barHeightPx: 33,
      },
    ],
    ...overrides,
  };
}

describe('ProgressWeekChart', () => {
  it('renders the title, caption, an accessible list and every week text', async () => {
    const container = await render(createElement(ProgressWeekChart, { chart: chart() }));

    expect(container.textContent).toContain('Completed workouts');
    expect(container.textContent).toContain('Completed workouts per week.');
    expect(container.textContent).toContain('Jun 29 – Jul 5');
    expect(container.textContent).toContain('3 workouts');
    expect(container.textContent).toContain('1 workout');
    expect(
      container.querySelector('ol[aria-label="Completed workouts by week"]'),
    ).not.toBeNull();
  });

  it('marks the current week by word and aria-current, never by colour alone', async () => {
    const container = await render(createElement(ProgressWeekChart, { chart: chart() }));

    expect(container.textContent).toContain(THIS_WEEK_LABEL);
    const current = container.querySelectorAll('[aria-current="date"]');
    expect(current).toHaveLength(1);
    expect(current[0]?.textContent).toContain('Sep 21 – Sep 27');
  });

  it('renders the bars as decoration with the precomputed heights', async () => {
    const container = await render(createElement(ProgressWeekChart, { chart: chart() }));

    const decoration = container.querySelector('[aria-hidden="true"]');
    expect(decoration).not.toBeNull();
    const bars = decoration?.querySelectorAll('div[style]') ?? [];
    expect(bars).toHaveLength(2);
    expect(bars[0]?.getAttribute('style')).toContain('100px');
    expect(bars[1]?.getAttribute('style')).toContain('33px');
  });

  it('states an absent external-load week in words, never as a zero', async () => {
    const container = await render(
      createElement(ProgressWeekChart, {
        chart: chart({
          title: 'External load',
          ariaLabel: 'External load by week',
          note: NO_LOADED_SETS_NOTE,
          points: [
            {
              key: '2026-06-29T00:00:00.000Z',
              rangeLabel: 'Jun 29 – Jul 5',
              valueLabel: 'No loaded sets',
              isCurrentWeek: false,
              isAbsent: true,
              barHeightPx: 3,
            },
          ],
        }),
      }),
    );

    expect(container.textContent).toContain('No loaded sets');
    expect(container.textContent).toContain(NO_LOADED_SETS_NOTE);
    expect(container.textContent).not.toContain('0 kg');
  });

  it('omits the absence note when the chart carries none', async () => {
    const container = await render(createElement(ProgressWeekChart, { chart: chart() }));

    expect(container.textContent).not.toContain(NO_LOADED_SETS_NOTE);
  });
});
