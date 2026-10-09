/**
 * M18 Slice 1 — training-progress period aggregation
 * (`docs/training-progress.md` §4.4, §4.5, §6.3).
 *
 * Pins the locked semantics of `src/domain/services/training-progress.ts`:
 * 13-window bucketing with M13's `[weekStart, weekEnd)` UTC rule,
 * external-load presence (null vs genuine `0 kg`), period totals that include
 * the current partial week, and the anchored average whose denominator counts
 * interior AND trailing zero weeks but never pre-tracking weeks.
 *
 * Acceptance datasets A, B, C, M, N, O, P from the memo's §13 matrix are
 * pinned by name; a parity drift-guard compares workouts/sets against the
 * REAL M13 `summarizeTrainingWeeks`. Every instant is a fixed UTC literal, so
 * the suite is independent of the machine's timezone.
 */

import { describe, expect, it } from 'vitest';

import {
  listRecentTrainingWeekWindows,
  summarizeTrainingWeeks,
  type TrainingWeekWindow,
} from '@/domain/services/training-week';
import {
  resolveAverageWorkoutsPerWeek,
  summarizeProgressPeriod,
  summarizeProgressWeeks,
  type ProgressActivityRow,
  type ProgressWeekSummary,
} from '@/domain/services/training-progress';

const MS_PER_DAY = 86_400_000;
const MS_PER_HOUR = 3_600_000;

/** Wednesday 2026-09-23T12:00 UTC — inside the Monday 2026-09-21 week. */
const NOW = new Date('2026-09-23T12:00:00.000Z');

/** The locked M18 horizon: the current partial week + 12 preceding weeks. */
function horizon(): ReadonlyArray<TrainingWeekWindow> {
  return listRecentTrainingWeekWindows(NOW, 13);
}

/** The element at `index`, or a thrown contract error (never `undefined`). */
function item<T>(items: ReadonlyArray<T>, index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`missing item at index ${index}`);
  return value;
}

function row(
  completedAt: Date,
  loggedSets: number,
  externalLoadVolume: number | null,
): ProgressActivityRow {
  return { completedAt, loggedSets, externalLoadVolume };
}

/**
 * A session completed at `windowIndex`, `dayOffset` days after that window's
 * Monday start, at 12:00 UTC (Monday = 0 … Sunday = 6).
 */
function sessionIn(
  windows: ReadonlyArray<TrainingWeekWindow>,
  windowIndex: number,
  dayOffset: number,
  loggedSets: number,
  externalLoadVolume: number | null,
): ProgressActivityRow {
  const window = item(windows, windowIndex);
  return row(
    new Date(window.weekStart.getTime() + dayOffset * MS_PER_DAY + 12 * MS_PER_HOUR),
    loggedSets,
    externalLoadVolume,
  );
}

/** Display-free facts of one summary, for exact `toEqual` assertions. */
function facts(summary: ProgressWeekSummary): {
  completedWorkouts: number;
  loggedSets: number;
  externalLoad: { volumeKgReps: number } | null;
} {
  const { completedWorkouts, loggedSets, externalLoad } = summary;
  return { completedWorkouts, loggedSets, externalLoad };
}

/**
 * Acceptance dataset A (memo §13): 13 mixed weeks —
 * W1: 3 workouts / 30 sets / 6,000 kg × reps;
 * W2–W5: 3 workouts / 30 sets / 5,460 each;
 * W6 (index 5): interior zero week;
 * W7–W12: 2 workouts / 25 sets / 5,460 each;
 * W13 (current partial): 1 workout / 12 sets / 600.
 * Totals: 28 workouts, 312 sets, 61,200 kg × reps; first workout in W1.
 */
function datasetA(windows: ReadonlyArray<TrainingWeekWindow>): ReadonlyArray<ProgressActivityRow> {
  const rows: ProgressActivityRow[] = [];

  // W1 (index 0): 3 × 10 sets × 2,000 = 6,000.
  for (const dayOffset of [0, 2, 4]) {
    rows.push(sessionIn(windows, 0, dayOffset, 10, 2000));
  }
  // W2–W5 (indices 1–4): 3 × 10 sets × 1,820 = 5,460 each.
  for (const index of [1, 2, 3, 4]) {
    for (const dayOffset of [0, 2, 4]) {
      rows.push(sessionIn(windows, index, dayOffset, 10, 1820));
    }
  }
  // Index 5 (W6): interior zero week — deliberately no rows.
  // W7–W12 (indices 6–11): 2 sessions of 12 + 13 sets × 2,730 = 5,460 each.
  for (const index of [6, 7, 8, 9, 10, 11]) {
    rows.push(sessionIn(windows, index, 1, 12, 2730));
    rows.push(sessionIn(windows, index, 3, 13, 2730));
  }
  // W13 (index 12, current partial week): 1 × 12 sets × 600.
  rows.push(sessionIn(windows, 12, 0, 12, 600));

  return rows;
}

/** Acceptance dataset N: 15 workouts, all in W8–W12 (indices 7–11). */
function datasetN(windows: ReadonlyArray<TrainingWeekWindow>): ReadonlyArray<ProgressActivityRow> {
  const rows: ProgressActivityRow[] = [];
  for (const index of [7, 8, 9, 10, 11]) {
    for (const dayOffset of [0, 2, 4]) {
      rows.push(sessionIn(windows, index, dayOffset, 10, 1000));
    }
  }
  return rows;
}

/** Acceptance dataset P: 24 workouts in W1–W8 (indices 0–7), none after. */
function datasetP(windows: ReadonlyArray<TrainingWeekWindow>): ReadonlyArray<ProgressActivityRow> {
  const rows: ProgressActivityRow[] = [];
  for (const index of [0, 1, 2, 3, 4, 5, 6, 7]) {
    for (const dayOffset of [0, 2, 4]) {
      rows.push(sessionIn(windows, index, dayOffset, 10, 1000));
    }
  }
  return rows;
}

// ─── summarizeProgressWeeks ─────────────────────────────────────────────────

describe('summarizeProgressWeeks', () => {
  it('returns one summary per supplied window with the dataset A week facts (A)', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks(datasetA(windows), windows);

    expect(summaries).toHaveLength(13);
    expect(facts(item(summaries, 0))).toEqual({
      completedWorkouts: 3,
      loggedSets: 30,
      externalLoad: { volumeKgReps: 6_000 },
    });
    // Interior zero week: an authoritative zero, never omitted.
    expect(facts(item(summaries, 5))).toEqual({
      completedWorkouts: 0,
      loggedSets: 0,
      externalLoad: null,
    });
    // The current partial week renders its own facts.
    expect(facts(item(summaries, 12))).toEqual({
      completedWorkouts: 1,
      loggedSets: 12,
      externalLoad: { volumeKgReps: 600 },
    });
  });

  it('places window-boundary instants with [weekStart, weekEnd) inclusivity (M)', () => {
    const windows = horizon();
    const first = item(windows, 0);
    const second = item(windows, 1);
    const rows = [
      row(first.weekStart, 1, 100), // exactly at start → first window
      row(new Date(first.weekEnd.getTime() - 1), 1, 100), // last ms → first window
      row(first.weekEnd, 1, 100), // exactly the next start → second window
      row(second.weekEnd, 1, 100), // second window's end → third window
    ];

    const summaries = summarizeProgressWeeks(rows, windows);

    expect(facts(item(summaries, 0))).toEqual({
      completedWorkouts: 2,
      loggedSets: 2,
      externalLoad: { volumeKgReps: 200 },
    });
    expect(item(summaries, 1).completedWorkouts).toBe(1);
    expect(item(summaries, 2).completedWorkouts).toBe(1);
    expect(item(summaries, 3).completedWorkouts).toBe(0);
  });

  it('attributes by completedAt alone: a Monday 00:10 completion lands in the Monday week (M)', () => {
    const windows = horizon();
    const mondayWeek = item(windows, 4);
    // The row carries only its completion instant — a Sunday 23:30 start with
    // a Monday 00:10 completion is Monday-week training.
    const rows = [row(new Date(mondayWeek.weekStart.getTime() + 10 * 60_000), 6, 500)];

    const summaries = summarizeProgressWeeks(rows, windows);

    expect(facts(item(summaries, 4))).toEqual({
      completedWorkouts: 1,
      loggedSets: 6,
      externalLoad: { volumeKgReps: 500 },
    });
    expect(item(summaries, 3).completedWorkouts).toBe(0);
  });

  it('renders bodyweight/duration-only weeks as null external load, never zero (B)', () => {
    const windows = horizon();
    const rows = [
      sessionIn(windows, 0, 0, 8, null),
      sessionIn(windows, 0, 3, 5, null),
      sessionIn(windows, 2, 1, 12, null),
    ];

    const summaries = summarizeProgressWeeks(rows, windows);

    expect(facts(item(summaries, 0))).toEqual({
      completedWorkouts: 2,
      loggedSets: 13,
      externalLoad: null,
    });
    expect(facts(item(summaries, 2))).toEqual({
      completedWorkouts: 1,
      loggedSets: 12,
      externalLoad: null,
    });
    expect(item(summaries, 1).externalLoad).toBeNull();
  });

  it('keeps a genuine 0 kg session as a real zero external load (C)', () => {
    const windows = horizon();
    // All-0-kg training: three eligible sets whose volume sums to exactly 0.
    const rows = [sessionIn(windows, 3, 1, 3, 0)];

    const summaries = summarizeProgressWeeks(rows, windows);

    expect(facts(item(summaries, 3))).toEqual({
      completedWorkouts: 1,
      loggedSets: 3,
      externalLoad: { volumeKgReps: 0 },
    });
    expect(item(summaries, 2).externalLoad).toBeNull();
  });

  it('sums only eligible rows when a week mixes loaded and unloaded sessions', () => {
    const windows = horizon();
    const rows = [
      sessionIn(windows, 6, 0, 8, null),
      sessionIn(windows, 6, 2, 6, 1_500),
      sessionIn(windows, 6, 4, 4, 0),
    ];

    const summaries = summarizeProgressWeeks(rows, windows);

    expect(facts(item(summaries, 6))).toEqual({
      completedWorkouts: 3,
      loggedSets: 18,
      externalLoad: { volumeKgReps: 1_500 },
    });
  });

  it('ignores rows outside every supplied window', () => {
    const windows = horizon();
    const last = item(windows, 12);
    const rows = [
      row(new Date('2020-01-01T00:00:00.000Z'), 5, 100), // before the horizon
      row(last.weekEnd, 5, 100), // exactly after the horizon
      sessionIn(windows, 1, 2, 7, 300), // the only in-span row
    ];

    const summaries = summarizeProgressWeeks(rows, windows);

    expect(summarizeProgressPeriod(summaries)).toEqual({
      completedWorkouts: 1,
      loggedSets: 7,
      externalLoad: { volumeKgReps: 300 },
    });
    expect(item(summaries, 0).completedWorkouts).toBe(0);
    expect(item(summaries, 12).completedWorkouts).toBe(0);
  });

  it('preserves supplied window order with zero-filled weeks, oldest → newest', () => {
    const windows = horizon();

    const summaries = summarizeProgressWeeks([], windows);

    expect(summaries.map((summary) => summary.window.weekIndex)).toEqual(
      windows.map((window) => window.weekIndex),
    );
    expect(summaries.map((summary) => summary.window.weekIndex)).toEqual(
      Array.from({ length: 13 }, (_, index) => index - 12),
    );
    expect(summaries.every((summary) => summary.completedWorkouts === 0)).toBe(true);
    expect(summaries.every((summary) => summary.externalLoad === null)).toBe(true);
  });

  it('never mutates its inputs, including across the other aggregations', () => {
    const windows = horizon().map((window) => Object.freeze({ ...window }));
    const rows = datasetA(windows).map((entry) => Object.freeze({ ...entry }));
    Object.freeze(windows);
    Object.freeze(rows);

    const summaries = summarizeProgressWeeks(rows, windows);
    for (const summary of summaries) Object.freeze(summary);
    Object.freeze(summaries);

    // ES module strict mode throws on any mutation of the frozen inputs.
    summarizeProgressPeriod(summaries);
    resolveAverageWorkoutsPerWeek(summaries);

    expect(summaries).toHaveLength(13);
    expect(rows).toHaveLength(28);
  });

  it('takes the horizon length from the caller — no window count is assumed', () => {
    const windows = listRecentTrainingWeekWindows(NOW, 3);
    const rows = [sessionIn(windows, 0, 1, 5, 100)];

    const summaries = summarizeProgressWeeks(rows, windows);

    expect(summaries).toHaveLength(3);
    expect(facts(item(summaries, 0))).toEqual({
      completedWorkouts: 1,
      loggedSets: 5,
      externalLoad: { volumeKgReps: 100 },
    });
    expect(resolveAverageWorkoutsPerWeek(summaries)).toEqual({
      workoutsPerWeek: 0.5,
      denominatorWeeks: 2,
    });
  });
});

// ─── summarizeProgressPeriod ────────────────────────────────────────────────

describe('summarizeProgressPeriod', () => {
  it('totals the full horizon including the current partial week (A)', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks(datasetA(windows), windows);

    expect(summarizeProgressPeriod(summaries)).toEqual({
      completedWorkouts: 28,
      loggedSets: 312,
      externalLoad: { volumeKgReps: 61_200 },
    });
  });

  it('stays null when no week carries eligible external-load data (B)', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks(
      [sessionIn(windows, 0, 0, 8, null), sessionIn(windows, 9, 2, 6, null)],
      windows,
    );

    expect(summarizeProgressPeriod(summaries)).toEqual({
      completedWorkouts: 2,
      loggedSets: 14,
      externalLoad: null,
    });
  });

  it('totals a genuine zero when eligible 0 kg sets exist (C)', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks([sessionIn(windows, 3, 1, 3, 0)], windows);

    expect(summarizeProgressPeriod(summaries)).toEqual({
      completedWorkouts: 1,
      loggedSets: 3,
      externalLoad: { volumeKgReps: 0 },
    });
  });

  it('reports presence whenever any single week carries a sum', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks(
      [sessionIn(windows, 0, 0, 8, null), sessionIn(windows, 1, 0, 5, 400)],
      windows,
    );

    expect(summarizeProgressPeriod(summaries).externalLoad).toEqual({ volumeKgReps: 400 });
  });

  it('returns zero counts and a null load for no summaries', () => {
    expect(summarizeProgressPeriod([])).toEqual({
      completedWorkouts: 0,
      loggedSets: 0,
      externalLoad: null,
    });
  });
});

// ─── resolveAverageWorkoutsPerWeek ──────────────────────────────────────────

describe('resolveAverageWorkoutsPerWeek', () => {
  it('anchors at the first trained completed week: 27 ÷ 12 = 2.25 (A)', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks(datasetA(windows), windows);

    // 28 workouts in the horizon, 1 of them in the current partial week:
    // numerator 27 over all 12 completed weeks (interior zero week included).
    expect(resolveAverageWorkoutsPerWeek(summaries)).toEqual({
      workoutsPerWeek: 2.25,
      denominatorWeeks: 12,
    });
  });

  it('excludes pre-tracking weeks from the denominator: 15 ÷ 5 = 3 (N)', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks(datasetN(windows), windows);

    expect(resolveAverageWorkoutsPerWeek(summaries)).toEqual({
      workoutsPerWeek: 3,
      denominatorWeeks: 5,
    });
  });

  it('counts trailing inactive weeks: 24 ÷ 12 = 2 (P)', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks(datasetP(windows), windows);

    expect(resolveAverageWorkoutsPerWeek(summaries)).toEqual({
      workoutsPerWeek: 2,
      denominatorWeeks: 12,
    });
  });

  it('renders no average when the first workout is in the current partial week (O)', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks([sessionIn(windows, 12, 0, 12, 600)], windows);

    expect(resolveAverageWorkoutsPerWeek(summaries)).toBeNull();
  });

  it('never counts current-partial-week workouts in the numerator', () => {
    const windows = horizon();
    const rows = [...datasetN(windows)];
    for (const dayOffset of [0, 1]) rows.push(sessionIn(windows, 12, dayOffset, 10, 500));
    const summaries = summarizeProgressWeeks(rows, windows);

    // 15 completed-week workouts + 2 in the current week: the average still
    // sees only the completed weeks; the period totals include both.
    expect(resolveAverageWorkoutsPerWeek(summaries)).toEqual({
      workoutsPerWeek: 3,
      denominatorWeeks: 5,
    });
    expect(summarizeProgressPeriod(summaries).completedWorkouts).toBe(17);
  });

  it('counts interior zero weeks inside the anchored span', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks(
      [sessionIn(windows, 0, 0, 5, 100), sessionIn(windows, 11, 0, 5, 100)],
      windows,
    );

    expect(resolveAverageWorkoutsPerWeek(summaries)).toEqual({
      workoutsPerWeek: 2 / 12,
      denominatorWeeks: 12,
    });
  });

  it('renders denominator 1 for exactly one completed training week', () => {
    const windows = horizon();
    const summaries = summarizeProgressWeeks([sessionIn(windows, 11, 3, 9, 250)], windows);

    expect(resolveAverageWorkoutsPerWeek(summaries)).toEqual({
      workoutsPerWeek: 1,
      denominatorWeeks: 1,
    });
  });

  it('returns null — never 0 — for no completed training weeks', () => {
    const windows = horizon();

    // Empty history across the whole horizon.
    expect(resolveAverageWorkoutsPerWeek(summarizeProgressWeeks([], windows))).toBeNull();
    // Directly empty input.
    expect(resolveAverageWorkoutsPerWeek([])).toBeNull();
    // A horizon whose only supplied window is the current partial week.
    expect(
      resolveAverageWorkoutsPerWeek(summarizeProgressWeeks([], [item(windows, 12)])),
    ).toBeNull();
  });
});

// ─── M13 parity drift guard ─────────────────────────────────────────────────

describe('M13 parity drift guard', () => {
  /**
   * `summarizeProgressWeeks` deliberately re-implements M13's bucketing
   * (with volume added) rather than modifying M13. This guard calls the REAL
   * `summarizeTrainingWeeks` on the same rows and windows, so a future
   * change to either rule forces an explicit review instead of letting the
   * Progress surface silently disagree with the dashboard about what counts
   * as a workout or a logged set.
   */
  it('matches the real summarizeTrainingWeeks for workouts and sets', () => {
    const windows = horizon();
    const rows: ReadonlyArray<ProgressActivityRow> = [
      ...datasetA(windows),
      // An unloaded session — volume presence must not affect count parity.
      sessionIn(windows, 2, 1, 4, null),
      // A row outside the horizon — both must ignore it identically.
      row(new Date('2020-01-01T00:00:00.000Z'), 5, 100),
    ];

    const progress = summarizeProgressWeeks(rows, windows);
    const m13 = summarizeTrainingWeeks(rows, windows);

    expect(progress).toHaveLength(m13.length);
    for (let index = 0; index < m13.length; index += 1) {
      const progressSummary = item(progress, index);
      const m13Summary = item(m13, index);

      expect(progressSummary.window).toEqual(m13Summary.window);
      expect(progressSummary.completedWorkouts).toBe(m13Summary.completedWorkouts);
      expect(progressSummary.loggedSets).toBe(m13Summary.loggedSets);
    }
    // Non-triviality: the guard would pass vacuously on an empty fixture.
    // 28 dataset-A sessions + 1 unloaded session = 29 in-window workouts
    // (the out-of-span row is ignored by both).
    expect(m13.reduce((total, summary) => total + summary.completedWorkouts, 0)).toBe(29);
  });
});

