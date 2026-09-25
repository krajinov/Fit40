/**
 * Unit tests for the M13 weekly insights presentation mapping (Slice 4).
 *
 * Pure label assembly: comparison-copy branches, fixed-UTC week labels,
 * per-week accessible text and M12 value formatting must match the copy
 * contract exactly. Nothing here re-derives week facts — the DTO carries
 * Domain-computed values; presentation only words them.
 */

import { describe, expect, it } from 'vitest';

import type {
  RecentPersonalBestDto,
  TrainingWeeklyInsightsDto,
} from '@/application/dto/training-insights';
import {
  formatWeekStartLabel,
  STILL_STANDING_PB_CAPTION,
  toWeeklyInsightsView,
  weeklyComparisonLabel,
  WEEKS_RUN_MONDAY_SUNDAY_UTC,
} from '@/features/dashboard/weekly-insights-view';

function week(weekStart: string, completedWorkouts: number, loggedSets: number) {
  return { weekStart, completedWorkouts, loggedSets };
}

const WEEK_STARTS = [
  '2025-12-29T00:00:00.000Z',
  '2026-01-05T00:00:00.000Z',
  '2026-01-12T00:00:00.000Z',
  '2026-01-19T00:00:00.000Z',
  '2026-01-26T00:00:00.000Z',
  '2026-02-02T00:00:00.000Z',
  '2026-02-09T00:00:00.000Z',
  '2026-02-16T00:00:00.000Z',
];

function dtoFixture(
  overrides?: Partial<TrainingWeeklyInsightsDto>,
): TrainingWeeklyInsightsDto {
  const currentWeek = week('2026-02-16T00:00:00.000Z', 3, 14);
  const previousWeek = week('2026-02-09T00:00:00.000Z', 2, 0);
  return {
    weekStart: currentWeek.weekStart,
    weeks: [
      week('2025-12-29T00:00:00.000Z', 0, 0),
      week('2026-01-05T00:00:00.000Z', 1, 8),
      week('2026-01-12T00:00:00.000Z', 0, 0),
      week('2026-01-19T00:00:00.000Z', 2, 12),
      week('2026-01-26T00:00:00.000Z', 0, 0),
      week('2026-02-02T00:00:00.000Z', 1, 10),
      previousWeek,
      currentWeek,
    ],
    summary: {
      currentWeek,
      previousWeek,
      workoutDelta: 1,
      setDelta: 14,
      currentPersonalBestsSetThisWeek: 1,
    },
    recentPersonalBests: [],
    ...overrides,
  };
}

function best(overrides: Partial<RecentPersonalBestDto>): RecentPersonalBestDto {
  return {
    exerciseId: 'e1',
    exerciseName: 'Back Squat',
    exerciseSlug: 'back-squat',
    metric: 'max-load',
    value: 82.5,
    sessionId: 's1',
    completedAt: '2026-02-16T10:00:00.000Z',
    ...overrides,
  };
}

describe('formatWeekStartLabel — fixed UTC', () => {
  it('names the Monday window start without zone shifts', () => {
    expect(formatWeekStartLabel('2026-02-16T00:00:00.000Z')).toBe('Week of Feb 16');
    expect(formatWeekStartLabel('2025-12-29T00:00:00.000Z')).toBe('Week of Dec 29');
  });
});

describe('weeklyComparisonLabel — copy contract', () => {
  const CASES: ReadonlyArray<readonly [number, number, number, number, string]> = [
    [0, 0, 0, 0, 'No training in the last two weeks.'],
    [3, 0, 3, 14, 'No training last week.'],
    [2, 2, 0, 0, 'Same as last week.'],
    [4, 2, 2, 14, '+2 workouts · +14 sets vs last week'],
    [1, 2, -1, -3, '−1 workout · −3 sets vs last week'],
    [3, 2, 1, 6, '+1 workout · +6 sets vs last week'],
    [3, 2, 1, 1, '+1 workout · +1 set vs last week'],
    [2, 2, 0, 7, '±0 workouts · +7 sets vs last week'],
  ];

  for (const [current, previous, workoutDelta, setDelta, expected] of CASES) {
    it(`"${expected}" for ${current}/${previous} workouts, Δ${workoutDelta}/${setDelta}`, () => {
      expect(weeklyComparisonLabel(current, previous, workoutDelta, setDelta)).toBe(
        expected,
      );
    });
  }
});

describe('toWeeklyInsightsView', () => {
  it('builds the fixed-UTC week label, three labelled stats and the comparison', () => {
    const view = toWeeklyInsightsView(dtoFixture());

    expect(view.weekLabel).toBe('Week of Feb 16');
    expect(view.stats.map((stat) => stat.label)).toEqual([
      'Workouts',
      'Sets',
      'Current PBs set',
    ]);
    expect(view.stats.map((stat) => stat.value)).toEqual(['3', '14', '1']);
    expect(view.comparisonLabel).toBe('+1 workout · +14 sets vs last week');
  });

  it('always captions the strip with the Monday–Sunday UTC rule', () => {
    const view = toWeeklyInsightsView(dtoFixture());

    expect(view.activityCaption).toBe('Weeks run Monday–Sunday (UTC).');
    expect(WEEKS_RUN_MONDAY_SUNDAY_UTC).toBe('Weeks run Monday–Sunday (UTC).');
  });

  it('keeps eight weeks oldest → newest with per-week accessible text', () => {
    const view = toWeeklyInsightsView(dtoFixture());

    expect(view.activityWeeks).toHaveLength(8);
    expect(view.activityWeeks.map((w) => w.weekStart)).toEqual(WEEK_STARTS);
    expect(view.activityWeeks.map((w) => w.isCurrentWeek)).toEqual([
      false,
      false,
      false,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(view.activityWeeks[0]?.accessibleLabel).toBe('Week of Dec 29: 0 workouts');
    expect(view.activityWeeks[5]?.accessibleLabel).toBe('Week of Feb 2: 1 workout');
    expect(view.activityWeeks[7]?.accessibleLabel).toBe(
      'Week of Feb 16: 3 workouts (this week)',
    );
  });

  it('keeps zero-workout weeks as authoritative visible zeros', () => {
    const view = toWeeklyInsightsView(
      dtoFixture({
        weeks: WEEK_STARTS.map((weekStart) => week(weekStart, 0, 0)),
        summary: {
          currentWeek: week('2026-02-16T00:00:00.000Z', 0, 0),
          previousWeek: week('2026-02-09T00:00:00.000Z', 0, 0),
          workoutDelta: 0,
          setDelta: 0,
          currentPersonalBestsSetThisWeek: 0,
        },
      }),
    );

    expect(view.activityWeeks).toHaveLength(8);
    expect(view.activityWeeks.every((w) => w.completedWorkouts === 0)).toBe(true);
    expect(view.activityWeeks[0]?.accessibleLabel).toContain('0 workouts');
    expect(view.stats[0]).toEqual({ label: 'Workouts', value: '0' });
  });

  it('renders the R1 still-standing PB caption verbatim', () => {
    expect(STILL_STANDING_PB_CAPTION).toBe(
      'Still-standing personal bests achieved this week.',
    );
  });

  it('maps recent personal bests with M12 value formatting and owning sessions', () => {
    const view = toWeeklyInsightsView(
      dtoFixture({
        recentPersonalBests: [
          best({}),
          best({
            exerciseId: 'e2',
            exerciseName: 'Bench Press',
            exerciseSlug: 'bench-press',
            metric: 'max-bodyweight-reps',
            value: 18,
            sessionId: 's2',
          }),
          best({
            exerciseId: 'e3',
            exerciseName: 'Plank',
            exerciseSlug: 'plank',
            metric: 'max-duration',
            value: 75,
            sessionId: 's3',
          }),
        ],
      }),
    );

    expect(view.personalBests.map((pb) => pb.valueLabel)).toEqual([
      '82.5 kg',
      '18 reps',
      '75 sec',
    ]);
    expect(view.personalBests.map((pb) => pb.sessionId)).toEqual(['s1', 's2', 's3']);
    expect(view.personalBests[0]?.completedAtLabel).toBe('Feb 16, 2026');
    expect(view.personalBests[0]?.exerciseName).toBe('Back Squat');
  });

  it('an empty personal-best list stays empty — no fabricated rows', () => {
    const view = toWeeklyInsightsView(dtoFixture());

    expect(view.personalBests).toEqual([]);
  });
});