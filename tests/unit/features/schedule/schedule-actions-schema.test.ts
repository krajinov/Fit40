import { describe, expect, it } from 'vitest';

import {
  configureTrainingDaysSchema,
  parseConfigureTrainingDaysFormData,
  parseReschedulePlannedWorkoutFormData,
  parseWeekdayValues,
  programRedirectTarget,
  reschedulePlannedWorkoutSchema,
} from '@/features/schedule/schemas/schedule-actions-schema';

function formData(entries: ReadonlyArray<readonly [string, string]>): FormData {
  const fd = new FormData();
  for (const [name, value] of entries) {
    fd.append(name, value);
  }
  return fd;
}

describe('configureTrainingDaysSchema', () => {
  it('maps repeated weekday values to numbers', () => {
    const parsed = configureTrainingDaysSchema.safeParse({
      programSlug: 'fit40-beginner-strength',
      weekdays: ['1', '3', '5'],
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({
      programSlug: 'fit40-beginner-strength',
      weekdays: [1, 3, 5],
    });
  });

  it('rejects an empty selection with the user-facing message', () => {
    const parsed = configureTrainingDaysSchema.safeParse({
      programSlug: 'fit40-beginner-strength',
      weekdays: [],
    });

    expect(parsed.success).toBe(false);
    if (parsed.success) return;
    expect(parsed.error.issues[0]?.message).toBe('Choose at least one training day.');
  });

  it('rejects out-of-range, empty and non-numeric weekday values', () => {
    for (const weekdays of [['0'], ['8'], ['abc'], [''], ['1.5']]) {
      const parsed = configureTrainingDaysSchema.safeParse({
        programSlug: 'fit40-beginner-strength',
        weekdays,
      });
      expect(parsed.success).toBe(false);
    }
  });

  it('rejects a malformed program slug', () => {
    const parsed = configureTrainingDaysSchema.safeParse({
      programSlug: 'Not A Slug!',
      weekdays: ['1'],
    });

    expect(parsed.success).toBe(false);
  });
});

describe('reschedulePlannedWorkoutSchema', () => {
  it('coerces the authored coordinates and accepts a canonical date', () => {
    const parsed = reschedulePlannedWorkoutSchema.safeParse({
      programSlug: 'fit40-beginner-strength',
      weekNumber: '2',
      workoutOrder: '3',
      date: '2026-09-30',
    });

    expect(parsed.success).toBe(true);
    if (!parsed.success) return;
    expect(parsed.data).toEqual({
      programSlug: 'fit40-beginner-strength',
      weekNumber: 2,
      workoutOrder: 3,
      date: '2026-09-30',
    });
  });

  it('rejects malformed coordinates', () => {
    for (const raw of [
      { weekNumber: '0', workoutOrder: '1' },
      { weekNumber: 'abc', workoutOrder: '1' },
      { weekNumber: '1', workoutOrder: '1.5' },
    ]) {
      const parsed = reschedulePlannedWorkoutSchema.safeParse({
        programSlug: 'fit40-beginner-strength',
        ...raw,
        date: '2026-09-30',
      });
      expect(parsed.success).toBe(false);
    }
  });

  it('rejects a non-canonical date shape without judging calendar validity', () => {
    for (const date of ['30/09/2026', '2026-9-30', '', 'tomorrow']) {
      const parsed = reschedulePlannedWorkoutSchema.safeParse({
        programSlug: 'fit40-beginner-strength',
        weekNumber: '1',
        workoutOrder: '1',
        date,
      });
      expect(parsed.success).toBe(false);
    }

    // Shape-only: an impossible calendar date passes here because the
    // application's createPlannedDate owns that rule (INVALID_DATE).
    const impossible = reschedulePlannedWorkoutSchema.safeParse({
      programSlug: 'fit40-beginner-strength',
      weekNumber: '1',
      workoutOrder: '1',
      date: '2026-02-30',
    });
    expect(impossible.success).toBe(true);
  });
});

describe('form-data parsing', () => {
  it('collects repeated weekday checkbox values', () => {
    const fd = formData([
      ['weekday', '1'],
      ['weekday', '3'],
      ['weekday', '5'],
    ]);

    expect(parseWeekdayValues(fd)).toEqual(['1', '3', '5']);
    expect(parseConfigureTrainingDaysFormData(fd)).toEqual({
      programSlug: null,
      weekdays: ['1', '3', '5'],
    });
  });

  it('reads the reschedule fields from form data', () => {
    const fd = formData([
      ['programSlug', 'fit40-beginner-strength'],
      ['weekNumber', '2'],
      ['workoutOrder', '3'],
      ['date', '2026-09-30'],
    ]);

    expect(parseReschedulePlannedWorkoutFormData(fd)).toEqual({
      programSlug: 'fit40-beginner-strength',
      weekNumber: '2',
      workoutOrder: '3',
      date: '2026-09-30',
    });
  });

  it('derives the post-login redirect target from the submitted slug', () => {
    expect(programRedirectTarget(formData([['programSlug', 'prog-1']]))).toBe('/programs/prog-1');
    expect(programRedirectTarget(formData([['programSlug', 'Not A Slug!']]))).toBe('/programs');
    expect(programRedirectTarget(new FormData())).toBe('/programs');
  });
});

describe('programRedirectTarget', () => {
  it('never echoes a non-slug value into the path', () => {
    expect(programRedirectTarget(formData([['programSlug', '../../etc/passwd']]))).toBe(
      '/programs',
    );
  });
});