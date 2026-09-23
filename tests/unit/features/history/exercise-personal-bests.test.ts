/**
 * @vitest-environment jsdom
 *
 * Presentation tests for the per-exercise Personal Bests summary (M12
 * Slice 3). Rendered with react-dom (React 19 act) because the assertions are
 * about rendered markup: only the metrics that exist render, values keep their
 * unit truthfully (a logged 0 kg is a real record), and every tile links to the
 * completed session that owns the record.
 */

import { afterEach, describe, expect, it } from 'vitest';
import { act, createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ExercisePersonalBests } from '@/features/history/components/ExercisePersonalBests';
import { toPersonalBestsView } from '@/features/history/personal-best-view';
import type { PersonalBestDto } from '@/application/dto/personal-records';

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function best(overrides?: Partial<PersonalBestDto>): PersonalBestDto {
  return {
    exerciseId: 'ex-001',
    metric: 'max-load',
    value: 82.5,
    sessionId: 'session-owner',
    exerciseOrder: 1,
    setNumber: 1,
    completedAt: '2026-02-15T11:00:00Z',
    ...overrides,
  };
}

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderPersonalBests(
  personalBests: ReadonlyArray<PersonalBestDto>,
): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(
      createElement(ExercisePersonalBests, {
        personalBests: toPersonalBestsView(personalBests),
      }),
    );
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

describe('ExercisePersonalBests', () => {
  it('renders one tile for the single applicable metric', async () => {
    const container = await renderPersonalBests([best()]);

    expect(container.querySelectorAll('li')).toHaveLength(1);
    expect(container.textContent).toContain('Heaviest load');
    expect(container.textContent).toContain('82.5 kg');
  });

  it('renders a logged 0 kg record truthfully', async () => {
    const container = await renderPersonalBests([best({ value: 0 })]);

    expect(container.textContent).toContain('0 kg');
    expect(container.textContent).not.toContain('No personal bests');
  });

  it('renders a bodyweight-reps record in reps', async () => {
    const container = await renderPersonalBests([
      best({ metric: 'max-bodyweight-reps', value: 18, sessionId: 'session-body' }),
    ]);

    expect(container.textContent).toContain('Most bodyweight reps');
    expect(container.textContent).toContain('18 reps');
  });

  it('renders a duration record in seconds', async () => {
    const container = await renderPersonalBests([
      best({ metric: 'max-duration', value: 75, sessionId: 'session-timed' }),
    ]);

    expect(container.textContent).toContain('Longest duration');
    expect(container.textContent).toContain('75 sec');
  });

  it('renders every applicable metric of a mixed history and no others', async () => {
    const container = await renderPersonalBests([
      best({ metric: 'max-load', value: 80 }),
      best({ metric: 'max-bodyweight-reps', value: 20, sessionId: 'session-body' }),
    ]);

    expect(container.querySelectorAll('li')).toHaveLength(2);
    expect(container.textContent).toContain('80 kg');
    expect(container.textContent).toContain('20 reps');
    // No fabricated tile for the metric this exercise never qualified for.
    expect(container.textContent).not.toContain('Longest duration');
  });

  it('shows the achieved date as the link to the owning completed session', async () => {
    const container = await renderPersonalBests([best({ sessionId: 'session-owner' })]);

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/history/sessions/session-owner');
    // The link text is meaningful on its own — nothing is hover-only.
    expect(link?.textContent).toBe('Achieved Feb 15, 2026');
  });

  it('links to the record’s own session, not to a later equal performance', async () => {
    const container = await renderPersonalBests([
      best({ value: 100, sessionId: 'session-earliest-owner' }),
    ]);

    const link = container.querySelector('a');
    expect(link?.getAttribute('href')).toBe('/history/sessions/session-earliest-owner');
  });

  it('renders a neutral note instead of tiles when no record exists', async () => {
    const container = await renderPersonalBests([]);

    expect(container.querySelectorAll('li')).toHaveLength(0);
    expect(container.querySelectorAll('a')).toHaveLength(0);
    expect(container.textContent).toContain('No personal bests yet');
  });
});
