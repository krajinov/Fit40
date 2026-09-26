/**
 * M15 Slice 1 — TrainingDays value object contract: ISO weekday vocabulary,
 * canonical (deduplicated, ascending) selection, and input isolation.
 */

import { describe, expect, it } from 'vitest';

import {
  createTrainingDays,
  includesWeekday,
  Weekday,
  WEEKDAY_VALUES,
} from '@/domain/value-objects/training-days';

describe('Weekday vocabulary', () => {
  it('is ISO-8601 numbered: Monday = 1 … Sunday = 7', () => {
    expect(Weekday.Monday).toBe(1);
    expect(Weekday.Thursday).toBe(4);
    expect(Weekday.Sunday).toBe(7);
    expect(WEEKDAY_VALUES).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });
});

describe('createTrainingDays', () => {
  it('accepts a valid selection', () => {
    const result = createTrainingDays([Weekday.Monday, Weekday.Wednesday, Weekday.Friday]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([1, 3, 5]);
    }
  });

  it('canonicalizes ordering regardless of input order', () => {
    const result = createTrainingDays([5, 1, 3]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([1, 3, 5]);
    }
  });

  it('normalizes duplicates into one canonical value', () => {
    const result = createTrainingDays([5, 1, 5, 1, 1]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([1, 5]);
    }
  });

  it('accepts all seven weekdays', () => {
    const result = createTrainingDays([...WEEKDAY_VALUES]);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('rejects an empty selection', () => {
    const result = createTrainingDays([]);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_TRAINING_DAYS');
      expect(result.error.message).toContain('at least one');
    }
  });

  it('rejects values that are not an integer weekday in 1..7', () => {
    for (const value of [0, 8, -1, 1.5, Number.NaN]) {
      const result = createTrainingDays([Weekday.Monday, value]);

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('INVALID_TRAINING_DAYS');
      }
    }
  });

  it('never aliases the input array', () => {
    const input = [1, 3];
    const result = createTrainingDays(input);
    if (!result.ok) throw new Error(result.error.message);

    input.push(5);

    expect(result.data).toEqual([1, 3]);
  });
});

describe('includesWeekday', () => {
  it('reports membership of the selection', () => {
    const result = createTrainingDays([Weekday.Monday, Weekday.Friday]);
    if (!result.ok) throw new Error(result.error.message);

    expect(includesWeekday(result.data, Weekday.Monday)).toBe(true);
    expect(includesWeekday(result.data, Weekday.Tuesday)).toBe(false);
  });
});
