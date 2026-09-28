/**
 * M16 Slice 1 — plan follow-through: outcome classification and weekly summary.
 *
 * The precedence is locked: a completed session fact outranks a live session
 * fact, which outranks the planned-date relationship to today. A completion is
 * then refined by its UTC calendar day into early / on-plan / late, and the
 * three are one `completed` axis (see the parity guard for the M15 link).
 *
 * Every instant is a fixed UTC literal and every expectation is an ISO string
 * or a plain count, so the suite is independent of the machine's timezone.
 */

import { describe, expect, it } from 'vitest';

import {
  summarizeFollowThrough,
  type FollowThroughSummary,
  type FollowThroughWeek,
} from '@/domain/services/follow-through-week';
import {
  FollowThroughOutcome,
  resolveFollowThroughOutcome,
  type PlannedOccurrenceFacts,
} from '@/domain/services/plan-follow-through';
import {
  listRecentTrainingWeekWindows,
  type TrainingWeekWindow,
} from '@/domain/services/training-week';
import { createScheduledWorkoutId } from '@/domain/types/ids';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';

/** A Monday noon UTC: the current training week is 2026-09-28 → 2026-10-05. */
const NOW = new Date('2026-09-28T12:00:00.000Z');
const TODAY = '2026-09-28';

function date(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function occurrence(
  scheduledWorkoutId: string,
  plannedDate: string,
  facts: {
    readonly completedAt?: string;
    readonly active?: boolean;
    readonly notPerformed?: boolean;
  } = {},
): PlannedOccurrenceFacts {
  const id = createScheduledWorkoutId(scheduledWorkoutId);
  if (!id.ok) throw new Error(id.error.message);

  return {
    scheduledWorkoutId: id.data,
    plannedDate: date(plannedDate),
    completedAt: facts.completedAt === undefined ? null : new Date(facts.completedAt),
    hasActiveSession: facts.active ?? false,
    hasNotPerformedRecord: facts.notPerformed ?? false,
  };
}

/** The last `count` UTC training weeks ending with the week containing `now`. */
function windows(now: Date, count: number): ReadonlyArray<TrainingWeekWindow> {
  return listRecentTrainingWeekWindows(now, count);
}

function iso(value: Date): string {
  return value.toISOString();
}

/** Compact line of one returned week, for order-insensitive comparisons. */
function weekLine(week: FollowThroughWeek): string {
  return [
    iso(week.window.weekStart),
    week.closed ? 'closed' : 'provisional',
    `planned:${week.planned}`,
    `completed:${week.completed}`,
    `early:${week.completedEarly}`,
    `late:${week.completedLate}`,
    `started:${week.started}`,
    `pastDue:${week.pastDue}`,
    `notPerformed:${week.notPerformed}`,
  ].join('|');
}

function weekLines(summary: FollowThroughSummary): ReadonlyArray<string> {
  return summary.weeks.map(weekLine);
}

/** Totals line, so totals can be compared as one value. */
function totalsLine(summary: FollowThroughSummary): string {
  const { totals } = summary;
  return [
    `planned:${totals.planned}`,
    `completed:${totals.completed}`,
    `early:${totals.completedEarly}`,
    `late:${totals.completedLate}`,
    `started:${totals.started}`,
    `pastDue:${totals.pastDue}`,
    `notPerformed:${totals.notPerformed}`,
  ].join('|');
}

// ─── Outcome classification ──────────────────────────────────────────────────

const CLASSIFICATION_CASES: ReadonlyArray<{
  readonly name: string;
  readonly plannedDate: string;
  readonly completedAt?: string;
  readonly active?: boolean;
  readonly notPerformed?: boolean;
  readonly expected: FollowThroughOutcome;
}> = [
  {
    name: 'is completed-early when the completion day precedes the planned date',
    plannedDate: '2026-09-30',
    completedAt: '2026-09-29T23:59:59.999Z',
    expected: FollowThroughOutcome.CompletedEarly,
  },
  {
    name: 'is completed-on-plan when the completion day is the planned date',
    plannedDate: '2026-09-30',
    completedAt: '2026-09-30T00:00:00.000Z',
    expected: FollowThroughOutcome.CompletedOnPlan,
  },
  {
    name: 'is completed-on-plan for any time of the planned UTC day',
    plannedDate: '2026-09-30',
    completedAt: '2026-09-30T23:59:59.999Z',
    expected: FollowThroughOutcome.CompletedOnPlan,
  },
  {
    name: 'is completed-late by one UTC day, with no grace period',
    plannedDate: '2026-09-30',
    completedAt: '2026-10-01T00:00:00.000Z',
    expected: FollowThroughOutcome.CompletedLate,
  },
  {
    name: 'is started for a live session with no completion',
    plannedDate: '2026-09-29',
    active: true,
    expected: FollowThroughOutcome.Started,
  },
  {
    name: 'is past-due for a past planned date with no session',
    plannedDate: '2026-09-27',
    expected: FollowThroughOutcome.PastDue,
  },
  {
    name: 'is today for the planned date equal to today',
    plannedDate: TODAY,
    expected: FollowThroughOutcome.Today,
  },
  {
    name: 'is upcoming for a future planned date with no session',
    plannedDate: '2026-09-29',
    expected: FollowThroughOutcome.Upcoming,
  },
];

describe('resolveFollowThroughOutcome', () => {
  it.each(CLASSIFICATION_CASES)(
    '$name',
    ({ plannedDate, completedAt, active, notPerformed, expected }) => {
      const resolved = resolveFollowThroughOutcome(
        occurrence('sw-a', plannedDate, { completedAt, active, notPerformed }),
        date(TODAY),
      );

      expect(resolved).toBe(expected);
    },
  );

  it('prefers the completion fact over a live session', () => {
    const both = occurrence('sw-a', '2026-09-27', {
      completedAt: '2026-09-27T09:00:00.000Z',
      active: true,
    });

    expect(resolveFollowThroughOutcome(both, date(TODAY))).toBe(
      FollowThroughOutcome.CompletedOnPlan,
    );
  });

  it('prefers the completion fact over a past-due planned date', () => {
    const late = occurrence('sw-a', '2026-09-01', { completedAt: '2026-09-20T09:00:00.000Z' });

    expect(resolveFollowThroughOutcome(late, date(TODAY))).toBe(FollowThroughOutcome.CompletedLate);
  });

  it('is started, never past-due, for a live session on a past planned date', () => {
    const live = occurrence('sw-a', '2026-09-01', { active: true });

    expect(resolveFollowThroughOutcome(live, date(TODAY))).toBe(FollowThroughOutcome.Started);
  });

  it('classifies by UTC day at the midnight boundary', () => {
    const beforeMidnight = occurrence('sw-a', '2026-09-30', {
      completedAt: '2026-09-29T23:59:59.999Z',
    });
    const atMidnight = occurrence('sw-b', '2026-09-30', {
      completedAt: '2026-09-30T00:00:00.000Z',
    });

    expect(resolveFollowThroughOutcome(beforeMidnight, date(TODAY))).toBe(
      FollowThroughOutcome.CompletedEarly,
    );
    expect(resolveFollowThroughOutcome(atMidnight, date(TODAY))).toBe(
      FollowThroughOutcome.CompletedOnPlan,
    );
  });
});

// ─── Not-performed (M17) ─────────────────────────────────────────────────────

describe('resolveFollowThroughOutcome — not-performed', () => {
  it('never derives not-performed from the date alone', () => {
    for (const plannedDate of ['2026-09-01', '2026-09-27', TODAY, '2026-09-29']) {
      expect(resolveFollowThroughOutcome(occurrence('sw-a', plannedDate), date(TODAY))).not.toBe(
        FollowThroughOutcome.NotPerformed,
      );
    }
  });

  it('keeps a live session above the record, whatever the planned date', () => {
    for (const plannedDate of ['2026-09-01', TODAY, '2026-09-29']) {
      const live = occurrence('sw-a', plannedDate, { active: true, notPerformed: true });

      expect(resolveFollowThroughOutcome(live, date(TODAY))).toBe(FollowThroughOutcome.Started);
    }
  });

  it('throws when the occurrence is both completed and recorded (M17 I1)', () => {
    const contradictory = occurrence('sw-a', '2026-09-30', {
      completedAt: '2026-09-30T09:00:00.000Z',
      notPerformed: true,
    });

    expect(() => resolveFollowThroughOutcome(contradictory, date(TODAY))).toThrow(
      'Occurrence settlement contract violated: occurrence "sw-a" is both completed and recorded as not performed',
    );
  });
});

// ─── Weekly summary ──────────────────────────────────────────────────────────

/** The 3 most recent UTC weeks at `NOW`: 09-14, 09-21 (both closed) and 09-28. */
const WINDOWS = windows(NOW, 3);

/** The first returned week; fails loudly when a case returns no rows. */
function firstWeek(summary: FollowThroughSummary): FollowThroughWeek {
  const [week] = summary.weeks;
  if (week === undefined) throw new Error('expected at least one follow-through week');
  return week;
}

describe('summarizeFollowThrough', () => {
  it('buckets occurrences into their UTC week, in window order', () => {
    const summary = summarizeFollowThrough(
      [
        occurrence('sw-a', '2026-09-16'),
        occurrence('sw-b', '2026-09-22'),
        occurrence('sw-c', '2026-09-29'),
      ],
      WINDOWS,
      NOW,
    );

    expect(weekLines(summary)).toEqual([
      '2026-09-14T00:00:00.000Z|closed|planned:1|completed:0|early:0|late:0|started:0|pastDue:1|notPerformed:0',
      '2026-09-21T00:00:00.000Z|closed|planned:1|completed:0|early:0|late:0|started:0|pastDue:1|notPerformed:0',
      '2026-09-28T00:00:00.000Z|provisional|planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0',
    ]);
    expect(totalsLine(summary)).toBe('planned:3|completed:0|early:0|late:0|started:0|pastDue:2|notPerformed:0');
  });

  it('places a date on a week boundary in the week that starts there', () => {
    const summary = summarizeFollowThrough(
      [occurrence('sw-a', '2026-09-21'), occurrence('sw-b', '2026-09-28')],
      WINDOWS,
      NOW,
    );

    expect(weekLines(summary)).toEqual([
      '2026-09-21T00:00:00.000Z|closed|planned:1|completed:0|early:0|late:0|started:0|pastDue:1|notPerformed:0',
      '2026-09-28T00:00:00.000Z|provisional|planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0',
    ]);
  });

  it('counts the completed variants once each, with early and late subtotals', () => {
    // 09-22: nothing today (past-due) · 09-23 completed late · 09-24 completed
    // on plan · 09-25 completed early · 09-26 live session.
    const summary = summarizeFollowThrough(
      [
        occurrence('sw-a', '2026-09-22'),
        occurrence('sw-b', '2026-09-23', { completedAt: '2026-09-24T08:00:00.000Z' }),
        occurrence('sw-c', '2026-09-24', { completedAt: '2026-09-24T18:30:00.000Z' }),
        occurrence('sw-d', '2026-09-25', { completedAt: '2026-09-24T23:59:59.999Z' }),
        occurrence('sw-e', '2026-09-26', { active: true }),
      ],
      WINDOWS,
      NOW,
    );

    expect(weekLines(summary)).toEqual([
      '2026-09-21T00:00:00.000Z|closed|planned:5|completed:3|early:1|late:1|started:1|pastDue:1|notPerformed:0',
    ]);

    const week = firstWeek(summary);
    // One completion is on plan (neither early nor late), and no occurrence in
    // this week is dated today-or-later, so the four facts account for all five
    // planned rows exactly once.
    expect(week.completed).toBe(week.completedEarly + week.completedLate + 1);
    expect(week.planned).toBe(week.completed + week.started + week.pastDue);
  });

  it('counts today and upcoming occurrences as planned only', () => {
    const summary = summarizeFollowThrough(
      [occurrence('sw-a', TODAY), occurrence('sw-b', '2026-09-29')],
      WINDOWS,
      NOW,
    );

    expect(weekLines(summary)).toEqual([
      '2026-09-28T00:00:00.000Z|provisional|planned:2|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0',
    ]);
  });

  it('omits a supplied window that holds no planned occurrence', () => {
    const summary = summarizeFollowThrough([occurrence('sw-a', '2026-09-29')], WINDOWS, NOW);

    expect(summary.weeks).toHaveLength(1);
    expect(weekLine(firstWeek(summary))).toBe(
      '2026-09-28T00:00:00.000Z|provisional|planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0',
    );
    expect(totalsLine(summary)).toBe('planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0');
  });

  it('ignores occurrences dated outside every supplied window', () => {
    const summary = summarizeFollowThrough(
      [occurrence('sw-a', '2026-09-01'), occurrence('sw-b', '2026-10-20')],
      WINDOWS,
      NOW,
    );

    expect(summary.weeks).toEqual([]);
    expect(totalsLine(summary)).toBe('planned:0|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0');
  });

  it('totals exactly the sum of the returned weeks', () => {
    const summary = summarizeFollowThrough(
      [
        occurrence('sw-a', '2026-09-16'),
        occurrence('sw-b', '2026-09-23', { completedAt: '2026-09-22T06:00:00.000Z' }),
        occurrence('sw-c', '2026-09-29', { active: true }),
        occurrence('sw-d', '2026-09-23', { notPerformed: true }),
      ],
      WINDOWS,
      NOW,
    );

    const summed = summary.weeks.reduce(
      (sum, week) => ({
        planned: sum.planned + week.planned,
        completed: sum.completed + week.completed,
        completedEarly: sum.completedEarly + week.completedEarly,
        completedLate: sum.completedLate + week.completedLate,
        started: sum.started + week.started,
        pastDue: sum.pastDue + week.pastDue,
        notPerformed: sum.notPerformed + week.notPerformed,
      }),
      {
        planned: 0,
        completed: 0,
        completedEarly: 0,
        completedLate: 0,
        started: 0,
        pastDue: 0,
        notPerformed: 0,
      },
    );

    expect(summed).toEqual(summary.totals);
    expect(totalsLine(summary)).toBe(
      'planned:4|completed:1|early:1|late:0|started:1|pastDue:1|notPerformed:1',
    );
  });

  it('is deterministic under reordered occurrences', () => {
    const occurrences = [
      occurrence('sw-a', '2026-09-16', { completedAt: '2026-09-15T07:00:00.000Z' }),
      occurrence('sw-b', '2026-09-22', { active: true }),
      occurrence('sw-c', '2026-09-23'),
      occurrence('sw-d', '2026-09-29', { completedAt: '2026-10-02T07:00:00.000Z' }),
    ];

    const forward = summarizeFollowThrough(occurrences, WINDOWS, NOW);
    const reversed = summarizeFollowThrough([...occurrences].reverse(), WINDOWS, NOW);
    const reordered = summarizeFollowThrough(
      [occurrences[2], occurrences[0], occurrences[3], occurrences[1]].filter(
        (item): item is PlannedOccurrenceFacts => item !== undefined,
      ),
      WINDOWS,
      NOW,
    );

    expect(weekLines(reversed)).toEqual(weekLines(forward));
    expect(totalsLine(reversed)).toBe(totalsLine(forward));
    expect(weekLines(reordered)).toEqual(weekLines(forward));
    expect(totalsLine(reordered)).toBe(totalsLine(forward));
  });

  it('throws when one occurrence is supplied more than once', () => {
    // Duplicates cannot come from storage — the `planned_workouts` primary key
    // allows one row per occurrence, and `workout_sessions` allows one session
    // per occurrence — so a repeat is a caller bug (a JOIN that fanned out, or
    // an assembly mistake). Merging the two facts would report a count matching
    // neither row, so the violation fails loudly instead of being reconciled.
    const contradictory = [
      occurrence('sw-a', '2026-09-22', { active: true }),
      occurrence('sw-a', '2026-09-22', { completedAt: '2026-09-22T09:00:00.000Z' }),
    ];
    const duplicatedFact = [
      occurrence('sw-a', '2026-09-22', { completedAt: '2026-09-22T09:00:00.000Z' }),
      occurrence('sw-a', '2026-09-22', { completedAt: '2026-09-22T09:00:00.000Z' }),
    ];

    expect(() => summarizeFollowThrough(contradictory, WINDOWS, NOW)).toThrow(
      'Follow-through contract violated: occurrence "sw-a" was supplied more than once',
    );
    expect(() => summarizeFollowThrough([...contradictory].reverse(), WINDOWS, NOW)).toThrow(
      /was supplied more than once/,
    );
    // Identical repetition is not tolerated either: one fact per occurrence is
    // the contract, and no identity comparison is performed to soften it.
    expect(() => summarizeFollowThrough(duplicatedFact, WINDOWS, NOW)).toThrow(
      /was supplied more than once/,
    );
  });

  it('does not mutate the supplied occurrences or windows', () => {
    const occurrences = Object.freeze([
      Object.freeze(occurrence('sw-a', '2026-09-22', { completedAt: '2026-09-22T09:00:00.000Z' })),
      Object.freeze(occurrence('sw-b', '2026-09-29')),
    ]);
    const frozenWindows = Object.freeze(WINDOWS.map((window) => Object.freeze(window)));
    const before = JSON.stringify([occurrences, frozenWindows]);

    expect(() => summarizeFollowThrough(occurrences, frozenWindows, NOW)).not.toThrow();
    expect(JSON.stringify([occurrences, frozenWindows])).toBe(before);
  });

  it('treats a week as closed exactly at its exclusive end', () => {
    // One occurrence per window, so both rows are returned.
    const occurrences = [occurrence('sw-a', '2026-09-23'), occurrence('sw-b', '2026-09-30')];
    const span = windows(NOW, 2);

    const beforeEnd = summarizeFollowThrough(occurrences, span, new Date('2026-09-27T23:59:59.999Z'));
    const atEnd = summarizeFollowThrough(occurrences, span, new Date('2026-09-28T00:00:00.000Z'));
    const pastEnd = summarizeFollowThrough(occurrences, span, new Date('2026-10-12T00:00:00.000Z'));

    expect(firstWeek(beforeEnd).closed).toBe(false);
    expect(firstWeek(atEnd).closed).toBe(true);
    expect(atEnd.weeks.map((week) => week.closed)).toEqual([true, false]);
    expect(pastEnd.weeks.map((week) => week.closed)).toEqual([true, true]);
  });

  it('derives today from the supplied clock', () => {
    const occurrences = [occurrence('sw-a', '2026-09-27')];
    const span = windows(NOW, 2);

    const beforeToday = summarizeFollowThrough(occurrences, span, new Date('2026-09-27T12:00:00.000Z'));
    const onTheNextDay = summarizeFollowThrough(occurrences, span, new Date('2026-09-28T00:00:00.000Z'));

    expect(weekLine(firstWeek(beforeToday))).toBe(
      '2026-09-21T00:00:00.000Z|provisional|planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0',
    );
    expect(firstWeek(onTheNextDay).pastDue).toBe(1);
  });

  it('returns no weeks and zero totals for empty inputs', () => {
    const noOccurrences = summarizeFollowThrough([], WINDOWS, NOW);
    const noWindows = summarizeFollowThrough([occurrence('sw-a', '2026-09-22')], [], NOW);

    expect(noOccurrences.weeks).toEqual([]);
    expect(totalsLine(noOccurrences)).toBe(
      'planned:0|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0',
    );
    expect(noWindows.weeks).toEqual([]);
    expect(totalsLine(noWindows)).toBe('planned:0|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0');
  });

  it('counts a recorded occurrence as planned and not-performed, and nothing else', () => {
    const summary = summarizeFollowThrough(
      [occurrence('sw-a', '2026-09-22', { notPerformed: true })],
      WINDOWS,
      NOW,
    );

    expect(weekLines(summary)).toEqual([
      '2026-09-21T00:00:00.000Z|closed|planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:1',
    ]);
    expect(totalsLine(summary)).toBe(
      'planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:1',
    );
  });

  it('adds the record to a mixed week without moving any other counter', () => {
    // 09-22 recorded · 09-23 completed late · 09-24 on plan · 09-25 early ·
    // 09-26 live session · 09-27 past due with no session and no record.
    const summary = summarizeFollowThrough(
      [
        occurrence('sw-a', '2026-09-22', { notPerformed: true }),
        occurrence('sw-b', '2026-09-23', { completedAt: '2026-09-24T08:00:00.000Z' }),
        occurrence('sw-c', '2026-09-24', { completedAt: '2026-09-24T18:30:00.000Z' }),
        occurrence('sw-d', '2026-09-25', { completedAt: '2026-09-24T23:59:59.999Z' }),
        occurrence('sw-e', '2026-09-26', { active: true }),
        occurrence('sw-f', '2026-09-27'),
      ],
      WINDOWS,
      NOW,
    );

    const week = firstWeek(summary);
    expect(weekLine(week)).toBe(
      '2026-09-21T00:00:00.000Z|closed|planned:6|completed:3|early:1|late:1|started:1|pastDue:1|notPerformed:1',
    );
    // One fact per occurrence: the record is neither completed, nor started,
    // nor behind — it is its own factual state.
    expect(week.planned).toBe(week.completed + week.started + week.pastDue + week.notPerformed);
  });

  it('counts a record only in the week its planned date falls in', () => {
    const summary = summarizeFollowThrough(
      [
        occurrence('sw-a', '2026-09-16', { notPerformed: true }),
        occurrence('sw-b', '2026-09-24', { notPerformed: true }),
      ],
      WINDOWS,
      NOW,
    );

    expect(weekLines(summary)).toEqual([
      '2026-09-14T00:00:00.000Z|closed|planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:1',
      '2026-09-21T00:00:00.000Z|closed|planned:1|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:1',
    ]);
  });

  it('keeps a record dated outside every window excluded, like any other row', () => {
    // The 8-week horizon is the caller's span: a record never punches through
    // it, and never fabricates a week of its own.
    const summary = summarizeFollowThrough(
      [
        occurrence('sw-a', '2026-09-01', { notPerformed: true }),
        occurrence('sw-b', '2026-10-20', { notPerformed: true }),
      ],
      WINDOWS,
      NOW,
    );

    expect(summary.weeks).toEqual([]);
    expect(totalsLine(summary)).toBe(
      'planned:0|completed:0|early:0|late:0|started:0|pastDue:0|notPerformed:0',
    );
  });

  it('throws for a completed and recorded occurrence inside a window (M17 I1)', () => {
    const contradictory = occurrence('sw-a', '2026-09-22', {
      completedAt: '2026-09-22T09:00:00.000Z',
      notPerformed: true,
    });

    expect(() => summarizeFollowThrough([contradictory], WINDOWS, NOW)).toThrow(
      'Occurrence settlement contract violated: occurrence "sw-a" is both completed and recorded as not performed',
    );
  });
});
