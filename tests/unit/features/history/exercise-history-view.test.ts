/**
 * Unit tests for the per-exercise history view assembly.
 *
 * `toExerciseHistoryView` is tested as a pure mapping over fabricated
 * DTOs; `buildExerciseHistoryView` runs the real use case over a mocked
 * feature composition root, mirroring the history-view test approach.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { ExerciseHistoryDto } from '@/application/dto/exercise-history';
import { EXERCISE_HISTORY_OCCURRENCE_LIMIT } from '@/application/dto/exercise-history';

const { historyExecute } = vi.hoisted(() => ({
  historyExecute: vi.fn(),
}));

vi.mock('@/features/history/services', () => ({
  getExerciseHistoryUseCase: { execute: historyExecute },
}));

import {
  buildExerciseHistoryView,
  NO_EXTERNAL_LOAD_IN_PERIOD_NOTE,
  NOT_ENOUGH_LOADED_WORKOUTS_NOTE,
  toComparisonView,
  toExerciseHistoryView,
} from '@/features/history/exercise-history-view';

/**
 * The request clock for `buildExerciseHistoryView` (M18 Slice 8): a Thursday,
 * so the fixed 13-week horizon starts Monday 2026-06-29.
 */
const HISTORY_NOW = new Date('2026-09-24T10:00:00.000Z');

/** The "no comparison" DTO state the non-comparison fixtures carry. */
const INSUFFICIENT_COMPARISON = {
  status: 'insufficient',
  reason: 'fewer_than_two_points',
} as const;

beforeEach(() => {
  vi.clearAllMocks();
});

function historyDto(overrides?: Partial<ExerciseHistoryDto>): ExerciseHistoryDto {
  return {
    exercise: {
      id: 'ex-001',
      name: 'Goblet Squat',
      slug: 'goblet-squat',
      equipment: 'kettlebell',
    },
    entries: [
      {
        sessionId: 'session-new',
        exerciseOrder: 1,
        completedAt: '2026-02-15T11:00:00Z',
        programName: 'Fit40 Beginner Strength',
        workoutName: 'Full Body A',
        prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
        sets: [
          { type: 'reps', setNumber: 1, reps: 10, weightKg: 52.5, rpe: 8 },
          { type: 'reps', setNumber: 2, reps: 10, weightKg: null, rpe: null },
        ],
        workingLoadKg: null,
      },
    ],
    trend: [
      {
        sessionId: 'session-trend',
        exerciseOrder: 1,
        completedAt: '2026-01-15T11:00:00Z',
        workingLoadKg: 50,
        recordKg: null,
      },
    ],
    personalBests: [
      {
        exerciseId: 'ex-001',
        metric: 'max-load',
        value: 82.5,
        sessionId: 'session-owner',
        exerciseOrder: 2,
        setNumber: 3,
        completedAt: '2026-02-15T11:00:00Z',
      },
    ],
    comparison: INSUFFICIENT_COMPARISON,
    isLimited: false,
    ...overrides,
  };
}

/** 50 occurrence stubs — the full bounded read, for the capped-label case. */
const limitedEntries: ExerciseHistoryDto['entries'] = Array.from(
  { length: EXERCISE_HISTORY_OCCURRENCE_LIMIT },
  (_, i) => ({
    sessionId: `session-${i}`,
    exerciseOrder: 1,
    completedAt: '2026-02-15T11:00:00Z',
    programName: 'Fit40 Beginner Strength',
    workoutName: 'Full Body A',
    prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 } as const,
    sets: [
      { type: 'reps', setNumber: 1, reps: 10, weightKg: 52.5, rpe: 8 },
    ],
    workingLoadKg: 52.5,
  }),
);

describe('toExerciseHistoryView', () => {
  it('formats the header, occurrence count, and entry labels truthfully', () => {
    const view = toExerciseHistoryView(historyDto());
    expect(view.heading).toBe('Goblet Squat');
    expect(view.equipmentLabel).toBe('Kettlebell');
    expect(view.occurrenceCountLabel).toBe('1 occurrence');
    expect(view.entries[0]?.completedAtLabel).toBe('Feb 15, 2026');
    expect(view.entries[0]?.programName).toBe('Fit40 Beginner Strength');
    expect(view.entries[0]?.workoutName).toBe('Full Body A');
    expect(view.entries[0]?.prescriptionLabel).toBe('3 × 8–10');
    // A bodyweight set in the occurrence means no truthful single load.
    expect(view.entries[0]?.workingLoadLabel).toBeNull();
  });

  it('formats set lines with the persisted snapshot and RPE only when captured', () => {
    const view = toExerciseHistoryView(historyDto());
    expect(view.entries[0]?.setLines).toEqual(['52.5 kg × 10 @ RPE 8', '10 reps']);
  });

  it('links each occurrence to its owning session by occurrence identity', () => {
    const view = toExerciseHistoryView(historyDto());
    expect(view.entries[0]?.sessionHref).toBe('/history/sessions/session-new');
    expect(view.entries[0]?.key).toBe('session-new#1');
  });

  it('labels the working load when a truthful external load exists', () => {
    const dto = historyDto();
    const first = dto.entries[0];
    if (first === undefined) throw new Error('fixture entry missing');
    const loaded: ExerciseHistoryDto = {
      ...dto,
      entries: [{ ...first, workingLoadKg: 52.5 }],
    };
    const view = toExerciseHistoryView(loaded);
    expect(view.entries[0]?.workingLoadLabel).toBe('Working load 52.5 kg');
  });
});

describe('toExerciseHistoryView — duplicates and empty states', () => {
  it('keeps two occurrences of one exercise as two entries (never collapsed)', () => {
    const dto = historyDto({
      entries: [
        {
          sessionId: 'session-1',
          exerciseOrder: 1,
          completedAt: '2026-02-15T11:00:00Z',
          programName: 'P',
          workoutName: 'W',
          prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
          sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: null }],
          workingLoadKg: 50,
        },
        {
          sessionId: 'session-1',
          exerciseOrder: 2,
          completedAt: '2026-02-15T11:00:00Z',
          programName: 'P',
          workoutName: 'W',
          prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
          sets: [{ type: 'reps', setNumber: 1, reps: 12, weightKg: null, rpe: null }],
          workingLoadKg: null,
        },
      ],
    });

    const view = toExerciseHistoryView(dto);
    expect(view.entries).toHaveLength(2);
    expect(view.entries.map((entry) => entry.key)).toEqual(['session-1#1', 'session-1#2']);
    expect(view.occurrenceCountLabel).toBe('2 occurrences');
  });

  it('omits the trend entirely when there are no entries', () => {
    const view = toExerciseHistoryView(historyDto({ entries: [], trend: [] }));
    expect(view.trend).toBeNull();
  });

  it('flags a no-external-load history instead of fabricating a chart', () => {
    const view = toExerciseHistoryView(
      historyDto({
        entries: [
          {
            sessionId: 'session-bw',
            exerciseOrder: 1,
            completedAt: '2026-02-15T11:00:00Z',
            programName: 'P',
            workoutName: 'W',
            prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
            sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: null, rpe: null }],
            workingLoadKg: null,
          },
        ],
        trend: [],
      }),
    );

    expect(view.trend).not.toBeNull();
    expect(view.trend?.noExternalLoad).toBe(true);
    expect(view.trend?.chartPoints).toBeNull();
    expect(view.trend?.textPoints).toEqual([]);
  });

  it('suppresses the chart below two points but keeps the honest text point', () => {
    const view = toExerciseHistoryView(historyDto());
    expect(view.trend?.chartPoints).toBeNull();
    expect(view.trend?.textPoints).toEqual([
      { key: 'session-trend#1', completedAtLabel: 'Jan 15, 2026', loadLabel: '50 kg', markerLabel: null },
    ]);
  });
});

describe('toExerciseHistoryView — chart geometry', () => {
  it('maps chronological chart geometry for three points with padding', () => {
    const dto = historyDto({
      trend: [
        {
          sessionId: 'session-geo-1',
          exerciseOrder: 1,
          completedAt: '2026-01-01T11:00:00Z',
          workingLoadKg: 40,
          recordKg: null,
        },
        {
          sessionId: 'session-geo-2',
          exerciseOrder: 1,
          completedAt: '2026-02-01T11:00:00Z',
          workingLoadKg: 50,
          recordKg: null,
        },
        {
          sessionId: 'session-geo-3',
          exerciseOrder: 1,
          completedAt: '2026-03-01T11:00:00Z',
          workingLoadKg: 45,
          recordKg: null,
        },
      ],
    });

    const view = toExerciseHistoryView(dto);
    const points = view.trend?.chartPoints;
    expect(points).not.toBeNull();
    if (points === null || points === undefined) return;
    expect(points).toHaveLength(3);
    // Points are already viewBox units (12–88 padding band in a 100×100
    // space) — the component renders them unchanged, never re-scales.
    expect(points[0]?.x).toBe(12);
    expect(points[1]?.x).toBe(50);
    expect(points[2]?.x).toBe(88);
    // min 40 → bottom (88), max 50 → top (12), mid 45 → center (50).
    expect(points[0]?.y).toBe(88);
    expect(points[1]?.y).toBe(12);
    expect(points[2]?.y).toBe(50);
    expect(points[1]?.loadLabel).toBe('50 kg');
  });

  it('renders a flat load history as a horizontal line (never fabricated slope)', () => {
    const dto = historyDto({
      trend: [
        {
          sessionId: 'session-flat-1',
          exerciseOrder: 1,
          completedAt: '2026-01-01T11:00:00Z',
          workingLoadKg: 50,
          recordKg: null,
        },
        {
          sessionId: 'session-flat-2',
          exerciseOrder: 1,
          completedAt: '2026-02-01T11:00:00Z',
          workingLoadKg: 50,
          recordKg: null,
        },
      ],
    });

    const view = toExerciseHistoryView(dto);
    const points = view.trend?.chartPoints;
    expect(points).not.toBeNull();
    if (points === null || points === undefined) return;
    expect(points[0]?.y).toBe(50);
    expect(points[1]?.y).toBe(50);
  });
});

describe('toExerciseHistoryView — occurrence count label', () => {
  it('labels a full bounded read as the latest N occurrences, not a total', () => {
    const dto = historyDto({ isLimited: true, entries: limitedEntries });

    const view = toExerciseHistoryView(dto);
    expect(view.occurrenceCountLabel).toBe('Latest 50 occurrences');
  });

  it('keeps the exact-count wording below the bound', () => {
    const dto = historyDto({ isLimited: false });

    const view = toExerciseHistoryView(dto);
    expect(view.occurrenceCountLabel).toBe('1 occurrence');
  });
});

// ─── Personal Bests (M12) ────────────────────────────────────────────────────

describe('toExerciseHistoryView — personal bests (M12)', () => {
  it('maps the exercise’s records with their labels and owning-session links', () => {
    const view = toExerciseHistoryView(
      historyDto({
        personalBests: [
          {
            exerciseId: 'ex-001',
            metric: 'max-load',
            value: 82.5,
            sessionId: 'session-owner',
            exerciseOrder: 2,
            setNumber: 3,
            completedAt: '2026-02-15T11:00:00Z',
          },
          {
            exerciseId: 'ex-001',
            metric: 'max-bodyweight-reps',
            value: 18,
            sessionId: 'session-body',
            exerciseOrder: 1,
            setNumber: 2,
            completedAt: '2026-01-20T11:00:00Z',
          },
        ],
      }),
    );

    expect(view.personalBests).toEqual([
      {
        key: 'max-load',
        metricLabel: 'Heaviest load',
        valueLabel: '82.5 kg',
        completedAtLabel: 'Feb 15, 2026',
        sessionHref: '/history/sessions/session-owner',
      },
      {
        key: 'max-bodyweight-reps',
        metricLabel: 'Most bodyweight reps',
        valueLabel: '18 reps',
        completedAtLabel: 'Jan 20, 2026',
        sessionHref: '/history/sessions/session-body',
      },
    ]);
  });

  it('maps a single applicable metric as a single entry — no fabricated metrics', () => {
    const view = toExerciseHistoryView(historyDto());

    expect(view.personalBests.map((best) => best.key)).toEqual(['max-load']);
  });

  it('keeps an exercise without records as an empty list, not an error', () => {
    const view = toExerciseHistoryView(historyDto({ personalBests: [] }));

    expect(view.personalBests).toEqual([]);
    // The rest of the screen is unaffected by the missing records.
    expect(view.heading).toBe('Goblet Squat');
    expect(view.entries).toHaveLength(1);
  });
});

describe('buildExerciseHistoryView', () => {
  it('orchestrates the use case and returns the assembled view', async () => {
    historyExecute.mockResolvedValue({ ok: true, data: historyDto() });

    const result = await buildExerciseHistoryView('user-a', 'goblet-squat', HISTORY_NOW);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.heading).toBe('Goblet Squat');
    // The single request clock is threaded through unchanged (M18 Slice 8).
    expect(historyExecute).toHaveBeenCalledWith({
      userId: 'user-a',
      slug: 'goblet-squat',
      now: HISTORY_NOW,
    });
  });

  it('propagates EXERCISE_NOT_FOUND for an unknown slug', async () => {
    historyExecute.mockResolvedValue({
      ok: false,
      error: { code: 'EXERCISE_NOT_FOUND', slug: 'nope', message: 'Exercise "nope" not found' },
    });

    const result = await buildExerciseHistoryView('user-a', 'nope', HISTORY_NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('EXERCISE_NOT_FOUND');
  });

  it('propagates INVALID_INPUT for a malformed userId', async () => {
    historyExecute.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'UserId cannot be empty', field: 'userId' },
    });

    const result = await buildExerciseHistoryView('', 'goblet-squat', HISTORY_NOW);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('INVALID_INPUT');
  });
});



// ─── Personal-record markers (M18 Slice 7) ───────────────────────────────────

describe('toExerciseHistoryView — max-load record markers (M18 Slice 7)', () => {
  const markedTrend: ExerciseHistoryDto['trend'] = [
    {
      sessionId: 'session-record',
      exerciseOrder: 1,
      completedAt: '2026-03-01T11:00:00Z',
      // The occurrence's own plotted load is its MINIMUM set…
      workingLoadKg: 30,
      // …while the record set inside that same workout was heavier.
      recordKg: 45,
    },
    {
      sessionId: 'session-heaviest-but-unmarked',
      exerciseOrder: 1,
      completedAt: '2026-02-01T11:00:00Z',
      // The heaviest point on the whole chart, and still no record.
      workingLoadKg: 60,
      recordKg: null,
    },
  ];

  it('labels a marked point with its record value, never with the plotted load', () => {
    const view = toExerciseHistoryView(historyDto({ trend: markedTrend, isLimited: false }));

    expect(view.trend?.textPoints[0]).toEqual({
      key: 'session-record#1',
      completedAtLabel: 'Mar 1, 2026',
      loadLabel: '30 kg',
      markerLabel: 'Personal best: 45 kg',
    });
  });

  it('never infers a marker from the plotted values', () => {
    // The unmarked point is the heaviest load of the trend and the marked one
    // is lighter, so any value-based inference would mark the wrong point.
    const view = toExerciseHistoryView(historyDto({ trend: markedTrend, isLimited: false }));

    expect(view.trend?.textPoints[1]?.loadLabel).toBe('60 kg');
    expect(view.trend?.textPoints[1]?.markerLabel).toBeNull();
    expect(view.trend?.chartPoints?.[0]?.isRecord).toBe(true);
    expect(view.trend?.chartPoints?.[1]?.isRecord).toBe(false);
  });

  it('keeps the chart geometry and the text loads untouched by the markers', () => {
    const view = toExerciseHistoryView(historyDto({ trend: markedTrend, isLimited: false }));

    expect(view.trend?.chartPoints?.map((point) => [point.x, point.y])).toEqual([
      [12, 88],
      [88, 12],
    ]);
    expect(view.trend?.textPoints.map((point) => point.loadLabel)).toEqual(['30 kg', '60 kg']);
  });
});

// ─── Period comparison (M18 Slice 8, memo §7.4–§7.6) ─────────────────────────

describe('toComparisonView — period first-vs-latest', () => {
  it('renders the period line with both dates and the DTO direction verbatim', () => {
    const view = toComparisonView({
      status: 'compared',
      first: { loadKg: 20, completedAt: '2026-06-02T10:00:00.000Z' },
      latest: { loadKg: 22.5, completedAt: '2026-09-08T10:00:00.000Z' },
      direction: 'increased',
    });

    expect(view.text).toBe(
      'Working load in the last 13 weeks: 20 kg (Jun 2) → 22.5 kg (Sep 8), increased',
    );
    expect(view.isNote).toBe(false);
  });

  it('renders each direction word exactly as the DTO states it', () => {
    for (const direction of ['increased', 'unchanged', 'decreased'] as const) {
      const view = toComparisonView({
        status: 'compared',
        first: { loadKg: 30, completedAt: '2026-06-02T10:00:00.000Z' },
        latest: { loadKg: 30, completedAt: '2026-09-08T10:00:00.000Z' },
        direction,
      });
      expect(view.text.endsWith(`, ${direction}`)).toBe(true);
    }
  });

  it('keeps a genuine 0 kg as a compared value', () => {
    const view = toComparisonView({
      status: 'compared',
      first: { loadKg: 0, completedAt: '2026-06-02T10:00:00.000Z' },
      latest: { loadKg: 0, completedAt: '2026-07-02T10:00:00.000Z' },
      direction: 'unchanged',
    });

    expect(view.text).toContain('0 kg (Jun 2) → 0 kg (Jul 2), unchanged');
  });

  it('renders the locked ≥2-points note when fewer than two points exist', () => {
    const view = toComparisonView({ status: 'insufficient', reason: 'fewer_than_two_points' });

    expect(view).toEqual({ text: NOT_ENOUGH_LOADED_WORKOUTS_NOTE, isNote: true });
    expect(view.text).toBe(
      'Not enough loaded workouts of this exercise in the last 13 weeks to compare.',
    );
  });

  it('renders the no-external-load note for a period of unloaded occurrences', () => {
    const view = toComparisonView({ status: 'insufficient', reason: 'no_external_load' });

    expect(view).toEqual({ text: NO_EXTERNAL_LOAD_IN_PERIOD_NOTE, isNote: true });
    expect(view.text).toBe('No external load was logged for this exercise in the last 13 weeks.');
  });

  it('never states a percentage, an estimate or a quality judgement', () => {
    const rendered = [
      toComparisonView({
        status: 'compared',
        first: { loadKg: 20, completedAt: '2026-06-02T10:00:00.000Z' },
        latest: { loadKg: 25, completedAt: '2026-09-08T10:00:00.000Z' },
        direction: 'increased',
      }),
      toComparisonView({ status: 'insufficient', reason: 'fewer_than_two_points' }),
      toComparisonView({ status: 'insufficient', reason: 'no_external_load' }),
    ]
      .map((view) => view.text)
      .join(' ')
      .toLowerCase();

    for (const banned of [
      '%',
      'percent',
      'e1rm',
      'estimated',
      'stronger',
      'fitter',
      'improvement',
      'on track',
      'score',
      'gain',
    ]) {
      expect(rendered).not.toContain(banned);
    }
  });

  it('exposes the comparison sentence on the assembled view', () => {
    const view = toExerciseHistoryView(
      historyDto({
        comparison: {
          status: 'compared',
          first: { loadKg: 20, completedAt: '2026-06-02T10:00:00.000Z' },
          latest: { loadKg: 22.5, completedAt: '2026-09-08T10:00:00.000Z' },
          direction: 'increased',
        },
      }),
    );

    expect(view.comparison.text).toContain('Working load in the last 13 weeks');
    expect(view.comparison.isNote).toBe(false);
  });
});


