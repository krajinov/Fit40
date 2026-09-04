/**
 * @vitest-environment jsdom
 *
 * Regression test for the trend chart's coordinate units: the view model
 * emits SVG coordinates directly in the chart's 100×100 viewBox space, and
 * the component must render them unchanged — a pre-fix version multiplied
 * the already-scaled coordinates by 100, pushing every point outside the
 * viewBox (dots and line invisible). Rendered with react-dom (React 19
 * act), asserting the actual cx/cy attribute values the browser would
 * rasterize; a pure-function test cannot catch a unit re-scaling that only
 * exists at the component boundary.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';

import { ExerciseHistoryTrend } from '@/features/history/components/ExerciseHistoryTrend';
import { toExerciseHistoryView, type ExerciseHistoryTrendView } from '@/features/history/exercise-history-view';
import type { ExerciseHistoryDto } from '@/application/dto/exercise-history';

// The view module transitively imports the feature composition root (DB
// client + env validation) via buildExerciseHistoryView. These tests exercise
// the pure mapper and the component only, so the services module is stubbed
// — the same boundary the exercise-history-view test mocks.
vi.mock('@/features/history/services', () => ({
  getExerciseHistoryUseCase: { execute: vi.fn() },
}));

declare global {
  // React 19's act() environment flag; not part of the DOM lib typings.
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted: { readonly container: HTMLElement; readonly root: Root }[] = [];

async function renderTrend(trend: ExerciseHistoryTrendView): Promise<HTMLElement> {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(createElement(ExerciseHistoryTrend, { trend }));
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

function dtoWithTrend(
  trend: ReadonlyArray<{ completedAt: string; workingLoadKg: number }>,
): ExerciseHistoryDto {
  // A trend is derived from entries (newest first), so the fixture keeps the
  // same occurrences in both shapes: entries reversed, trend chronological.
  const entries: ExerciseHistoryDto['entries'] = [...trend]
    .reverse()
    .map((point, i) => ({
      sessionId: `session-${i}`,
      exerciseOrder: 1,
      completedAt: point.completedAt,
      programName: 'Fit40 Beginner Strength',
      workoutName: 'Full Body A',
      prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 } as const,
      sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: point.workingLoadKg, rpe: null }],
      workingLoadKg: point.workingLoadKg,
    }));

  return {
    exercise: {
      id: 'ex-001',
      name: 'Goblet Squat',
      slug: 'goblet-squat',
      equipment: 'kettlebell',
    },
    entries,
    trend,
    isLimited: false,
  };
}

describe('ExerciseHistoryTrend — viewBox coordinate units', () => {
  it('renders a rising two-point trend as two visible dots inside the viewBox', async () => {
    const view = toExerciseHistoryView(
      dtoWithTrend([
        { completedAt: '2026-01-01T11:00:00Z', workingLoadKg: 40 },
        { completedAt: '2026-02-01T11:00:00Z', workingLoadKg: 50 },
      ]),
    );
    if (view.trend === null) throw new Error('expected a trend view');

    const container = await renderTrend(view.trend);
    const dots = container.querySelectorAll<SVGCircleElement>('svg circle');

    // Two distinct, visible points — not scaled out of the chart.
    expect(dots).toHaveLength(2);
    for (const dot of dots) {
      const cx = Number(dot.getAttribute('cx'));
      const cy = Number(dot.getAttribute('cy'));
      // Inside the 12–88 padding band (and the 0–100 viewBox at large):
      // the pre-fix ×100 bug placed these at 1200–8800, far outside.
      expect(cx).toBeGreaterThanOrEqual(12);
      expect(cx).toBeLessThanOrEqual(88);
      expect(cy).toBeGreaterThanOrEqual(12);
      expect(cy).toBeLessThanOrEqual(88);
      expect(dot.getAttribute('r')).toBe('3');
    }
    // Rising load: the later (heavier) point sits higher on screen.
    const firstY = Number(dots[0]?.getAttribute('cy'));
    const secondY = Number(dots[1]?.getAttribute('cy'));
    expect(secondY).toBeLessThan(firstY);
  });

  it('draws the polyline through the same in-viewBox coordinates', async () => {
    const view = toExerciseHistoryView(
      dtoWithTrend([
        { completedAt: '2026-01-01T11:00:00Z', workingLoadKg: 40 },
        { completedAt: '2026-02-01T11:00:00Z', workingLoadKg: 50 },
      ]),
    );
    if (view.trend?.chartPoints === null || view.trend === null) {
      throw new Error('expected chart points');
    }

    const container = await renderTrend(view.trend);
    const polyline = container.querySelector('svg polyline');
    expect(polyline).not.toBeNull();

    const rendered = (polyline?.getAttribute('points') ?? '')
      .split(' ')
      .map((pair) => pair.split(',').map(Number));
    expect(rendered).toEqual(
      view.trend.chartPoints.map((point) => [point.x, point.y]),
    );
    for (const [x, y] of rendered) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(100);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(100);
    }
  });
});
