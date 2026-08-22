import { describe, expect, it } from 'vitest';

import {
  programSlugSchema,
  weekNumberSchema,
  workoutOrderSchema,
} from '@/features/programs/schemas/program-routes-schema';

describe('programSlugSchema', () => {
  it('accepts a kebab-case slug', () => {
    const result = programSlugSchema.safeParse('fit40-beginner-strength');

    expect(result.success).toBe(true);
  });

  it('rejects a slug with spaces', () => {
    const result = programSlugSchema.safeParse('fit40 beginner');

    expect(result.success).toBe(false);
  });

  it('rejects a slug with uppercase letters', () => {
    const result = programSlugSchema.safeParse('Fit40-Beginner');

    expect(result.success).toBe(false);
  });
});

describe('weekNumberSchema', () => {
  it('accepts a positive integer string', () => {
    const result = weekNumberSchema.safeParse('3');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBe(3);
  });

  it('accepts a positive integer', () => {
    const result = weekNumberSchema.safeParse(3);

    expect(result.success).toBe(true);
  });

  it('rejects zero', () => {
    const result = weekNumberSchema.safeParse('0');

    expect(result.success).toBe(false);
  });

  it('rejects a negative number', () => {
    const result = weekNumberSchema.safeParse('-1');

    expect(result.success).toBe(false);
  });

  it('rejects a non-numeric string', () => {
    const result = weekNumberSchema.safeParse('abc');

    expect(result.success).toBe(false);
  });
});

describe('workoutOrderSchema', () => {
  it('accepts a positive integer string', () => {
    const result = workoutOrderSchema.safeParse('2');

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).toBe(2);
  });

  it('rejects zero', () => {
    const result = workoutOrderSchema.safeParse('0');

    expect(result.success).toBe(false);
  });
});