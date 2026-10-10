/**
 * @vitest-environment jsdom
 *
 * M18 Slice 6 — PersonalBestTimeline presentation contract: the EXACT count
 * line, the capped row list in the supplied order, the per-row metric/value,
 * first-exposure vs previous-best wording, both still-stands states, the
 * session links, and the three truthful non-row states (empty period,
 * unresolved catalog identity, failed read) — none of which fabricates a count
 * or a row.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { PersonalBestTimeline } from '@/features/progress/components/PersonalBestTimeline';
import {
  FIRST_TIME_LABEL,
  PERSONAL_BESTS_EMPTY_BODY,
  PERSONAL_BESTS_EMPTY_TITLE,
  PERSONAL_BESTS_TIMELINE_TITLE,
  PERSONAL_BESTS_UNRESOLVED_NOTE,
  SINCE_SURPASSED_LABEL,
  STILL_YOUR_BEST_LABEL,
  UNAVAILABLE_PERSONAL_BESTS_MESSAGE,
} from '@/features/progress/progress-labels';
import type {
  ProgressRecordEventView,
  ProgressRecordTimelineView,
} from '@/features/progress/personal-best-timeline-view';

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

function row(overrides: Partial<ProgressRecordEventView> = {}): ProgressRecordEventView {
  return {
    key: 'row-1',
    exerciseName: 'Goblet Squat',
    metricLabel: 'Heaviest load',
    valueLabel: '25 kg',
    completedAtLabel: 'Sep 21, 2026',
    previousBestLabel: 'Previous best 20 kg',
    standingLabel: STILL_YOUR_BEST_LABEL,
    stillStanding: true,
    sessionHref: '/history/sessions/session-a',
    ...overrides,
  };
}

function timeline(overrides: Partial<ProgressRecordTimelineView> = {}): ProgressRecordTimelineView {
  return {
    title: PERSONAL_BESTS_TIMELINE_TITLE,
    caption: 'Historical events: each row is a personal best you set, not necessarily your current best.',
    recordEventCount: 1,
    countCaption: '1 personal best set in the last 13 weeks.',
    events: [row()],
    capNote: null,
    emptyState: null,
    unresolvedNote: null,
    summaryFragment: '1 personal best',
    ...overrides,
  };
}

function loadedMarkup(view: ProgressRecordTimelineView) {
  return createElement(PersonalBestTimeline, { state: { status: 'loaded', data: view } });
}

describe('PersonalBestTimeline — rows', () => {
  it('renders the exact count, the caption and one row per event with its session link', async () => {
    const container = await render(loadedMarkup(timeline()));

    expect(container.textContent).toContain(PERSONAL_BESTS_TIMELINE_TITLE);
    expect(container.textContent).toContain('1 personal best set in the last 13 weeks.');
    expect(container.textContent).toContain('not necessarily your current best');
    expect(container.textContent).toContain('Goblet Squat');
    expect(container.textContent).toContain('Heaviest load');
    expect(container.textContent).toContain('25 kg');
    expect(container.textContent).toContain('Previous best 20 kg');
    expect(container.textContent).toContain('Sep 21, 2026');
    expect(container.textContent).toContain(STILL_YOUR_BEST_LABEL);
    expect(container.querySelector('a')?.getAttribute('href')).toBe(
      '/history/sessions/session-a',
    );
  });

  it('renders both context states and the first-exposure wording', async () => {
    const container = await render(
      loadedMarkup(
        timeline({
          recordEventCount: 12,
          countCaption: '12 personal bests set in the last 13 weeks.',
          capNote: 'Showing the 10 newest.',
          events: [
            row({ key: 'newest', exerciseName: 'Deadlift', previousBestLabel: FIRST_TIME_LABEL, standingLabel: STILL_YOUR_BEST_LABEL, stillStanding: true }),
            row({ key: 'older', exerciseName: 'Bench Press', previousBestLabel: 'Previous best 60 kg', standingLabel: SINCE_SURPASSED_LABEL, stillStanding: false }),
          ],
        }),
      ),
    );

    // The headline states the EXACT count while only two rows render.
    expect(container.textContent).toContain('12 personal bests set in the last 13 weeks.');
    expect(container.textContent).toContain('Showing the 10 newest.');
    expect(container.textContent).toContain(FIRST_TIME_LABEL);
    expect(container.textContent).toContain('Previous best 60 kg');
    expect(container.textContent).toContain(STILL_YOUR_BEST_LABEL);
    expect(container.textContent).toContain(SINCE_SURPASSED_LABEL);
    expect(container.querySelectorAll('li')).toHaveLength(2);
  });

  it('renders the newest ten rows with the cap note when more events exist', async () => {
    const tenRows = Array.from({ length: 10 }, (_unused, index) =>
      row({
        key: `cap-${index}`,
        exerciseName: `Exercise ${index + 1}`,
        completedAtLabel: `Aug ${index + 1}, 2026`,
      }),
    );
    const container = await render(
      loadedMarkup(
        timeline({
          recordEventCount: 12,
          countCaption: '12 personal bests set in the last 13 weeks.',
          events: tenRows,
          capNote: 'Showing the 10 newest.',
        }),
      ),
    );

    expect(container.querySelectorAll('li')).toHaveLength(10);
    expect(container.textContent).toContain('12 personal bests set in the last 13 weeks.');
    expect(container.textContent).toContain('Showing the 10 newest.');
    // The supplied (chronological, oldest → newest) order is what renders.
    const names = [...container.querySelectorAll('li')].map((item) => item.textContent ?? '');
    expect(names[0]).toContain('Exercise 1');
    expect(names[9]).toContain('Exercise 10');
  });

  it('renders two rows for two events of the same session with the same link', async () => {
    const container = await render(
      loadedMarkup(
        timeline({
          recordEventCount: 2,
          events: [
            row({ key: 'same-1', metricLabel: 'Heaviest load' }),
            row({ key: 'same-2', metricLabel: 'Longest duration', valueLabel: '75 sec' }),
          ],
        }),
      ),
    );

    expect(container.querySelectorAll('li')).toHaveLength(2);
    const links = [...container.querySelectorAll('a')].map((anchor) => anchor.getAttribute('href'));
    expect(links).toEqual(['/history/sessions/session-a', '/history/sessions/session-a']);
    expect(container.textContent).toContain('Longest duration');
    expect(container.textContent).toContain('75 sec');
  });
});


describe('PersonalBestTimeline — empty, unresolved and unavailable states', () => {
  it('renders the empty state for a period with no personal best', async () => {
    const container = await render(
      loadedMarkup(
        timeline({
          recordEventCount: 0,
          countCaption: 'No personal bests in the last 13 weeks.',
          events: [],
          emptyState: { title: PERSONAL_BESTS_EMPTY_TITLE, body: PERSONAL_BESTS_EMPTY_BODY },
          summaryFragment: '0 personal bests',
        }),
      ),
    );

    expect(container.textContent).toContain(PERSONAL_BESTS_EMPTY_TITLE);
    expect(container.textContent).toContain(PERSONAL_BESTS_EMPTY_BODY);
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(container.textContent).not.toContain(PERSONAL_BESTS_UNRESOLVED_NOTE);
  });

  it('states the unresolved identity instead of inventing a row or a zero count', async () => {
    const container = await render(
      loadedMarkup(
        timeline({
          recordEventCount: 3,
          countCaption: '3 personal bests set in the last 13 weeks.',
          events: [],
          unresolvedNote: PERSONAL_BESTS_UNRESOLVED_NOTE,
          summaryFragment: '3 personal bests',
        }),
      ),
    );

    expect(container.textContent).toContain('3 personal bests set in the last 13 weeks.');
    expect(container.textContent).toContain(PERSONAL_BESTS_UNRESOLVED_NOTE);
    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(container.textContent).not.toContain(PERSONAL_BESTS_EMPTY_TITLE);
  });

  it('degrades a failed read to its own message without any count', async () => {
    const container = await render(
      createElement(PersonalBestTimeline, { state: { status: 'unavailable' } }),
    );

    expect(container.textContent).toContain(PERSONAL_BESTS_TIMELINE_TITLE);
    expect(container.textContent).toContain(UNAVAILABLE_PERSONAL_BESTS_MESSAGE);
    // Never a fabricated count, a row or the empty copy of a loaded read.
    expect(container.textContent).not.toContain('personal bests set in the last 13 weeks');
    expect(container.textContent).not.toContain('0 personal bests');
    expect(container.textContent).not.toContain(PERSONAL_BESTS_EMPTY_TITLE);
    expect(container.querySelectorAll('li')).toHaveLength(0);
  });
});
