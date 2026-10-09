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
  // Each point carries its (sessionId, exerciseOrder) occurrence identity —
  // one externally loaded occurrence per session here.
  const trendPoints: ExerciseHistoryDto['trend'] = trend.map((point, i) => ({
    sessionId: `session-${i}`,
    exerciseOrder: 1,
    completedAt: point.completedAt,
    workingLoadKg: point.workingLoadKg,
    recordKg: null,
  }));
  const entries: ExerciseHistoryDto['entries'] = [...trendPoints]
    .reverse()
    .map((point) => ({
      sessionId: point.sessionId,
      exerciseOrder: point.exerciseOrder,
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
    trend: trendPoints,
    personalBests: [],
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

describe('ExerciseHistoryTrend — occurrence-unique keys', () => {
  it('renders two same-session occurrences with distinct keys and no duplicate-key warnings', async () => {
    // Regression: the same exercise twice in ONE completed session — both
    // externally loaded with an identical completedAt. Keys must derive from
    // the (sessionId, exerciseOrder) occurrence identity, never from
    // completedAt (identical here) or chart geometry.
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const dto: ExerciseHistoryDto = {
        exercise: {
          id: 'ex-001',
          name: 'Goblet Squat',
          slug: 'goblet-squat',
          equipment: 'kettlebell',
        },
        // Entries are newest first; within one session the higher position
        // is the later occurrence. Both share the same completedAt.
        entries: [
          {
            sessionId: 'session-dup',
            exerciseOrder: 2,
            completedAt: '2026-02-15T11:00:00Z',
            programName: 'Fit40 Beginner Strength',
            workoutName: 'Full Body A',
            prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 } as const,
            sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 44, rpe: null }],
            workingLoadKg: 44,
          },
          {
            sessionId: 'session-dup',
            exerciseOrder: 1,
            completedAt: '2026-02-15T11:00:00Z',
            programName: 'Fit40 Beginner Strength',
            workoutName: 'Full Body A',
            prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 } as const,
            sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 40, rpe: null }],
            workingLoadKg: 40,
          },
        ],
        // Chronological trend (oldest first): the same two occurrences.
        trend: [
          {
            sessionId: 'session-dup',
            exerciseOrder: 1,
            completedAt: '2026-02-15T11:00:00Z',
            workingLoadKg: 40,
            recordKg: null,
          },
          {
            sessionId: 'session-dup',
            exerciseOrder: 2,
            completedAt: '2026-02-15T11:00:00Z',
            workingLoadKg: 44,
            recordKg: null,
          },
        ],
        personalBests: [],
        isLimited: false,
      };
      const view = toExerciseHistoryView(dto);
      if (view.trend === null) throw new Error('expected a trend view');

      // Both occurrences are preserved, in chronological occurrence order,
      // with distinct identity keys in the accessible text points...
      const textKeys = view.trend.textPoints.map((point) => point.key);
      expect(textKeys).toEqual(['session-dup#1', 'session-dup#2']);
      expect(new Set(textKeys).size).toBe(2);
      // ...and in the chart geometry points.
      const chartKeys = view.trend.chartPoints?.map((point) => point.key) ?? [];
      expect(chartKeys).toEqual(['session-dup#1', 'session-dup#2']);
      expect(new Set(chartKeys).size).toBe(2);

      // React renders both dots and both accessible entries without any
      // duplicate-key collision warning.
      const container = await renderTrend(view.trend);
      expect(container.querySelectorAll('svg circle')).toHaveLength(2);
      expect(container.querySelectorAll('ol > li')).toHaveLength(2);
      expect(errorSpy).not.toHaveBeenCalled();
    } finally {
      errorSpy.mockRestore();
    }
  });
});

describe('ExerciseHistoryTrend — personal-record markers (M18 Slice 7)', () => {
  /**
   * A two-point trend in which only the FIRST (older) workout set a record —
   * and its plotted working load (30 kg) is deliberately LOWER than both the
   * unmarked point (50 kg) and the record set itself (45 kg), so any value- or
   * geometry-based inference would mark the wrong point.
   */
  function markedTrendView() {
    const dto: ExerciseHistoryDto = {
      exercise: {
        id: 'ex-001',
        name: 'Goblet Squat',
        slug: 'goblet-squat',
        equipment: 'kettlebell',
      },
      entries: [
        {
          sessionId: 'session-plain',
          exerciseOrder: 1,
          completedAt: '2026-02-01T11:00:00Z',
          programName: 'Fit40 Beginner Strength',
          workoutName: 'Full Body A',
          prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 } as const,
          sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: null }],
          workingLoadKg: 50,
        },
        {
          sessionId: 'session-record',
          exerciseOrder: 1,
          completedAt: '2026-01-01T11:00:00Z',
          programName: 'Fit40 Beginner Strength',
          workoutName: 'Full Body A',
          prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 } as const,
          sets: [
            { type: 'reps', setNumber: 1, reps: 10, weightKg: 30, rpe: null },
            { type: 'reps', setNumber: 2, reps: 5, weightKg: 45, rpe: null },
          ],
          workingLoadKg: 30,
        },
      ],
      trend: [
        {
          sessionId: 'session-record',
          exerciseOrder: 1,
          completedAt: '2026-01-01T11:00:00Z',
          workingLoadKg: 30,
          recordKg: 45,
        },
        {
          sessionId: 'session-plain',
          exerciseOrder: 1,
          completedAt: '2026-02-01T11:00:00Z',
          workingLoadKg: 50,
          recordKg: null,
        },
      ],
      personalBests: [],
      isLimited: false,
    };

    const view = toExerciseHistoryView(dto);
    if (view.trend === null) throw new Error('expected a trend view');
    return view.trend;
  }

  it('states the record in the text list and keeps the plotted load unchanged', async () => {
    const container = await renderTrend(markedTrendView());

    expect(container.textContent).toContain('Personal best: 45 kg');
    // The point still reports its own working load — the record set's heavier
    // 45 kg is never substituted for the plotted value.
    expect(container.textContent).toContain('30 kg');
    expect(container.textContent).toContain('50 kg');
    expect(container.textContent).not.toContain('Personal best: 30 kg');
  });

  it('emphasizes only the marked dot, as aria-hidden decoration', async () => {
    const container = await renderTrend(markedTrendView());
    const svg = container.querySelector('svg');
    const dots = [...container.querySelectorAll<SVGCircleElement>('svg circle')];

    // The chart stays decoration: the statement lives in the text list.
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
    // Marked dot: larger and accent-filled. Unmarked dot: the base chart dot.
    expect(dots[0]?.getAttribute('r')).toBe('4.5');
    expect(dots[0]?.getAttribute('fill')).toBe('var(--accent-strong)');
    expect(dots[1]?.getAttribute('r')).toBe('3');
    expect(dots[1]?.getAttribute('fill')).toBe('var(--chart-1)');
  });

  it('explains the mark once, and only while a mark is on screen', async () => {
    const marked = await renderTrend(markedTrendView());
    expect(marked.textContent).toContain('A personal best mark means that workout contains a set');

    // No marker, no legend: the screen never explains a mark it does not show.
    const unmarkedTrend = toExerciseHistoryView(
      dtoWithTrend([
        { completedAt: '2026-01-01T11:00:00Z', workingLoadKg: 40 },
        { completedAt: '2026-02-01T11:00:00Z', workingLoadKg: 50 },
      ]),
    );
    if (unmarkedTrend.trend === null) throw new Error('expected a trend view');
    const unmarked = await renderTrend(unmarkedTrend.trend);

    expect(unmarked.textContent).not.toContain('Personal best');
    expect(unmarked.textContent).not.toContain('A personal best mark means');
  });
});

