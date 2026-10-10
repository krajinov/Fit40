/**
 * M18 Slice 4 — Progress surface view mapping
 * (`docs/training-progress.md` §4.4, §4.5, §5, §6.3, §11).
 *
 * The DTO is the Application layer's own contract, so these tests pin exactly
 * what the components may not decide: the 13-week order isn't re-sorted, the
 * current week is the last supplied window, labels are component-formatted
 * (never raw instants), presence (`0 kg × reps` vs absent) is carried rather
 * than inferred, the average keeps the locked basis wording and the Domain's
 * denominator, and no prohibited product vocabulary reaches a rendered string.
 */

import { describe, expect, it, vi } from 'vitest';

import type {
  ProgressActivityDto,
  ProgressActivityWeekDto,
} from '@/application/dto/training-progress';
import {
  NO_AVERAGE_LABEL,
  NO_LOADED_SETS_NOTE,
  SUMMARY_NOTE_EMPTY,
} from '@/features/progress/progress-labels';
import {
  buildProgressView,
  toProgressActivityView,
  type ProgressActivityView,
} from '@/features/progress/progress-view';

/**
 * The composition root reaches the Drizzle repositories; stubbing it at the
 * feature boundary keeps these mapping tests database-free (the history-view
 * pattern). `buildProgressView` is exercised through the same stub.
 */
const { executeMock } = vi.hoisted(() => ({ executeMock: vi.fn() }));
vi.mock('@/features/progress/services', () => ({
  getTrainingProgressActivityUseCase: { execute: executeMock },
}));

/** The 13 UTC Monday starts of the fixed horizon (current week last). */
const WEEK_STARTS = [
  '2026-06-29T00:00:00.000Z',
  '2026-07-06T00:00:00.000Z',
  '2026-07-13T00:00:00.000Z',
  '2026-07-20T00:00:00.000Z',
  '2026-07-27T00:00:00.000Z',
  '2026-08-03T00:00:00.000Z',
  '2026-08-10T00:00:00.000Z',
  '2026-08-17T00:00:00.000Z',
  '2026-08-24T00:00:00.000Z',
  '2026-08-31T00:00:00.000Z',
  '2026-09-07T00:00:00.000Z',
  '2026-09-14T00:00:00.000Z',
  '2026-09-21T00:00:00.000Z',
] as const;

function week(
  index: number,
  completedWorkouts: number,
  loggedSets: number,
  externalLoadVolumeKgReps: number | null,
): ProgressActivityWeekDto {
  const weekStart = WEEK_STARTS[index];
  if (weekStart === undefined) throw new Error(`no week start at ${index}`);
  return { weekStart, completedWorkouts, loggedSets, externalLoadVolumeKgReps };
}

function dto(input: {
  readonly weeks: ReadonlyArray<ProgressActivityWeekDto>;
  readonly totalWorkouts: number;
  readonly totalSets: number;
  readonly totalLoad: number | null;
  readonly average:
    | { readonly workoutsPerWeek: number; readonly denominatorWeeks: number }
    | null;
}): ProgressActivityDto {
  return {
    currentWeekStart: WEEK_STARTS[WEEK_STARTS.length - 1] ?? '',
    weeks: input.weeks,
    totals: {
      completedWorkouts: input.totalWorkouts,
      loggedSets: input.totalSets,
      externalLoadVolumeKgReps: input.totalLoad,
    },
    average: input.average,
  };
}

/** Acceptance dataset A: 28 workouts, 312 sets, 61,200 kg × reps, 27 ÷ 12. */
const DATASET_A_WORKOUTS = [3, 3, 3, 3, 3, 0, 2, 2, 2, 2, 2, 2, 1];
const DATASET_A_SETS = [30, 30, 30, 30, 30, 0, 25, 25, 25, 25, 25, 25, 12];
const DATASET_A_LOAD: ReadonlyArray<number | null> = [
  6_000, 5_460, 5_460, 5_460, 5_460, null, 5_460, 5_460, 5_460, 5_460, 5_460, 5_460, 600,
];

function datasetA(): ProgressActivityDto {
  return dto({
    weeks: WEEK_STARTS.map((_, index) =>
      week(
        index,
        DATASET_A_WORKOUTS[index] ?? 0,
        DATASET_A_SETS[index] ?? 0,
        DATASET_A_LOAD[index] ?? null,
      ),
    ),
    totalWorkouts: 28,
    totalSets: 312,
    totalLoad: 61_200,
    average: { workoutsPerWeek: 27 / 12, denominatorWeeks: 12 },
  });
}

/** Every string a view tree can render, flattened for vocabulary audits. */
function allStrings(view: ProgressActivityView): ReadonlyArray<string> {
  const chartStrings = [view.workoutsChart, view.setsChart, view.externalLoadChart].flatMap(
    (chart) => [
      chart.title,
      chart.caption,
      chart.ariaLabel,
      chart.note ?? '',
      ...chart.points.flatMap((point) => [point.rangeLabel, point.valueLabel]),
    ],
  );
  const summaryStrings = [
    view.summary.title,
    view.summary.averageLabel,
    view.summary.averageCaption ?? '',
    ...view.summary.stats.flatMap((stat) => [stat.label, stat.value]),
  ];
  return [view.emptyNote ?? '', ...chartStrings, ...summaryStrings];
}

describe('toProgressActivityView — weeks and labels', () => {
  it('renders all thirteen weeks oldest → newest with component-formatted ranges', () => {
    const view = toProgressActivityView(datasetA());

    expect(view.workoutsChart.points).toHaveLength(13);
    expect(view.workoutsChart.points[0]?.key).toBe('2026-06-29T00:00:00.000Z');
    expect(view.workoutsChart.points[0]?.rangeLabel).toBe('Jun 29 – Jul 5');
    expect(view.workoutsChart.points.at(-1)?.key).toBe('2026-09-21T00:00:00.000Z');
    expect(view.workoutsChart.points.at(-1)?.rangeLabel).toBe('Sep 21 – Sep 27');
    // Never a raw instant in a label.
    expect(view.workoutsChart.points.every((point) => !point.rangeLabel.includes('T'))).toBe(
      true,
    );
  });

  it('marks only the last supplied week as the current partial week', () => {
    const view = toProgressActivityView(datasetA());

    for (const chart of [view.workoutsChart, view.setsChart, view.externalLoadChart]) {
      expect(chart.points.filter((point) => point.isCurrentWeek)).toHaveLength(1);
      expect(chart.points.at(-1)?.isCurrentWeek).toBe(true);
      expect(chart.points[0]?.isCurrentWeek).toBe(false);
    }
  });

  it('maps each week fact to its value label, including a zero-activity week', () => {
    const view = toProgressActivityView(datasetA());

    expect(view.workoutsChart.points[0]?.valueLabel).toBe('3 workouts');
    expect(view.workoutsChart.points.at(-1)?.valueLabel).toBe('1 workout');
    expect(view.workoutsChart.points[5]?.valueLabel).toBe('0 workouts');
    expect(view.setsChart.points[0]?.valueLabel).toBe('30 sets');
    expect(view.setsChart.points.at(-1)?.valueLabel).toBe('12 sets');
    expect(view.externalLoadChart.points[0]?.valueLabel).toBe('6,000 kg × reps');
  });

  it('keeps a visible floor for zero-value weeks and fills the busiest week', () => {
    const view = toProgressActivityView(datasetA());

    // Workouts: the busiest week (3) fills the bar; a zero week keeps 3px.
    expect(view.workoutsChart.points[0]?.barHeightPx).toBe(100);
    expect(view.workoutsChart.points[5]?.barHeightPx).toBe(3);
    // Sets: 30 is the maximum, so 25 renders proportionally above the floor.
    expect(view.setsChart.points[0]?.barHeightPx).toBe(100);
    expect(view.setsChart.points[6]?.barHeightPx).toBe(83);
    // The interior zero-activity week has no load data either.
    expect(view.externalLoadChart.points[5]?.barHeightPx).toBe(3);
  });
});

describe('toProgressActivityView — external-load presence (B, C)', () => {
  it('carries a genuine 0 kg × reps week as a value, never as absence (C)', () => {
    const weeks = WEEK_STARTS.map((_, index) =>
      index === 3 ? week(index, 1, 3, 0) : week(index, 0, 0, null),
    );
    const view = toProgressActivityView(
      dto({
        weeks,
        totalWorkouts: 1,
        totalSets: 3,
        totalLoad: 0,
        average: { workoutsPerWeek: 1 / 9, denominatorWeeks: 9 },
      }),
    );

    expect(view.externalLoadChart.points[3]?.isAbsent).toBe(false);
    expect(view.externalLoadChart.points[3]?.valueLabel).toBe('0 kg × reps');
    // A genuine zero still only earns the floor bar.
    expect(view.externalLoadChart.points[3]?.barHeightPx).toBe(3);
    // A week with no eligible loaded set is absent, and says so.
    expect(view.externalLoadChart.points[0]?.isAbsent).toBe(true);
    expect(view.externalLoadChart.points[0]?.valueLabel).toBe('No loaded sets');
    // The period has eligible data, so no absence note and a real 0 in the summary.
    expect(view.externalLoadChart.note).toBeNull();
    expect(view.summary.stats[2]).toEqual({
      label: 'External load (kg × reps)',
      value: '0 kg × reps',
    });
  });

  it('states the absence in words when no week carried eligible load (B)', () => {
    const weeks = WEEK_STARTS.map((_, index) =>
      index === 0 ? week(index, 2, 12, null) : week(index, 0, 0, null),
    );
    const view = toProgressActivityView(
      dto({
        weeks,
        totalWorkouts: 2,
        totalSets: 12,
        totalLoad: null,
        average: { workoutsPerWeek: 2 / 12, denominatorWeeks: 12 },
      }),
    );

    expect(view.externalLoadChart.note).toBe(NO_LOADED_SETS_NOTE);
    expect(view.externalLoadChart.points.every((point) => point.isAbsent)).toBe(true);
    expect(
      view.externalLoadChart.points.every((point) => point.valueLabel === 'No loaded sets'),
    ).toBe(true);
    expect(view.summary.stats[2]).toEqual({
      label: 'External load (kg × reps)',
      value: '—',
    });
    // Bodyweight-only training is never reported as zero activity.
    expect(view.workoutsChart.points[0]?.valueLabel).toBe('2 workouts');
    expect(view.workoutsChart.note).toBeNull();
  });
});

describe('toProgressActivityView — summary and average (§4.4, §4.5)', () => {
  it('totals the whole horizon and states the average basis with its denominator', () => {
    const view = toProgressActivityView(datasetA());

    expect(view.summary.stats).toEqual([
      { label: 'Workouts', value: '28' },
      { label: 'Sets', value: '312' },
      { label: 'External load (kg × reps)', value: '61,200 kg × reps' },
    ]);
    expect(view.summary.averageLabel).toBe(
      '2.3 workouts per week on average since your first completed workout in this period',
    );
    expect(view.summary.averageCaption).toBe('Across 12 completed weeks.');
  });

  it('renders the missing-data average copy when the Domain reported no average', () => {
    const weeks = WEEK_STARTS.map((_, index) =>
      index === WEEK_STARTS.length - 1 ? week(index, 1, 8, 200) : week(index, 0, 0, null),
    );
    const view = toProgressActivityView(
      dto({
        weeks,
        totalWorkouts: 1,
        totalSets: 8,
        totalLoad: 200,
        // The first workout is IN the current partial week: no completed week
        // holds one, so the Domain answers null (§4.5).
        average: null,
      }),
    );

    expect(view.summary.averageLabel).toBe(NO_AVERAGE_LABEL);
    expect(view.summary.averageCaption).toBeNull();
    // The totals still include the current partial week.
    expect(view.summary.stats[0]?.value).toBe('1');
  });

  it('renders a single completed week with the singular basis caption', () => {
    const weeks = WEEK_STARTS.map((_, index) =>
      index === 11 ? week(index, 3, 30, 900) : week(index, 0, 0, null),
    );
    const view = toProgressActivityView(
      dto({
        weeks,
        totalWorkouts: 3,
        totalSets: 30,
        totalLoad: 900,
        average: { workoutsPerWeek: 3, denominatorWeeks: 1 },
      }),
    );

    expect(view.summary.averageLabel).toBe(
      '3 workouts per week on average since your first completed workout in this period',
    );
    expect(view.summary.averageCaption).toBe('Across 1 completed week.');
  });
});

describe('toProgressActivityView — empty and degraded states (§10)', () => {
  it('renders thirteen truthful zero weeks plus one factual empty note', () => {
    const weeks = WEEK_STARTS.map((_, index) => week(index, 0, 0, null));
    const view = toProgressActivityView(
      dto({ weeks, totalWorkouts: 0, totalSets: 0, totalLoad: null, average: null }),
    );

    expect(view.emptyNote).toBe(SUMMARY_NOTE_EMPTY);
    expect(view.workoutsChart.points).toHaveLength(13);
    expect(
      view.workoutsChart.points.every((point) => point.valueLabel === '0 workouts'),
    ).toBe(true);
    expect(view.setsChart.points.every((point) => point.valueLabel === '0 sets')).toBe(true);
    expect(view.summary.stats[0]?.value).toBe('0');
    expect(view.summary.averageLabel).toBe(NO_AVERAGE_LABEL);
  });

  it('never shows the empty note while any completed workout exists', () => {
    expect(toProgressActivityView(datasetA()).emptyNote).toBeNull();
  });
});

describe('toProgressActivityView — product vocabulary (§11)', () => {
  it('uses no prohibited wording in any rendered string', () => {
    const emptyWeeks = WEEK_STARTS.map((_, index) => week(index, 0, 0, null));
    const views = [
      toProgressActivityView(datasetA()),
      toProgressActivityView(
        dto({
          weeks: emptyWeeks,
          totalWorkouts: 0,
          totalSets: 0,
          totalLoad: null,
          average: null,
        }),
      ),
    ];
    const rendered = views.flatMap(allStrings).join(' ').toLowerCase();

    for (const banned of [
      'adherence',
      'streak',
      'missed',
      'failed',
      'on track',
      'off track',
      'readiness',
      'fatigue',
      'recovery',
      'score',
      'calorie',
      'weeks you trained',
    ]) {
      expect(rendered).not.toContain(banned);
    }
  });

  it('renders every kilogram figure with the load × reps unit', () => {
    for (const value of allStrings(toProgressActivityView(datasetA()))) {
      let index = value.indexOf('kg');
      while (index !== -1) {
        expect(value.slice(index, index + 9)).toBe('kg × reps');
        index = value.indexOf('kg', index + 1);
      }
    }
  });
});

describe('buildProgressView — loaded and degraded states (§10)', () => {
  const NOW = new Date('2026-09-24T10:00:00.000Z');

  it('maps a successful read to the loaded state and threads the caller clock', async () => {
    executeMock.mockResolvedValue({ ok: true, data: datasetA() });

    const state = await buildProgressView('user-a', NOW);

    expect(executeMock).toHaveBeenCalledWith({ userId: 'user-a', now: NOW });
    expect(state.status).toBe('loaded');
    if (state.status !== 'loaded') return;
    expect(state.data.workoutsChart.points).toHaveLength(13);
  });

  it('degrades a typed rejection to unavailable — never to zero weeks', async () => {
    executeMock.mockResolvedValue({
      ok: false,
      error: { code: 'INVALID_INPUT', message: 'bad user id' },
    });

    const state = await buildProgressView('user-a', NOW);

    expect(state).toEqual({ status: 'unavailable' });
  });

  it('degrades an unexpected failure to unavailable and logs it', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    executeMock.mockRejectedValue(new Error('database unreachable'));

    const state = await buildProgressView('user-a', NOW);

    expect(state).toEqual({ status: 'unavailable' });
    expect(errorSpy).toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});
