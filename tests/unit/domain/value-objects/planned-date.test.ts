/**
 * M15 Slice 1 — PlannedDate value object contract.
 *
 * Every assertion is anchored to fixed UTC literals (never to the machine's
 * local timezone), so the suite is timezone- and DST-independent: the module
 * must produce the same calendar date anywhere.
 */

import { describe, expect, it } from 'vitest';

import {
  addDaysToPlannedDate,
  comparePlannedDates,
  createPlannedDate,
  isPlannedDateAfter,
  isPlannedDateBefore,
  plannedDateFromInstant,
  plannedDatesEqual,
  plannedDateWeekday,
  startOfPlannedWeek,
  type PlannedDate,
} from '@/domain/value-objects/planned-date';
import { Weekday } from '@/domain/value-objects/training-days';

function date(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

describe('createPlannedDate', () => {
  it('accepts a normal calendar date and keeps its canonical form', () => {
    const result = createPlannedDate('2026-09-28');

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toBe('2026-09-28');
    }
  });

  it('accepts the boundaries of the four-digit year range', () => {
    expect(createPlannedDate('0000-01-01').ok).toBe(true);
    expect(createPlannedDate('9999-12-31').ok).toBe(true);
  });

  it('rejects malformed shapes', () => {
    for (const value of [
      '2026-9-28',
      '2026-09-8',
      '28-09-2026',
      '2026/09/28',
      '20260928',
      '2026-09-28T00:00:00Z',
      '2026-09-28 ',
      ' 2026-09-28',
      '',
      'not-a-date',
    ]) {
      const result = createPlannedDate(value);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PLANNED_DATE');
      }
    }
  });

  it('rejects impossible calendar dates', () => {
    for (const value of ['2026-02-30', '2026-04-31', '2026-13-01', '2026-00-10', '2026-01-00', '2026-01-32']) {
      const result = createPlannedDate(value);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_PLANNED_DATE');
      }
    }
  });

  it('handles leap years, including the century rules', () => {
    expect(createPlannedDate('2024-02-29').ok).toBe(true); // divisible by 4
    expect(createPlannedDate('2025-02-29').ok).toBe(false); // not a leap year
    expect(createPlannedDate('2000-02-29').ok).toBe(true); // divisible by 400
    expect(createPlannedDate('1900-02-29').ok).toBe(false); // divisible by 100 only
  });
});

describe('plannedDateFromInstant', () => {
  it('uses the UTC calendar day of the instant', () => {
    expect(plannedDateFromInstant(new Date('2026-09-28T00:00:00.000Z'))).toBe('2026-09-28');
    expect(plannedDateFromInstant(new Date('2026-09-28T12:00:00.000Z'))).toBe('2026-09-28');
  });

  it('does not roll the day over before UTC midnight (no local-time drift)', () => {
    expect(plannedDateFromInstant(new Date('2026-09-28T23:59:59.999Z'))).toBe('2026-09-28');
    expect(plannedDateFromInstant(new Date('2026-09-29T00:00:00.000Z'))).toBe('2026-09-29');
  });

  it('is unaffected by a local DST transition instant', () => {
    // 2026-03-29 is the European DST switch; the UTC day is unambiguous.
    expect(plannedDateFromInstant(new Date('2026-03-29T00:30:00.000Z'))).toBe('2026-03-29');
  });

  it('throws for an invalid instant (trusted-input contract violation)', () => {
    expect(() => plannedDateFromInstant(new Date('not a date'))).toThrow(/valid Date/);
  });
});

describe('comparison helpers', () => {
  it('compare by calendar order', () => {
    expect(comparePlannedDates(date('2026-09-28'), date('2026-09-28'))).toBe(0);
    expect(comparePlannedDates(date('2026-09-28'), date('2026-10-01'))).toBe(-1);
    expect(comparePlannedDates(date('2026-10-01'), date('2026-09-28'))).toBe(1);
    expect(comparePlannedDates(date('2026-12-31'), date('2027-01-01'))).toBe(-1);
  });

  it('report equality, before and after', () => {
    expect(plannedDatesEqual(date('2026-09-28'), date('2026-09-28'))).toBe(true);
    expect(plannedDatesEqual(date('2026-09-28'), date('2026-09-29'))).toBe(false);
    expect(isPlannedDateBefore(date('2026-09-28'), date('2026-09-29'))).toBe(true);
    expect(isPlannedDateBefore(date('2026-09-29'), date('2026-09-28'))).toBe(false);
    expect(isPlannedDateAfter(date('2026-09-29'), date('2026-09-28'))).toBe(true);
    expect(isPlannedDateAfter(date('2026-09-28'), date('2026-09-28'))).toBe(false);
  });
});

describe('addDaysToPlannedDate', () => {
  it('moves forward across month and year boundaries', () => {
    const monthEnd = addDaysToPlannedDate(date('2026-09-30'), 1);
    const yearEnd = addDaysToPlannedDate(date('2026-12-31'), 1);

    expect(monthEnd.ok && monthEnd.data).toBe('2026-10-01');
    expect(yearEnd.ok && yearEnd.data).toBe('2027-01-01');
  });

  it('moves backwards across month and year boundaries', () => {
    const monthStart = addDaysToPlannedDate(date('2026-10-01'), -1);
    const yearStart = addDaysToPlannedDate(date('2027-01-01'), -1);

    expect(monthStart.ok && monthStart.data).toBe('2026-09-30');
    expect(yearStart.ok && yearStart.data).toBe('2026-12-31');
  });

  it('handles the leap day in both directions', () => {
    const intoLeapDay = addDaysToPlannedDate(date('2024-02-28'), 1);
    const outOfLeapDay = addDaysToPlannedDate(date('2024-02-29'), 1);
    const nonLeapYear = addDaysToPlannedDate(date('2025-02-28'), 1);

    expect(intoLeapDay.ok && intoLeapDay.data).toBe('2024-02-29');
    expect(outOfLeapDay.ok && outOfLeapDay.data).toBe('2024-03-01');
    expect(nonLeapYear.ok && nonLeapYear.data).toBe('2025-03-01');
  });

  it('treats a day as a fixed UTC day across DST transitions', () => {
    const springForward = addDaysToPlannedDate(date('2026-03-28'), 1);
    const fallBack = addDaysToPlannedDate(date('2026-10-24'), 1);

    expect(springForward.ok && springForward.data).toBe('2026-03-29');
    expect(fallBack.ok && fallBack.data).toBe('2026-10-25');
  });

  it('returns the same date for zero days', () => {
    const result = addDaysToPlannedDate(date('2026-09-28'), 0);

    expect(result.ok && result.data).toBe('2026-09-28');
  });

  it('rejects a non-integer day count', () => {
    const result = addDaysToPlannedDate(date('2026-09-28'), 1.5);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_PLANNED_DATE');
    }
  });

  it('rejects a result outside the supported four-digit year range', () => {
    const overflow = addDaysToPlannedDate(date('9999-12-31'), 1);
    const underflow = addDaysToPlannedDate(date('0000-01-01'), -1);

    expect(overflow.ok).toBe(false);
    expect(underflow.ok).toBe(false);
    if (!overflow.ok) {
      expect(overflow.error.code).toBe('INVALID_PLANNED_DATE');
    }
    if (!underflow.ok) {
      expect(underflow.error.code).toBe('INVALID_PLANNED_DATE');
    }
  });
});

describe('plannedDateWeekday', () => {
  it('uses ISO numbering against known anchors', () => {
    expect(plannedDateWeekday(date('1970-01-01'))).toBe(Weekday.Thursday);
    expect(plannedDateWeekday(date('2024-02-29'))).toBe(Weekday.Thursday);
    expect(plannedDateWeekday(date('2026-09-28'))).toBe(Weekday.Monday);
  });

  it('covers a full week', () => {
    const week = [
      ['2026-09-28', Weekday.Monday],
      ['2026-09-29', Weekday.Tuesday],
      ['2026-09-30', Weekday.Wednesday],
      ['2026-10-01', Weekday.Thursday],
      ['2026-10-02', Weekday.Friday],
      ['2026-10-03', Weekday.Saturday],
      ['2026-10-04', Weekday.Sunday],
    ] as const;

    for (const [value, weekday] of week) {
      expect(plannedDateWeekday(date(value))).toBe(weekday);
    }
  });
});

describe('startOfPlannedWeek', () => {
  it('returns the Monday of the containing week for every weekday', () => {
    for (const value of [
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]) {
      const result = startOfPlannedWeek(date(value));

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.data).toBe('2026-09-28');
      }
    }
  });

  it('keeps a Monday on itself and starts the next week the following Monday', () => {
    const monday = startOfPlannedWeek(date('2026-09-28'));
    const nextMonday = startOfPlannedWeek(date('2026-10-05'));

    expect(monday.ok && monday.data).toBe('2026-09-28');
    expect(nextMonday.ok && nextMonday.data).toBe('2026-10-05');
  });

  it('crosses a month boundary when the week does', () => {
    const result = startOfPlannedWeek(date('2026-10-01'));

    expect(result.ok && result.data).toBe('2026-09-28');
  });
});
