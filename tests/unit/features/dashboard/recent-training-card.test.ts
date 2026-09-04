/**
 * @vitest-environment jsdom
 *
 * Behavioral tests for the Recent Training card's link contract: each row is
 * one semantic link to the completed-session detail page, "View all training
 * history" always points at /history (the dashboard is History's mobile
 * entry point with the tab bar fixed at four items), and a failed history
 * read renders its own truthful state — never the empty one. Rendered with
 * react-dom (React 19 act): the assertions are about rendered anchors and
 * their hrefs, which a pure-function test cannot cover.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { RecentTrainingCard } from '@/features/dashboard/components/RecentTrainingCard';
import type { RecentTrainingState, RecentTrainingSession } from '@/features/dashboard/dashboard-view';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderCard(recentTraining: RecentTrainingState): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(RecentTrainingCard, { recentTraining }));
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

function session(overrides?: Partial<RecentTrainingSession>): RecentTrainingSession {
  return {
    sessionId: 'session-1',
    workoutName: 'Push A',
    programName: 'Program 1',
    completedAtLabel: 'Feb 15, 2026',
    setsLabel: '12 sets',
    ...overrides,
  };
}

const LOADED: RecentTrainingState = {
  status: 'loaded',
  sessions: [session(), session({ sessionId: 'session-2', workoutName: 'Legs B' })],
};

describe('RecentTrainingCard', () => {
  it('renders one row link per session, preserving the delivered order', async () => {
    const container = await renderCard(LOADED);

    const rowLinks = Array.from(
      container.querySelectorAll<HTMLAnchorElement>('ol a[href^="/history/sessions/"]'),
    );
    expect(rowLinks).toHaveLength(2);
    expect(rowLinks[0]?.getAttribute('href')).toBe('/history/sessions/session-1');
    expect(rowLinks[1]?.getAttribute('href')).toBe('/history/sessions/session-2');
    expect(rowLinks[0]?.textContent).toContain('Push A');
    expect(rowLinks[1]?.textContent).toContain('Legs B');
  });

  it('rows show truthful history data: program, set count, and completed date', async () => {
    const container = await renderCard({
      status: 'loaded',
      sessions: [session()],
    });

    const row = container.querySelector<HTMLAnchorElement>('ol a');
    expect(row?.textContent).toContain('Program 1');
    expect(row?.textContent).toContain('12 sets');
    expect(row?.textContent).toContain('Feb 15, 2026');
  });

  it('row links contain no nested interactive elements', async () => {
    const container = await renderCard(LOADED);

    for (const row of container.querySelectorAll('ol a')) {
      expect(row.querySelector('a, button')).toBeNull();
    }
  });

  it('always renders the "View all training history" link to /history', async () => {
    for (const state of [
      LOADED,
      { status: 'loaded', sessions: [] } satisfies RecentTrainingState,
      { status: 'unavailable' } satisfies RecentTrainingState,
    ]) {
      const container = await renderCard(state);
      const viewAll = Array.from(container.querySelectorAll('a')).find(
        (link) => link.textContent === 'View all training history',
      );
      expect(viewAll?.getAttribute('href')).toBe('/history');
    }
  });

  it('empty history renders the concise empty state — not the failure state', async () => {
    const container = await renderCard({ status: 'loaded', sessions: [] });

    expect(container.textContent).toContain('Completed workouts will appear here.');
    expect(container.textContent).not.toContain("Couldn't load recent training.");
    expect(container.querySelector('ol')).toBeNull();
  });

  it('a failed history read renders its own state — never the empty state', async () => {
    const container = await renderCard({ status: 'unavailable' });

    expect(container.textContent).toContain("Couldn't load recent training.");
    expect(container.textContent).not.toContain('Completed workouts will appear here.');
    expect(container.querySelector('ol')).toBeNull();
  });

  it('the card is never hidden behind a responsive class (mobile entry point)', async () => {
    const container = await renderCard(LOADED);

    const section = container.querySelector('section[aria-label="Recent training"]');
    expect(section).not.toBeNull();
    expect(section?.className).not.toMatch(/\bhidden\b/);
  });
});
