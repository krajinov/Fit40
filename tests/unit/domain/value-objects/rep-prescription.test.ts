import { describe, expect, it } from 'vitest';

import {
  createDurationScheme,
  createRepScheme,
} from '@/domain/value-objects/rep-prescription';

describe('createRepScheme', () => {
  it('creates a fixed-rep prescription', () => {
    const result = createRepScheme(3, 8, 8);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual({ type: 'reps', sets: 3, minReps: 8, maxReps: 8 });
  });

  it('creates a rep-range prescription', () => {
    const result = createRepScheme(3, 8, 10);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual({ type: 'reps', sets: 3, minReps: 8, maxReps: 10 });
  });

  it('rejects non-positive sets', () => {
    const result = createRepScheme(0, 8, 10);

    expect(result.ok).toBe(false);
  });

  it('rejects non-positive minReps', () => {
    const result = createRepScheme(3, 0, 10);

    expect(result.ok).toBe(false);
  });

  it('rejects maxReps below minReps', () => {
    const result = createRepScheme(3, 10, 8);

    expect(result.ok).toBe(false);
  });
});

describe('createDurationScheme', () => {
  it('creates a duration prescription', () => {
    const result = createDurationScheme(3, 30);

    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data).toEqual({ type: 'duration', sets: 3, seconds: 30 });
  });

  it('rejects non-positive sets', () => {
    const result = createDurationScheme(0, 30);

    expect(result.ok).toBe(false);
  });

  it('rejects non-positive seconds', () => {
    const result = createDurationScheme(3, 0);

    expect(result.ok).toBe(false);
  });
});