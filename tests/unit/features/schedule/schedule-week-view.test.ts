import { describe, expect, it } from 'vitest';

import type { EnrollmentScheduleDto, PlannedWorkoutDto } from '@/application/dto/schedule';
import {
  buildWeekSlots,
  plannedStatusLabel,
} from '@/features/schedule/schedule-week-view';

/** Wednesday 2026-09-23: the week runs Mon 2026-09-21 → Sun 2026-09-27. */
const TODAY_MIDWEEK = '2026-09-23';

function item(overrides: Partial<PlannedWorkoutDto> = {}): PlannedWorkoutDto {
  return {
    scheduledWorkoutId: 'sw-1',
    weekNumber: 1,
    workoutOrder: 1,
    workoutName: 'Upper Body A',
    plannedDate: '2026-09-23',
    status: 'planned',
    ...overrides,
  };
}

function schedule(overrides: Partial<EnrollmentScheduleDto> = {}): EnrollmentScheduleDto {
  return {
    programSlug: 'prog-1',
    configured: true,
    today: TODAY_MIDWEEK,
    items: [],
    focus: { today: null, next: null, pastDue: null },
    ...overrides,
  };
}

describe('buildWeekSlots (M15 Slice 6)', () => {
  it('builds seven Monday-first slots for the week containing today', () => {
    const slots = buildWeekSlots(schedule());

    expect(slots).not.toBeNull();
    expect(slots?.map((slot) => slot.dayLabel)).toEqual([
      'Mon',
      'Tue',
      'Wed',
      'Thu',
      'Fri',
      'Sat',
      'Sun',
    ]);
    expect(slots?.map((slot) => slot.date)).toEqual([
      '2026-09-21',
      '2026-09-22',
      '2026-09-23',
      '2026-09-24',
      '2026-09-25',
      '2026-09-26',
      '2026-09-27',
    ]);
    expect(slots?.map((slot) => slot.dateLabel)).toEqual([
      'Sep 21',
      'Sep 22',
      'Sep 23',
      'Sep 24',
      'Sep 25',
      'Sep 26',
      'Sep 27',
    ]);
  });

  it('marks exactly the canonical today slot', () => {
    const slots = buildWeekSlots(schedule());

    expect(slots?.filter((slot) => slot.isToday).map((slot) => slot.date)).toEqual([
      TODAY_MIDWEEK,
    ]);
  });

  it('groups items onto their canonical date and ignores other weeks', () => {
    const slots = buildWeekSlots(
      schedule({
        items: [
          item({ plannedDate: '2026-09-25', workoutName: 'Friday Session' }),
          // Outside this week: last week (past due) and next week (future).
          item({ plannedDate: '2026-09-16', workoutName: 'Last Week' }),
          item({ plannedDate: '2026-09-30', workoutName: 'Next Week' }),
        ],
      }),
    );

    expect(slots?.find((slot) => slot.date === '2026-09-25')?.item?.workoutName).toBe(
      'Friday Session',
    );
    expect(slots?.every((slot) => slot.item === null)).toBe(false);
    expect(slots?.some((slot) => slot.item?.workoutName === 'Last Week')).toBe(false);
    expect(slots?.some((slot) => slot.item?.workoutName === 'Next Week')).toBe(false);
  });

  it('keeps at most one item per date deterministically (first wins)', () => {
    // A duplicate date violates the Slice 2 database invariant; the slot
    // choice must still be deterministic and multi-workout-per-day is never
    // invented.
    const slots = buildWeekSlots(
      schedule({
        items: [
          item({ plannedDate: '2026-09-25', workoutName: 'First' }),
          item({ plannedDate: '2026-09-25', scheduledWorkoutId: 'sw-2', workoutName: 'Second' }),
        ],
      }),
    );

    expect(slots?.filter((slot) => slot.item !== null)).toHaveLength(1);
    expect(slots?.find((slot) => slot.date === '2026-09-25')?.item?.workoutName).toBe('First');
  });

  it('spans a month boundary correctly', () => {
    // Wednesday 2026-09-30: Monday 2026-09-28 → Sunday 2026-10-04.
    const slots = buildWeekSlots(schedule({ today: '2026-09-30' }));

    expect(slots?.map((slot) => slot.date)).toEqual([
      '2026-09-28',
      '2026-09-29',
      '2026-09-30',
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
    ]);
    expect(slots?.map((slot) => slot.dateLabel)[0]).toBe('Sep 28');
    expect(slots?.map((slot) => slot.dateLabel)[6]).toBe('Oct 4');
  });

  it('spans a year boundary correctly', () => {
    // Thursday 2026-01-01: Monday 2025-12-29 → Sunday 2026-01-04.
    const slots = buildWeekSlots(schedule({ today: '2026-01-01' }));

    expect(slots?.map((slot) => slot.date)).toEqual([
      '2025-12-29',
      '2025-12-30',
      '2025-12-31',
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
      '2026-01-04',
    ]);
    expect(slots?.find((slot) => slot.isToday)?.date).toBe('2026-01-01');
  });

  it('degrades to null for a non-canonical today instead of inventing a week', () => {
    expect(buildWeekSlots(schedule({ today: '23-09-2026' }))).toBeNull();
    expect(buildWeekSlots(schedule({ today: '2026-02-30' }))).toBeNull();
  });

  it('never exposes raw canonical ISO dates as labels (component-based labels)', () => {
    const slots = buildWeekSlots(schedule());

    for (const slot of slots ?? []) {
      expect(slot.dateLabel).not.toContain('2026-');
      expect(slot.dateLabel).not.toContain('Invalid');
    }
  });
});

describe('plannedStatusLabel', () => {
  it('maps every DTO status to its neutral display label', () => {
    expect(plannedStatusLabel('planned')).toBe('Planned');
    expect(plannedStatusLabel('in-progress')).toBe('In progress');
    expect(plannedStatusLabel('completed')).toBe('Completed');
    expect(plannedStatusLabel('past-due')).toBe('Past due');
  });
});