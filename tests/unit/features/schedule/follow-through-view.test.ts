/**
 * M16 Slice 4 tests for the follow-through view builder: presentation-only
 * shaping of the Slice 3 DTO.
 *
 * The builder names weeks, phrases counts and marks the current week. It never
 * resolves an outcome, buckets an occurrence, sums a total, decides past due or
 * early/late, decides `closed`, or reads a clock — so the fixtures below include
 * deliberately self-inconsistent DTOs: whatever the application reported is what
 * the view displays, uncorrected.
 */

import { describe, expect, it } from 'vitest';

import type {
  ConfiguredFollowThroughDto,
  FollowThroughWeekDto,
} from '@/application/dto/follow-through';
import {
  CURRENT_WEEK_LABEL,
  FOLLOW_THROUGH_DISCLOSURE,
  FOLLOW_THROUGH_HORIZON_EMPTY_MESSAGE,
  FOLLOW_THROUGH_HORIZON_LABEL,
  FOLLOW_THROUGH_TITLE,
  buildFollowThroughView,
} from '@/features/schedule/follow-through-view';

/** Wednesday 2026-09-23 sits in the week starting Monday 2026-09-21. */
const TODAY = '2026-09-23';

const ZERO_COUNTS = {
  planned: 0,
  completed: 0,
  completedEarly: 0,
  completedLate: 0,
  started: 0,
  pastDue: 0,
  notPerformed: 0,
} as const;

function week(overrides: Partial<FollowThroughWeekDto> = {}): FollowThroughWeekDto {
  return {
    weekStart: '2026-09-21T00:00:00.000Z',
    weekEnd: '2026-09-28T00:00:00.000Z',
    closed: false,
    planned: 3,
    completed: 2,
    completedEarly: 0,
    completedLate: 0,
    started: 0,
    pastDue: 1,
    notPerformed: 0,
    ...overrides,
  };
}

function report(overrides: Partial<ConfiguredFollowThroughDto> = {}): ConfiguredFollowThroughDto {
  return {
    programSlug: 'prog-1',
    today: TODAY,
    configured: true,
    weeks: [week()],
    totals: {
      planned: 3,
      completed: 2,
      completedEarly: 0,
      completedLate: 0,
      started: 0,
      pastDue: 1,
      notPerformed: 0,
    },
    notPerformedUnplaced: 0,
    ...overrides,
  };
}

/** Every string the view will render, for vocabulary scanning. */
function allLabels(dto: ConfiguredFollowThroughDto): ReadonlyArray<string> {
  const view = buildFollowThroughView(dto);
  const summaryLabels =
    view.summary.status === 'weeks'
      ? [
          view.summary.totalsLabel,
          ...view.summary.weeks.flatMap((row) => [
            row.rangeLabel,
            row.progressLabel,
            row.startedLabel ?? '',
            row.pastDueLabel ?? '',
            row.notPerformedLabel ?? '',
          ]),
        ]
      : [view.summary.message];

  return [
    view.title,
    view.horizonLabel,
    ...summaryLabels,
    view.unplacedNotPerformedLabel ?? '',
    view.disclosure,
  ];
}

describe('buildFollowThroughView', () => {
  it('uses the locked section framing and disclosure', () => {
    const view = buildFollowThroughView(report());

    expect(view.title).toBe(FOLLOW_THROUGH_TITLE);
    expect(view.horizonLabel).toBe(FOLLOW_THROUGH_HORIZON_LABEL);
    expect(view.disclosure).toBe(FOLLOW_THROUGH_DISCLOSURE);
    expect(FOLLOW_THROUGH_TITLE).toBe('This plan so far');
    expect(FOLLOW_THROUGH_HORIZON_LABEL).toBe('last 8 weeks');
  });

  it('labels a week inside one month as a collapsed range', () => {
    const view = buildFollowThroughView(report());

    if (view.summary.status !== 'weeks') throw new Error('expected weeks');
    expect(view.summary.weeks[0]?.rangeLabel).toBe('Sep 21–27');
  });

  it('names both months when a week spans two of them', () => {
    const view = buildFollowThroughView(
      report({
        weeks: [
          week({ weekStart: '2026-09-28T00:00:00.000Z', weekEnd: '2026-10-05T00:00:00.000Z' }),
        ],
      }),
    );

    if (view.summary.status !== 'weeks') throw new Error('expected weeks');
    expect(view.summary.weeks[0]?.rangeLabel).toBe('Sep 28–Oct 4');
  });

  it('returns the raw instant rather than a fabricated range for a corrupt bound', () => {
    const view = buildFollowThroughView(
      report({
        weeks: [week({ weekStart: 'not-an-instant', weekEnd: '2026-09-28T00:00:00.000Z' })],
      }),
    );

    if (view.summary.status !== 'weeks') throw new Error('expected weeks');
    expect(view.summary.weeks[0]?.rangeLabel).toBe('not-an-instant');
    expect(view.summary.weeks[0]?.isCurrent).toBe(false);
  });

  it('phrases the DTO counts verbatim, never recomputing them', () => {
    const view = buildFollowThroughView(
      report({
        // Deliberately impossible for the application to produce: completed
        // exceeds planned, and the week disagrees with the totals. The view must
        // display exactly what it was given.
        weeks: [week({ planned: 1, completed: 5, pastDue: 7, started: 2 })],
        totals: {
          planned: 1,
          completed: 5,
          completedEarly: 4,
          completedLate: 3,
          started: 2,
          pastDue: 7,
          notPerformed: 0,
        },
      }),
    );

    if (view.summary.status !== 'weeks') throw new Error('expected weeks');
    expect(view.summary.weeks[0]?.progressLabel).toBe('5 of 1 done');
    expect(view.summary.weeks[0]?.pastDueLabel).toBe('7 past due');
    expect(view.summary.weeks[0]?.startedLabel).toBe('2 started');
    expect(view.summary.totalsLabel).toBe(
      '1 planned · 5 done · 4 completed early · 3 completed late · 2 started · 7 past due',
    );
  });

  it('keeps real zeros as zeros and omits sublabels the DTO reports as zero', () => {
    const view = buildFollowThroughView(
      report({
        weeks: [week({ planned: 3, completed: 0, pastDue: 0, started: 0 })],
        totals: { ...ZERO_COUNTS },
      }),
    );

    if (view.summary.status !== 'weeks') throw new Error('expected weeks');
    expect(view.summary.weeks[0]?.progressLabel).toBe('0 of 3 done');
    expect(view.summary.weeks[0]?.pastDueLabel).toBeNull();
    expect(view.summary.weeks[0]?.startedLabel).toBeNull();
    expect(view.summary.weeks[0]?.notPerformedLabel).toBeNull();
    // The two core counts always show, even at zero.
    expect(view.summary.totalsLabel).toBe('0 planned · 0 done');
    // No recorded occurrences without a row: no pointer line at all.
    expect(view.unplacedNotPerformedLabel).toBeNull();
  });

  it('phrases the recorded-not-performed counts beside the other factual counts', () => {
    const view = buildFollowThroughView(
      report({
        weeks: [week({ planned: 3, completed: 1, pastDue: 0, notPerformed: 2 })],
        totals: {
          planned: 3,
          completed: 1,
          completedEarly: 0,
          completedLate: 0,
          started: 0,
          pastDue: 0,
          notPerformed: 2,
        },
      }),
    );

    if (view.summary.status !== 'weeks') throw new Error('expected weeks');
    // The occurrence is still planned: the record never removes it from the
    // denominator.
    expect(view.summary.weeks[0]?.progressLabel).toBe('1 of 3 done');
    expect(view.summary.weeks[0]?.notPerformedLabel).toBe('2 not performed');
    expect(view.summary.totalsLabel).toBe('3 planned · 1 done · 2 not performed');
    // Its rows exist, so it is not unplaced and nothing points elsewhere.
    expect(view.unplacedNotPerformedLabel).toBeNull();
  });

  it('points at the calendar, factually, when a recorded occurrence has no date', () => {
    const one = buildFollowThroughView(report({ notPerformedUnplaced: 1 }));
    const two = buildFollowThroughView(report({ notPerformedUnplaced: 2 }));

    // The count, the absence of a date, and the surface that owns the detail —
    // no action, no undo copy, no sentence duplicated from the calendar's list.
    expect(one.unplacedNotPerformedLabel).toBe(
      '1 recorded as not performed without a calendar date — see Training schedule',
    );
    expect(two.unplacedNotPerformedLabel).toBe(
      '2 recorded as not performed without a calendar date — see Training schedule',
    );
  });

  it('marks only the open week containing today as current', () => {
    const view = buildFollowThroughView(
      report({
        weeks: [
          week({
            weekStart: '2026-09-14T00:00:00.000Z',
            weekEnd: '2026-09-21T00:00:00.000Z',
            closed: true,
          }),
          week(),
          week({
            weekStart: '2026-09-28T00:00:00.000Z',
            weekEnd: '2026-10-05T00:00:00.000Z',
            closed: false,
          }),
        ],
      }),
    );

    if (view.summary.status !== 'weeks') throw new Error('expected weeks');
    // A closed week is never current, and an open future week is not current
    // either: provisional time is framed no differently from a closed week.
    expect(view.summary.weeks.map((row) => row.isCurrent)).toEqual([false, true, false]);
  });

  it('respects an authoritative closed flag even when today falls inside the window', () => {
    const view = buildFollowThroughView(report({ weeks: [week({ closed: true })] }));

    if (view.summary.status !== 'weeks') throw new Error('expected weeks');
    // `closed` is never recomputed from the supplied date.
    expect(view.summary.weeks[0]?.isCurrent).toBe(false);
  });

  it('reports an empty horizon honestly instead of zero totals', () => {
    const view = buildFollowThroughView(report({ weeks: [], totals: { ...ZERO_COUNTS } }));

    expect(view.summary).toEqual({
      status: 'empty',
      message: FOLLOW_THROUGH_HORIZON_EMPTY_MESSAGE,
    });
  });

  it('carries no forbidden vocabulary and no percentage', () => {
    const labels = allLabels(
      report({
        weeks: [week({ planned: 4, completed: 1, completedEarly: 1, pastDue: 3 })],
        totals: {
          planned: 4,
          completed: 1,
          completedEarly: 1,
          completedLate: 0,
          started: 0,
          pastDue: 3,
          notPerformed: 0,
        },
      }),
    ).join(' ');

    expect(CURRENT_WEEK_LABEL).toBe('This week');
    expect(labels).not.toContain('%');
    for (const banned of [
      'missed',
      'failed',
      'skipped',
      'streak',
      'adherence',
      'score',
      'goal',
      'on track',
      'off track',
    ]) {
      expect(labels.toLowerCase()).not.toContain(banned);
    }
  });
});
