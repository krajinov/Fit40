/**
 * @vitest-environment jsdom
 *
 * M18 Slice 4 — ProgressScreen composition and state contract: the loaded
 * surface renders the three charts plus the summary, an empty horizon keeps the
 * truthful zero weeks and adds one piece of factual empty copy, and a failed
 * read degrades every card to its own "Couldn't load …" state — never to zero
 * weeks, which would claim the user did not train.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ProgressScreen } from '@/features/progress/components/ProgressScreen';
import {
  EXTERNAL_LOAD_CHART_TITLE,
  PERSONAL_BESTS_TIMELINE_TITLE,
  SETS_CHART_TITLE,
  SUMMARY_NOTE_EMPTY,
  SUMMARY_TITLE,
  UNAVAILABLE_ACTIVITY_MESSAGE,
  UNAVAILABLE_LOAD_MESSAGE,
  UNAVAILABLE_PERSONAL_BESTS_MESSAGE,
  UNAVAILABLE_SUMMARY_MESSAGE,
  WORKOUTS_CHART_TITLE,
} from '@/features/progress/progress-labels';
import type {
  ProgressRecordTimelineState,
  ProgressRecordTimelineView,
} from '@/features/progress/personal-best-timeline-view';
import type {
  ProgressActivityView,
  ProgressChartPointView,
  ProgressChartView,
} from '@/features/progress/progress-view';

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

function point(
  key: string,
  rangeLabel: string,
  valueLabel: string,
  overrides: Partial<ProgressChartPointView> = {},
): ProgressChartPointView {
  return {
    key,
    rangeLabel,
    valueLabel,
    isCurrentWeek: false,
    isAbsent: false,
    barHeightPx: 50,
    ...overrides,
  };
}

function chartView(
  title: string,
  caption: string,
  ariaLabel: string,
  overrides: Partial<ProgressChartView> = {},
): ProgressChartView {
  return {
    title,
    caption,
    ariaLabel,
    note: null,
    points: [
      point('2026-06-29T00:00:00.000Z', 'Jun 29 – Jul 5', '3 workouts'),
      point('2026-09-21T00:00:00.000Z', 'Sep 21 – Sep 27', '1 workout', {
        isCurrentWeek: true,
      }),
    ],
    ...overrides,
  };
}

function loadedView(overrides: Partial<ProgressActivityView> = {}): ProgressActivityView {
  return {
    emptyNote: null,
    workoutsChart: chartView(
      WORKOUTS_CHART_TITLE,
      'Completed workouts per week.',
      'Completed workouts by week',
    ),
    setsChart: chartView(SETS_CHART_TITLE, 'Logged sets per week.', 'Logged sets by week'),
    externalLoadChart: chartView(
      EXTERNAL_LOAD_CHART_TITLE,
      'External load per week, in kg × reps.',
      'External load by week',
    ),
    summary: {
      title: SUMMARY_TITLE,
      stats: [
        { label: 'Workouts', value: '28' },
        { label: 'Sets', value: '312' },
        { label: 'External load (kg × reps)', value: '61,200 kg × reps' },
      ],
      averageLabel:
        '2.3 workouts per week on average since your first completed workout in this period',
      averageCaption: 'Across 12 completed weeks.',
    },
    ...overrides,
  };
}

/** The timeline the screen renders beside the activity cards (M18 Slice 6). */
function loadedTimeline(overrides: Partial<ProgressRecordTimelineView> = {}): ProgressRecordTimelineState {
  return {
    status: 'loaded',
    data: {
      title: PERSONAL_BESTS_TIMELINE_TITLE,
      caption:
        'Historical events: each row is a personal best you set, not necessarily your current best.',
      recordEventCount: 12,
      countCaption: '12 personal bests set in the last 13 weeks.',
      events: [
        {
          key: 'row-1',
          exerciseName: 'Goblet Squat',
          metricLabel: 'Heaviest load',
          valueLabel: '25 kg',
          completedAtLabel: 'Sep 21, 2026',
          previousBestLabel: 'Previous best 20 kg',
          standingLabel: 'Still your best',
          stillStanding: true,
          sessionHref: '/history/sessions/session-a',
        },
      ],
      capNote: 'Showing the 10 newest.',
      emptyState: null,
      unresolvedNote: null,
      summaryFragment: '12 personal bests',
      ...overrides,
    },
  };
}

const PERSONAL_BESTS_UNAVAILABLE: ProgressRecordTimelineState = { status: 'unavailable' };

describe('ProgressScreen — loaded state', () => {
  it('renders the three charts, the period summary and the personal-best timeline', async () => {
    const container = await render(
      createElement(ProgressScreen, {
        state: { status: 'loaded', data: loadedView() },
        personalBests: loadedTimeline(),
      }),
    );

    expect(container.textContent).toContain(WORKOUTS_CHART_TITLE);
    expect(container.textContent).toContain(SETS_CHART_TITLE);
    expect(container.textContent).toContain(EXTERNAL_LOAD_CHART_TITLE);
    expect(container.textContent).toContain(SUMMARY_TITLE);
    expect(container.textContent).toContain('61,200 kg × reps');
    expect(container.textContent).toContain('Across 12 completed weeks.');
    // The exact PR count reaches the summary as a fragment and the timeline
    // renders its rows.
    expect(container.textContent).toContain('· 12 personal bests');
    expect(container.textContent).toContain(PERSONAL_BESTS_TIMELINE_TITLE);
    expect(container.textContent).toContain('Goblet Squat');
    expect(container.textContent).not.toContain(UNAVAILABLE_ACTIVITY_MESSAGE);
    expect(container.textContent).not.toContain(UNAVAILABLE_PERSONAL_BESTS_MESSAGE);
  });

  it('keeps the activity visible when the personal-best read failed', async () => {
    const container = await render(
      createElement(ProgressScreen, {
        state: { status: 'loaded', data: loadedView() },
        personalBests: PERSONAL_BESTS_UNAVAILABLE,
      }),
    );

    // The completed training the user did keeps rendering …
    expect(container.textContent).toContain('61,200 kg × reps');
    expect(container.textContent).toContain('Completed workouts per week.');
    // … the timeline states its own failure …
    expect(container.textContent).toContain(UNAVAILABLE_PERSONAL_BESTS_MESSAGE);
    // … and no personal-best count is invented anywhere on the page.
    expect(container.textContent).not.toContain('· ');
    expect(container.textContent).not.toContain('0 personal bests');
    expect(container.textContent).not.toContain('personal bests set in the last 13 weeks');
  });

  it('keeps the timeline visible when the activity read failed', async () => {
    const container = await render(
      createElement(ProgressScreen, {
        state: { status: 'unavailable' },
        personalBests: loadedTimeline(),
      }),
    );

    expect(container.textContent).toContain(UNAVAILABLE_ACTIVITY_MESSAGE);
    expect(container.textContent).toContain(PERSONAL_BESTS_TIMELINE_TITLE);
    expect(container.textContent).toContain('12 personal bests set in the last 13 weeks.');
    expect(container.textContent).toContain('Goblet Squat');
    expect(container.textContent).not.toContain(UNAVAILABLE_PERSONAL_BESTS_MESSAGE);
  });

  it('adds one factual empty note for an empty horizon and never hides the weeks', async () => {
    const container = await render(
      createElement(ProgressScreen, {
        state: { status: 'loaded', data: loadedView({ emptyNote: SUMMARY_NOTE_EMPTY }) },
        personalBests: loadedTimeline(),
      }),
    );

    expect(container.textContent).toContain(SUMMARY_NOTE_EMPTY);
    // The charts still render (13 truthful zero weeks in production).
    expect(container.textContent).toContain('Completed workouts per week.');
  });

  it('renders no empty note while the horizon holds training', async () => {
    const container = await render(
      createElement(ProgressScreen, {
        state: { status: 'loaded', data: loadedView() },
        personalBests: loadedTimeline(),
      }),
    );

    expect(container.textContent).not.toContain(SUMMARY_NOTE_EMPTY);
  });
});

describe('ProgressScreen — degraded state', () => {
  it('degrades every card to its own truthful message', async () => {
    const container = await render(
      createElement(ProgressScreen, {
        state: { status: 'unavailable' },
        personalBests: PERSONAL_BESTS_UNAVAILABLE,
      }),
    );

    expect(container.textContent).toContain(UNAVAILABLE_ACTIVITY_MESSAGE);
    expect(container.textContent).toContain(UNAVAILABLE_LOAD_MESSAGE);
    expect(container.textContent).toContain(UNAVAILABLE_SUMMARY_MESSAGE);
    expect(container.textContent).toContain(UNAVAILABLE_PERSONAL_BESTS_MESSAGE);
    // The card titles are preserved so the page keeps its shape.
    expect(container.textContent).toContain(WORKOUTS_CHART_TITLE);
    expect(container.textContent).toContain(SETS_CHART_TITLE);
    expect(container.textContent).toContain(EXTERNAL_LOAD_CHART_TITLE);
    expect(container.textContent).toContain(SUMMARY_TITLE);
    expect(container.textContent).toContain(PERSONAL_BESTS_TIMELINE_TITLE);
  });

  it('never fabricates zero weeks, an average, a volume figure or a PR count', async () => {
    const container = await render(
      createElement(ProgressScreen, {
        state: { status: 'unavailable' },
        personalBests: PERSONAL_BESTS_UNAVAILABLE,
      }),
    );

    expect(container.textContent).not.toContain('0 workouts');
    expect(container.textContent).not.toContain('Average');
    expect(container.textContent).not.toContain('kg × reps');
    // The section heading may name personal bests; no COUNT may be invented.
    expect(container.textContent).not.toContain('personal bests set in the last 13 weeks');
    expect(container.textContent).not.toContain('0 personal bests');
  });
});
