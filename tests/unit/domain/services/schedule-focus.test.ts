/**
 * M15 Slice 1 — planned-workout status and focus derivation contract.
 *
 * Status precedence is locked: session-derived facts outrank date-derived
 * ones, so an in-progress workout with a past planned date is `in-progress`
 * and is NOT counted as past due.
 */

import { describe, expect, it } from 'vitest';

import { createPlannedWorkout, type PlannedWorkout } from '@/domain/entities/planned-workout';
import {
  PlannedWorkoutStatus,
  resolvePlannedWorkoutStatus,
  resolveScheduleFocus,
  type PlannedWorkoutFacts,
} from '@/domain/services/schedule-focus';
import { createScheduledWorkoutId } from '@/domain/types/ids';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';

const TODAY = '2026-09-28';
const YESTERDAY = '2026-09-27';
const LAST_WEEK = '2026-09-21';
const TOMORROW = '2026-09-29';
const NEXT_WEEK = '2026-10-05';

function date(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function plannedWorkout(scheduledWorkoutId: string, plannedDate: string): PlannedWorkout {
  const id = createScheduledWorkoutId(`sw-${scheduledWorkoutId}`);
  if (!id.ok) throw new Error(id.error.message);

  const result = createPlannedWorkout({
    enrollmentId: 'enr-1',
    scheduledWorkoutId: id.data,
    plannedDate: date(plannedDate),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function facts(
  scheduledWorkoutId: string,
  plannedDate: string,
  flags: {
    readonly completed?: boolean;
    readonly active?: boolean;
    readonly notPerformed?: boolean;
  } = {},
): PlannedWorkoutFacts {
  return {
    plannedWorkout: plannedWorkout(scheduledWorkoutId, plannedDate),
    hasCompletedSession: flags.completed ?? false,
    hasActiveSession: flags.active ?? false,
    hasNotPerformedRecord: flags.notPerformed ?? false,
  };
}

describe('resolvePlannedWorkoutStatus', () => {
  it('is planned for today and for a future date without a session', () => {
    expect(resolvePlannedWorkoutStatus(facts('a', TODAY), date(TODAY))).toBe(
      PlannedWorkoutStatus.Planned,
    );
    expect(resolvePlannedWorkoutStatus(facts('a', TOMORROW), date(TODAY))).toBe(
      PlannedWorkoutStatus.Planned,
    );
  });

  it('is past-due for a past date without a session', () => {
    expect(resolvePlannedWorkoutStatus(facts('a', YESTERDAY), date(TODAY))).toBe(
      PlannedWorkoutStatus.PastDue,
    );
  });

  it('is completed when the session completed', () => {
    expect(resolvePlannedWorkoutStatus(facts('a', TODAY, { completed: true }), date(TODAY))).toBe(
      PlannedWorkoutStatus.Completed,
    );
  });

  it('is in-progress when the session is live, even on a past planned date', () => {
    expect(resolvePlannedWorkoutStatus(facts('a', TODAY, { active: true }), date(TODAY))).toBe(
      PlannedWorkoutStatus.InProgress,
    );
    expect(resolvePlannedWorkoutStatus(facts('a', LAST_WEEK, { active: true }), date(TODAY))).toBe(
      PlannedWorkoutStatus.InProgress,
    );
  });

  it('keeps a completed workout with a past planned date as completed', () => {
    expect(resolvePlannedWorkoutStatus(facts('a', LAST_WEEK, { completed: true }), date(TODAY))).toBe(
      PlannedWorkoutStatus.Completed,
    );
  });
});

describe('resolveScheduleFocus — today', () => {
  it('exposes the item dated today whatever its status', () => {
    const focus = resolveScheduleFocus(
      [facts('a', TODAY, { completed: true }), facts('b', TOMORROW)],
      date(TODAY),
    );

    expect(focus.today?.plannedWorkout.scheduledWorkoutId).toBe('sw-a');
    expect(focus.next?.plannedWorkout.scheduledWorkoutId).toBe('sw-b');
  });

  it('returns null when nothing is planned for today', () => {
    const focus = resolveScheduleFocus([facts('a', TOMORROW)], date(TODAY));

    expect(focus.today).toBeNull();
  });

  it('breaks a same-date tie by occurrence id', () => {
    const focus = resolveScheduleFocus(
      [facts('b', TODAY), facts('a', TODAY)],
      date(TODAY),
    );

    expect(focus.today?.plannedWorkout.scheduledWorkoutId).toBe('sw-a');
  });
});

describe('resolveScheduleFocus — next', () => {
  it('selects the earliest not-completed item strictly after today', () => {
    const focus = resolveScheduleFocus(
      [facts('a', NEXT_WEEK), facts('b', TOMORROW), facts('c', NEXT_WEEK, { completed: true })],
      date(TODAY),
    );

    expect(focus.next?.plannedWorkout.scheduledWorkoutId).toBe('sw-b');
  });

  it('never selects today, even when today is not completed', () => {
    const focus = resolveScheduleFocus([facts('a', TODAY), facts('b', TOMORROW)], date(TODAY));

    expect(focus.next?.plannedWorkout.scheduledWorkoutId).toBe('sw-b');
  });

  it('offers a live in-progress workout planned after today as next', () => {
    const focus = resolveScheduleFocus([facts('a', TOMORROW, { active: true })], date(TODAY));

    expect(focus.next?.plannedWorkout.scheduledWorkoutId).toBe('sw-a');
    if (focus.next !== null) {
      expect(resolvePlannedWorkoutStatus(focus.next, date(TODAY))).toBe(
        PlannedWorkoutStatus.InProgress,
      );
    }
  });

  it('returns null when nothing is planned after today', () => {
    const focus = resolveScheduleFocus(
      [facts('a', TODAY, { completed: true }), facts('b', YESTERDAY, { completed: true })],
      date(TODAY),
    );

    expect(focus.next).toBeNull();
  });
});

describe('resolveScheduleFocus — past due', () => {
  it('counts the incomplete items before today and exposes the earliest', () => {
    const focus = resolveScheduleFocus(
      [facts('a', YESTERDAY), facts('b', LAST_WEEK), facts('c', TODAY)],
      date(TODAY),
    );

    expect(focus.pastDue?.count).toBe(2);
    expect(focus.pastDue?.earliest.plannedWorkout.scheduledWorkoutId).toBe('sw-b');
  });

  it('excludes completed and in-progress items from the past-due count', () => {
    const focus = resolveScheduleFocus(
      [
        facts('a', LAST_WEEK, { completed: true }),
        facts('b', LAST_WEEK, { active: true }),
        facts('c', YESTERDAY),
      ],
      date(TODAY),
    );

    expect(focus.pastDue?.count).toBe(1);
    expect(focus.pastDue?.earliest.plannedWorkout.scheduledWorkoutId).toBe('sw-c');
  });

  it('is null when nothing is behind', () => {
    const focus = resolveScheduleFocus([facts('a', TODAY), facts('b', TOMORROW)], date(TODAY));

    expect(focus.pastDue).toBeNull();
  });
});

describe('resolveScheduleFocus — determinism and empty input', () => {
  it('is independent of the input order', () => {
    const items = [
      facts('a', NEXT_WEEK),
      facts('b', LAST_WEEK),
      facts('c', TODAY),
      facts('d', TOMORROW),
    ];

    const forward = resolveScheduleFocus(items, date(TODAY));
    const reversed = resolveScheduleFocus([...items].reverse(), date(TODAY));

    expect(reversed.today?.plannedWorkout.scheduledWorkoutId).toBe(
      forward.today?.plannedWorkout.scheduledWorkoutId,
    );
    expect(reversed.next?.plannedWorkout.scheduledWorkoutId).toBe(
      forward.next?.plannedWorkout.scheduledWorkoutId,
    );
    expect(reversed.pastDue?.earliest.plannedWorkout.scheduledWorkoutId).toBe(
      forward.pastDue?.earliest.plannedWorkout.scheduledWorkoutId,
    );
    expect(reversed.pastDue?.count).toBe(forward.pastDue?.count);
  });

  it('returns an empty focus for an empty plan', () => {
    const focus = resolveScheduleFocus([], date(TODAY));

    expect(focus.today).toBeNull();
    expect(focus.next).toBeNull();
    expect(focus.pastDue).toBeNull();
    expect(focus.notPerformedRecorded).toBe(0);
  });
});

describe('resolvePlannedWorkoutStatus — not-performed', () => {
  it('is not-performed for an explicit record, on a past, today and future date', () => {
    for (const plannedDate of [LAST_WEEK, YESTERDAY, TODAY, TOMORROW, NEXT_WEEK]) {
      expect(
        resolvePlannedWorkoutStatus(facts('a', plannedDate, { notPerformed: true }), date(TODAY)),
      ).toBe(PlannedWorkoutStatus.NotPerformed);
    }
  });

  it('never derives not-performed from the date alone', () => {
    for (const plannedDate of [LAST_WEEK, YESTERDAY, TODAY, TOMORROW, NEXT_WEEK]) {
      expect(resolvePlannedWorkoutStatus(facts('a', plannedDate), date(TODAY))).not.toBe(
        PlannedWorkoutStatus.NotPerformed,
      );
    }
  });

  it('leaves the pre-M17 statuses exactly as they were', () => {
    expect(resolvePlannedWorkoutStatus(facts('a', YESTERDAY), date(TODAY))).toBe(
      PlannedWorkoutStatus.PastDue,
    );
    expect(resolvePlannedWorkoutStatus(facts('a', TODAY), date(TODAY))).toBe(
      PlannedWorkoutStatus.Planned,
    );
    expect(resolvePlannedWorkoutStatus(facts('a', TOMORROW), date(TODAY))).toBe(
      PlannedWorkoutStatus.Planned,
    );
    expect(resolvePlannedWorkoutStatus(facts('a', LAST_WEEK, { completed: true }), date(TODAY))).toBe(
      PlannedWorkoutStatus.Completed,
    );
    expect(resolvePlannedWorkoutStatus(facts('a', YESTERDAY, { active: true }), date(TODAY))).toBe(
      PlannedWorkoutStatus.InProgress,
    );
  });

  it('keeps a live session above the record', () => {
    expect(
      resolvePlannedWorkoutStatus(facts('a', YESTERDAY, { active: true, notPerformed: true }), date(TODAY)),
    ).toBe(PlannedWorkoutStatus.InProgress);
  });

  it('throws when the occurrence is both completed and recorded (M17 I1)', () => {
    expect(() =>
      resolvePlannedWorkoutStatus(
        facts('a', TODAY, { completed: true, notPerformed: true }),
        date(TODAY),
      ),
    ).toThrow(
      'Occurrence settlement contract violated: occurrence "sw-a" is both completed and recorded as not performed',
    );
  });
});

describe('resolveScheduleFocus — not-performed', () => {
  it('never counts a recorded item as past due', () => {
    const focus = resolveScheduleFocus(
      [facts('a', LAST_WEEK, { notPerformed: true }), facts('b', YESTERDAY)],
      date(TODAY),
    );

    expect(focus.pastDue?.count).toBe(1);
    expect(focus.pastDue?.earliest.plannedWorkout.scheduledWorkoutId).toBe('sw-b');
    expect(focus.notPerformedRecorded).toBe(1);
  });

  it('never offers a recorded item as next', () => {
    const focus = resolveScheduleFocus(
      [facts('a', TOMORROW, { notPerformed: true }), facts('b', NEXT_WEEK)],
      date(TODAY),
    );

    expect(focus.next?.plannedWorkout.scheduledWorkoutId).toBe('sw-b');
  });

  it('still exposes a recorded item dated today as today, with its status', () => {
    const focus = resolveScheduleFocus([facts('a', TODAY, { notPerformed: true })], date(TODAY));

    expect(focus.today?.plannedWorkout.scheduledWorkoutId).toBe('sw-a');
    expect(focus.today).not.toBeNull();
    if (focus.today !== null) {
      expect(resolvePlannedWorkoutStatus(focus.today, date(TODAY))).toBe(
        PlannedWorkoutStatus.NotPerformed,
      );
    }
  });

  it('counts recorded items and stays at zero for a pre-M17 plan', () => {
    const preM17 = resolveScheduleFocus(
      [facts('a', YESTERDAY), facts('b', TOMORROW), facts('c', LAST_WEEK, { completed: true })],
      date(TODAY),
    );
    const recorded = resolveScheduleFocus(
      [
        facts('a', YESTERDAY, { notPerformed: true }),
        facts('b', TOMORROW, { notPerformed: true }),
        facts('c', NEXT_WEEK),
      ],
      date(TODAY),
    );

    expect(preM17.notPerformedRecorded).toBe(0);
    expect(recorded.notPerformedRecorded).toBe(2);
  });

  it('throws when any supplied item is both completed and recorded (M17 I1)', () => {
    expect(() =>
      resolveScheduleFocus(
        [facts('a', TODAY, { completed: true, notPerformed: true })],
        date(TODAY),
      ),
    ).toThrow(/is both completed and recorded as not performed/);
  });
});
