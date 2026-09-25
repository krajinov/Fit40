/**
 * M13 training-week contract: fixed UTC calendar weeks (Monday 00:00:00.000
 * UTC inclusive → next Monday exclusive), contiguous recent windows, week
 * bucketing and plain week-over-week deltas.
 *
 * Every instant is a fixed UTC literal and every expectation is an ISO string,
 * so the suite is independent of the machine's timezone and of DST anywhere.
 */

import { describe, expect, it } from 'vitest';

import {
  compareTrainingWeeks,
  listRecentTrainingWeekWindows,
  resolveTrainingWeekWindow,
  summarizeTrainingWeeks,
  type CompletedSessionActivity,
  type TrainingWeekSummary,
  type TrainingWeekWindow,
} from '@/domain/services/training-week';

const MS_PER_DAY = 86_400_000;

/** ISO rendering so assertions compare instants, not Date identities. */
function iso(date: Date): string {
  return date.toISOString();
}

function activity(completedAt: string, loggedSets: number): CompletedSessionActivity {
  return { completedAt: new Date(completedAt), loggedSets };
}

/** Instant-comparison line of one window, without Date identity. */
function windowLine(window: TrainingWeekWindow): string {
  return `${window.weekIndex}:${iso(window.weekStart)}:${iso(window.weekEnd)}`;
}

/** Compact line of one summary, for order-insensitive assertions. */
function summaryLine(entry: TrainingWeekSummary): string {
  return `${windowLine(entry.window)}:${entry.completedWorkouts}/${entry.loggedSets}`;
}

/** A standalone summary for comparison tests; window values are irrelevant there. */
function summary(
  weekIndex: number,
  completedWorkouts: number,
  loggedSets: number,
): TrainingWeekSummary {
  return {
    window: {
      weekStart: new Date('2026-09-21T00:00:00.000Z'),
      weekEnd: new Date('2026-09-28T00:00:00.000Z'),
      weekIndex,
    },
    completedWorkouts,
    loggedSets,
  };
}

// ─── resolveTrainingWeekWindow ───────────────────────────────────────────────

describe('resolveTrainingWeekWindow', () => {
  it('starts the week at Monday 00:00:00.000 UTC for a Monday-midnight instant', () => {
    // 2026-09-21 is a Monday.
    const window = resolveTrainingWeekWindow(new Date('2026-09-21T00:00:00.000Z'));

    expect(iso(window.weekStart)).toBe('2026-09-21T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2026-09-28T00:00:00.000Z');
    expect(window.weekIndex).toBe(0);
  });

  it('keeps Sunday 23:59:59.999 UTC in the week that began on Monday', () => {
    // 2026-09-27 is a Sunday: the last millisecond of the week is still in it.
    const window = resolveTrainingWeekWindow(new Date('2026-09-27T23:59:59.999Z'));

    expect(iso(window.weekStart)).toBe('2026-09-21T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2026-09-28T00:00:00.000Z');
    expect(window.weekIndex).toBe(0);
  });

  it('rolls over exactly at the next Monday midnight', () => {
    const window = resolveTrainingWeekWindow(new Date('2026-09-28T00:00:00.000Z'));

    expect(iso(window.weekStart)).toBe('2026-09-28T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2026-10-05T00:00:00.000Z');
  });

  it('returns the same week for any instant inside it', () => {
    // 2026-09-24 is a Thursday.
    const window = resolveTrainingWeekWindow(new Date('2026-09-24T10:00:00Z'));

    expect(iso(window.weekStart)).toBe('2026-09-21T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2026-09-28T00:00:00.000Z');
  });

  it('spans a month boundary without splitting the week', () => {
    // 2026-07-01 is a Wednesday; its UTC week began on Monday 2026-06-29.
    const window = resolveTrainingWeekWindow(new Date('2026-07-01T12:00:00Z'));

    expect(iso(window.weekStart)).toBe('2026-06-29T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2026-07-06T00:00:00.000Z');
  });

  it('spans a year boundary without splitting the week', () => {
    // 2027-01-01 is a Friday; its UTC week began on Monday 2026-12-28.
    const window = resolveTrainingWeekWindow(new Date('2027-01-01T00:00:00.000Z'));

    expect(iso(window.weekStart)).toBe('2026-12-28T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2027-01-04T00:00:00.000Z');
  });

  it('treats a leap day like any other day inside a seven-day window', () => {
    // 2028 is a leap year; 2028-02-29 is a Tuesday.
    const window = resolveTrainingWeekWindow(new Date('2028-02-29T12:00:00Z'));

    expect(iso(window.weekStart)).toBe('2028-02-28T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2028-03-06T00:00:00.000Z');
    expect(window.weekEnd.getTime() - window.weekStart.getTime()).toBe(7 * MS_PER_DAY);
  });

  it('keeps a fixed seven-day week across the Europe/London spring transition', () => {
    // UK clocks jump at 01:00 UTC on Sunday 2026-03-29; this instant is just after it.
    const window = resolveTrainingWeekWindow(new Date('2026-03-29T01:30:00.000Z'));

    expect(iso(window.weekStart)).toBe('2026-03-23T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2026-03-30T00:00:00.000Z');
    expect(window.weekEnd.getTime() - window.weekStart.getTime()).toBe(7 * MS_PER_DAY);
  });

  it('keeps a fixed seven-day week across the US autumn transition', () => {
    // US clocks fall back on Sunday 2026-11-01; the UTC week is unaffected.
    const window = resolveTrainingWeekWindow(new Date('2026-11-01T12:00:00Z'));

    expect(iso(window.weekStart)).toBe('2026-10-26T00:00:00.000Z');
    expect(iso(window.weekEnd)).toBe('2026-11-02T00:00:00.000Z');
    expect(window.weekEnd.getTime() - window.weekStart.getTime()).toBe(7 * MS_PER_DAY);
  });
});

// ─── listRecentTrainingWeekWindows ───────────────────────────────────────────

describe('listRecentTrainingWeekWindows', () => {
  const NOW = new Date('2026-09-24T10:00:00Z');

  it('returns exactly eight contiguous windows, oldest first, ending with the current week', () => {
    const windows = listRecentTrainingWeekWindows(NOW, 8);

    expect(windows).toHaveLength(8);
    expect(iso(windows[0]!.weekStart)).toBe('2026-08-03T00:00:00.000Z');
    expect(iso(windows[7]!.weekStart)).toBe('2026-09-21T00:00:00.000Z');
    expect(iso(windows[7]!.weekEnd)).toBe('2026-09-28T00:00:00.000Z');

    for (const [index, window] of windows.entries()) {
      // Always seven days long…
      expect(window.weekEnd.getTime() - window.weekStart.getTime()).toBe(7 * MS_PER_DAY);
      // …and contiguous: no gap, no overlap with the next window.
      const next = windows[index + 1];
      if (next !== undefined) {
        expect(next.weekStart.getTime()).toBe(window.weekEnd.getTime());
      }
    }
  });

  it('numbers each window by its distance from the current week', () => {
    const windows = listRecentTrainingWeekWindows(NOW, 8);

    expect(windows.map((window) => window.weekIndex)).toEqual([-7, -6, -5, -4, -3, -2, -1, 0]);
    // The current week is plain positive zero, not negative zero.
    expect(Object.is(windows[7]!.weekIndex, 0)).toBe(true);
  });

  it('returns the requested number of windows', () => {
    const single = listRecentTrainingWeekWindows(NOW, 1);
    expect(single.map(windowLine)).toEqual(['0:2026-09-21T00:00:00.000Z:2026-09-28T00:00:00.000Z']);

    const three = listRecentTrainingWeekWindows(NOW, 3);
    expect(three.map((window) => window.weekIndex)).toEqual([-2, -1, 0]);
    expect(iso(three[0]!.weekStart)).toBe('2026-09-07T00:00:00.000Z');
  });

  it('returns an empty list for a non-positive count', () => {
    expect(listRecentTrainingWeekWindows(NOW, 0)).toEqual([]);
    expect(listRecentTrainingWeekWindows(NOW, -3)).toEqual([]);
  });

  it('resolves the same windows wherever the instant sits inside the week', () => {
    const atWeekStart = listRecentTrainingWeekWindows(new Date('2026-09-21T00:00:00.000Z'), 8);
    const atWeekEnd = listRecentTrainingWeekWindows(new Date('2026-09-27T23:59:59.999Z'), 8);

    expect(atWeekStart.map(windowLine)).toEqual(atWeekEnd.map(windowLine));
  });
});

// ─── summarizeTrainingWeeks ──────────────────────────────────────────────────

describe('summarizeTrainingWeeks', () => {
  const NOW = new Date('2026-09-24T10:00:00Z');
  // Eight windows: 2026-08-03 … 2026-09-28. Current week starts 2026-09-21,
  // the previous week starts 2026-09-14.
  const windows = listRecentTrainingWeekWindows(NOW, 8);

  it('returns one zeroed summary per window when there are no activities', () => {
    const summaries = summarizeTrainingWeeks([], windows);

    expect(summaries).toHaveLength(8);
    for (const [index, entry] of summaries.entries()) {
      expect(entry.completedWorkouts).toBe(0);
      expect(entry.loggedSets).toBe(0);
      expect(windowLine(entry.window)).toBe(windowLine(windows[index]!));
    }
  });

  it('places activities by [weekStart, weekEnd) with weekStart inclusive', () => {
    const summaries = summarizeTrainingWeeks(
      [
        activity('2026-09-14T00:00:00.000Z', 10), // previous week, at its Monday midnight
        activity('2026-09-21T00:00:00.000Z', 12), // current week, at its Monday midnight
      ],
      windows,
    );

    expect(summaryLine(summaries[7]!)).toBe('0:2026-09-21T00:00:00.000Z:2026-09-28T00:00:00.000Z:1/12');
    expect(summaryLine(summaries[6]!)).toBe(
      '-1:2026-09-14T00:00:00.000Z:2026-09-21T00:00:00.000Z:1/10',
    );
  });

  it('keeps Sunday 23:59:59.999 in the week and assigns the next Monday to the next window', () => {
    const summaries = summarizeTrainingWeeks(
      [
        activity('2026-09-27T23:59:59.999Z', 8), // last millisecond of the current week
        activity('2026-09-28T00:00:00.000Z', 99), // exclusive end: not in any supplied window
      ],
      windows,
    );

    expect(summaries[7]!.completedWorkouts).toBe(1);
    expect(summaries[7]!.loggedSets).toBe(8);
    expect(summaries.reduce((total, entry) => total + entry.completedWorkouts, 0)).toBe(1);
  });

  it('ignores activities outside every supplied window', () => {
    const summaries = summarizeTrainingWeeks(
      [
        activity('2025-01-01T10:00:00Z', 40), // long before the span
        activity('2026-07-01T12:00:00Z', 25), // just before the oldest window
        activity('2026-09-28T00:00:00.000Z', 30), // at the exclusive end of the span
      ],
      windows,
    );

    expect(summaries.map((entry) => `${entry.completedWorkouts}/${entry.loggedSets}`)).toEqual([
      '0/0',
      '0/0',
      '0/0',
      '0/0',
      '0/0',
      '0/0',
      '0/0',
      '0/0',
    ]);
  });

  it('counts multiple sessions in one week and sums their logged sets', () => {
    const summaries = summarizeTrainingWeeks(
      [
        activity('2026-09-21T07:00:00Z', 12),
        activity('2026-09-23T18:30:00Z', 15),
        activity('2026-09-26T09:00:00Z', 9),
      ],
      windows,
    );

    expect(summaries[7]!.completedWorkouts).toBe(3);
    expect(summaries[7]!.loggedSets).toBe(36);
  });

  it('counts a zero-set completed session as a completed workout', () => {
    const summaries = summarizeTrainingWeeks(
      [activity('2026-09-16T12:00:00Z', 0)],
      windows,
    );

    expect(summaries[6]!.completedWorkouts).toBe(1);
    expect(summaries[6]!.loggedSets).toBe(0);
  });

  it('is independent of activity order', () => {
    const activities = [
      activity('2026-09-21T07:00:00Z', 12),
      activity('2026-09-16T12:00:00Z', 0),
      activity('2026-09-26T09:00:00Z', 9),
      activity('2026-09-15T12:00:00Z', 20),
    ];

    const forward = summarizeTrainingWeeks(activities, windows).map(summaryLine);
    const reversed = summarizeTrainingWeeks([...activities].reverse(), windows).map(summaryLine);

    expect(reversed).toEqual(forward);
  });

  it('does not mutate its inputs', () => {
    const activities = [
      activity('2026-09-21T07:00:00Z', 12),
      activity('2026-09-16T12:00:00Z', 0),
    ];
    const beforeActivities = activities.map((entry) => `${iso(entry.completedAt)}/${entry.loggedSets}`);
    const beforeWindows = windows.map(windowLine);

    const summaries = summarizeTrainingWeeks(activities, windows);

    expect(summaries).not.toBe(windows);
    expect(activities).toHaveLength(2);
    expect(activities.map((entry) => `${iso(entry.completedAt)}/${entry.loggedSets}`)).toEqual(
      beforeActivities,
    );
    expect(windows.map(windowLine)).toEqual(beforeWindows);
  });
});

// ─── compareTrainingWeeks ────────────────────────────────────────────────────

describe('compareTrainingWeeks', () => {
  it('returns positive deltas when the current week is above the previous', () => {
    const comparison = compareTrainingWeeks(summary(0, 3, 42), summary(-1, 1, 30));

    expect(comparison).toEqual({ workoutDelta: 2, setDelta: 12 });
  });

  it('returns negative deltas when the current week is below the previous', () => {
    const comparison = compareTrainingWeeks(summary(0, 1, 10), summary(-1, 4, 60));

    expect(comparison).toEqual({ workoutDelta: -3, setDelta: -50 });
  });

  it('returns zero deltas when both weeks are equal', () => {
    const comparison = compareTrainingWeeks(summary(0, 2, 24), summary(-1, 2, 24));

    expect(comparison).toEqual({ workoutDelta: 0, setDelta: 0 });
  });

  it('treats a previous week with no activity as an authoritative zero', () => {
    const comparison = compareTrainingWeeks(summary(0, 3, 42), summary(-1, 0, 0));

    expect(comparison).toEqual({ workoutDelta: 3, setDelta: 42 });
  });

  it('returns zero deltas when neither week has activity', () => {
    const comparison = compareTrainingWeeks(summary(0, 0, 0), summary(-1, 0, 0));

    expect(comparison).toEqual({ workoutDelta: 0, setDelta: 0 });
  });

  it('compares workouts and sets independently when their directions differ', () => {
    const comparison = compareTrainingWeeks(summary(0, 1, 50), summary(-1, 2, 30));

    expect(comparison).toEqual({ workoutDelta: -1, setDelta: 20 });
  });
});