/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the M13 insight cards: rendered copy, the eight-bar
 * activity strip with per-week accessible text, personal-best session links
 * and truthful empty/unavailable states — plus the "PROGRAM WEEK"
 * disambiguation of the ordinal progress card. Rendered with react-dom
 * (React 19 act), following recent-training-card.test.ts.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { RecentPersonalBestsCard } from '@/features/dashboard/components/RecentPersonalBestsCard';
import { WeeklyInsightsCard } from '@/features/dashboard/components/WeeklyInsightsCard';
import { WeeklyProgressCard } from '@/features/dashboard/components/WeeklyProgressCard';
import type { WeekSummary } from '@/features/dashboard/dashboard-view';
import {
  PERSONAL_BESTS_EMPTY_MESSAGE,
  RECENT_PERSONAL_BESTS_UNAVAILABLE_MESSAGE,
  STILL_STANDING_PB_CAPTION,
  WEEKLY_INSIGHTS_UNAVAILABLE_MESSAGE,
} from '@/features/dashboard/weekly-insights-view';
import type {
  WeeklyActivityWeekView,
  WeeklyInsightsView,
} from '@/features/dashboard/weekly-insights-view';

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

function stripWeeks(): WeeklyActivityWeekView[] {
  return [
    { weekStart: '2025-12-29T00:00:00.000Z', completedWorkouts: 0, accessibleLabel: 'Week of Dec 29: 0 workouts', isCurrentWeek: false },
    { weekStart: '2026-01-05T00:00:00.000Z', completedWorkouts: 1, accessibleLabel: 'Week of Jan 5: 1 workout', isCurrentWeek: false },
    { weekStart: '2026-01-12T00:00:00.000Z', completedWorkouts: 0, accessibleLabel: 'Week of Jan 12: 0 workouts', isCurrentWeek: false },
    { weekStart: '2026-01-19T00:00:00.000Z', completedWorkouts: 2, accessibleLabel: 'Week of Jan 19: 2 workouts', isCurrentWeek: false },
    { weekStart: '2026-01-26T00:00:00.000Z', completedWorkouts: 0, accessibleLabel: 'Week of Jan 26: 0 workouts', isCurrentWeek: false },
    { weekStart: '2026-02-02T00:00:00.000Z', completedWorkouts: 1, accessibleLabel: 'Week of Feb 2: 1 workout', isCurrentWeek: false },
    { weekStart: '2026-02-09T00:00:00.000Z', completedWorkouts: 2, accessibleLabel: 'Week of Feb 9: 2 workouts', isCurrentWeek: false },
    { weekStart: '2026-02-16T00:00:00.000Z', completedWorkouts: 3, accessibleLabel: 'Week of Feb 16: 3 workouts (this week)', isCurrentWeek: true },
  ];
}

const LOADED: WeeklyInsightsView = {
  weekLabel: 'Week of Feb 16',
  stats: [
    { label: 'Workouts', value: '3' },
    { label: 'Sets', value: '14' },
    { label: 'Current PBs set', value: '1' },
  ],
  comparisonLabel: '+1 workout · +14 sets vs last week',
  activityCaption: 'Weeks run Monday–Sunday (UTC).',
  activityWeeks: stripWeeks(),
  personalBestsCaption:
    'Current bests achieved in the last 8 weeks — only bests that still stand are shown.',
  personalBests: [
    { sessionId: 's1', exerciseName: 'Back Squat', exerciseSlug: 'back-squat', valueLabel: '100 kg', completedAtLabel: 'Feb 16, 2026' },
    { sessionId: 's2', exerciseName: 'Bench Press', exerciseSlug: 'bench-press', valueLabel: '18 reps', completedAtLabel: 'Feb 15, 2026' },
  ],
};

function loaded(): WeeklyInsightsView {
  return { ...LOADED, activityWeeks: stripWeeks(), personalBests: LOADED.personalBests };
}

describe('WeeklyInsightsCard', () => {
  it('renders the This week heading, week label, labelled stats and comparison', async () => {
    const container = await render(
      createElement(WeeklyInsightsCard, { state: { status: 'loaded', data: loaded() } }),
    );

    expect(container.querySelector('h2')?.textContent).toBe('This week');
    expect(container.textContent).toContain('Week of Feb 16');
    expect(container.textContent).toContain('Workouts');
    expect(container.textContent).toContain('Current PBs set');
    expect(container.textContent).toContain('+1 workout · +14 sets vs last week');
    expect(container.textContent).toContain(STILL_STANDING_PB_CAPTION);
  });

  it('server-renders exactly eight bars with per-week accessible text', async () => {
    const container = await render(
      createElement(WeeklyInsightsCard, { state: { status: 'loaded', data: loaded() } }),
    );

    const bars = container.querySelectorAll(
      'ul[aria-label="Weekly training activity"] > li',
    );
    expect(bars).toHaveLength(8);
    const srTexts = Array.from(
      container.querySelectorAll(
        'ul[aria-label="Weekly training activity"] li span.sr-only',
      ),
    ).map((span) => span.textContent);
    expect(srTexts[0]).toBe('Week of Dec 29: 0 workouts');
    expect(srTexts[7]).toBe('Week of Feb 16: 3 workouts (this week)');
    expect(bars[7]?.firstElementChild?.className).toContain('bg-accent-strong');
    expect(bars[0]?.firstElementChild?.className).toContain('bg-accent-tint');
    expect(container.textContent).toContain('Weeks run Monday–Sunday (UTC).');
  });

  it('unavailable renders its own truthful message — never zeros or stats', async () => {
    const container = await render(
      createElement(WeeklyInsightsCard, { state: { status: 'unavailable' } }),
    );

    expect(container.textContent).toContain(WEEKLY_INSIGHTS_UNAVAILABLE_MESSAGE);
    expect(container.textContent).not.toContain('Current PBs set');
    expect(container.querySelector('ul')).toBeNull();
  });
});

describe('RecentPersonalBestsCard', () => {
  it('renders one block link per personal best to its owning session', async () => {
    const container = await render(
      createElement(RecentPersonalBestsCard, {
        state: { status: 'loaded', data: loaded() },
      }),
    );

    const links = Array.from(container.querySelectorAll('a[href^="/history/sessions/"]'));
    expect(links).toHaveLength(2);
    expect(links[0]?.getAttribute('href')).toBe('/history/sessions/s1');
    expect(links[1]?.getAttribute('href')).toBe('/history/sessions/s2');
    expect(links[0]?.textContent).toContain('Back Squat');
    expect(links[0]?.textContent).toContain('100 kg');
    expect(links[0]?.textContent).toContain('Feb 16, 2026');
    for (const row of container.querySelectorAll('li a')) {
      expect(row.querySelector('a, button')).toBeNull();
    }
  });

  it('empty list renders the truthful coming-weeks copy, no fake rows', async () => {
    const container = await render(
      createElement(RecentPersonalBestsCard, {
        state: { status: 'loaded', data: { ...loaded(), personalBests: [] } },
      }),
    );

    expect(container.textContent).toContain(PERSONAL_BESTS_EMPTY_MESSAGE);
    expect(container.querySelector('a')).toBeNull();
  });

  it('unavailable renders its own state, not the empty copy', async () => {
    const container = await render(
      createElement(RecentPersonalBestsCard, { state: { status: 'unavailable' } }),
    );

    expect(container.textContent).toContain(RECENT_PERSONAL_BESTS_UNAVAILABLE_MESSAGE);
    expect(container.textContent).not.toContain(PERSONAL_BESTS_EMPTY_MESSAGE);
    expect(container.querySelector('a')).toBeNull();
  });
});

describe('WeeklyProgressCard — program-week terminology', () => {
  const currentWeek: WeekSummary = {
    weekNumber: 3,
    totalWorkouts: 4,
    completedCount: 2,
    status: 'in-progress',
  };

  it('says PROGRAM WEEK / Week 3, never the calendar "This week"', async () => {
    const container = await render(
      createElement(WeeklyProgressCard, { programName: 'Program 1', currentWeek }),
    );

    expect(container.textContent).toContain('PROGRAM WEEK');
    expect(container.textContent).toContain('Week 3');
    expect(container.textContent).toContain('Program 1: 2 of 4 workouts completed');
    expect(container.textContent).not.toContain('This week');
    expect(container.querySelector('section')?.getAttribute('aria-label')).toBe(
      'Program week',
    );
  });
});