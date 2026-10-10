/**
 * @vitest-environment jsdom
 *
 * M18 Slice 4 — PeriodSummaryCard presentation contract: factual totals, the
 * §4.5 average basis wording with its exact denominator, the missing-data
 * average copy (never a fabricated zero) and "—" for an absent external-load
 * total.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PeriodSummaryCard } from '@/features/progress/components/PeriodSummaryCard';
import { NO_AVERAGE_LABEL } from '@/features/progress/progress-labels';
import type { ProgressSummaryView } from '@/features/progress/progress-view';

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

function summary(overrides: Partial<ProgressSummaryView> = {}): ProgressSummaryView {
  return {
    title: 'Last 13 weeks',
    stats: [
      { label: 'Workouts', value: '28' },
      { label: 'Sets', value: '312' },
      { label: 'External load (kg × reps)', value: '61,200 kg × reps' },
    ],
    averageLabel:
      '2.3 workouts per week on average since your first completed workout in this period',
    averageCaption: 'Across 12 completed weeks.',
    ...overrides,
  };
}

describe('PeriodSummaryCard', () => {
  it('renders the totals with the load × reps unit and the average basis', async () => {
    const container = await render(
      createElement(PeriodSummaryCard, { summary: summary(), personalBestsNote: null }),
    );

    expect(container.textContent).toContain('Last 13 weeks');
    expect(container.textContent).toContain('28');
    expect(container.textContent).toContain('Workouts');
    expect(container.textContent).toContain('312');
    expect(container.textContent).toContain('Sets');
    expect(container.textContent).toContain('61,200 kg × reps');
    expect(container.textContent).toContain(
      '2.3 workouts per week on average since your first completed workout in this period',
    );
    expect(container.textContent).toContain('Across 12 completed weeks.');
  });

  it('adds the personal-best fragment from the exact period count (M18 Slice 6)', async () => {
    const container = await render(
      createElement(PeriodSummaryCard, {
        summary: summary(),
        personalBestsNote: '12 personal bests',
      }),
    );

    expect(container.textContent).toContain('· 12 personal bests');
    // The totals and the average basis are untouched by the fragment.
    expect(container.textContent).toContain('61,200 kg × reps');
    expect(container.textContent).toContain('Across 12 completed weeks.');
  });

  it('states a genuine zero fragment but no fragment at all when the read is unavailable', async () => {
    const zero = await render(
      createElement(PeriodSummaryCard, { summary: summary(), personalBestsNote: '0 personal bests' }),
    );
    // A true zero is a fact; an unavailable read (rendered below) is not.
    expect(zero.textContent).toContain('· 0 personal bests');

    const unavailable = await render(
      createElement(PeriodSummaryCard, { summary: summary(), personalBestsNote: null }),
    );
    expect(unavailable.textContent).not.toContain('personal best');
  });

  it('renders the missing-data average copy without a denominator caption', async () => {
    const container = await render(
      createElement(PeriodSummaryCard, {
        summary: summary({ averageLabel: NO_AVERAGE_LABEL, averageCaption: null }),
        personalBestsNote: null,
      }),
    );

    expect(container.textContent).toContain(NO_AVERAGE_LABEL);
    expect(container.textContent).not.toContain('Across');
  });

  it('renders "—" for an absent external-load total without inventing a number', async () => {
    const container = await render(
      createElement(PeriodSummaryCard, {
        summary: summary({
          stats: [
            { label: 'Workouts', value: '12' },
            { label: 'Sets', value: '96' },
            { label: 'External load (kg × reps)', value: '—' },
          ],
        }),
        personalBestsNote: null,
      }),
    );

    expect(container.textContent).toContain('External load (kg × reps)');
    expect(container.textContent).toContain('—');
    expect(container.textContent).not.toContain('0 kg × reps');
  });
});
