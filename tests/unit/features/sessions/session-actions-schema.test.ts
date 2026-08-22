import { describe, expect, it } from 'vitest';
import { logSetSchema, deleteSetSchema, completeSessionSchema, startSessionSchema } from '@/features/sessions/schemas/session-actions-schema';

describe('logSetSchema', () => {
  it('parses valid rep set input', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, type: 'reps', reps: 10, weightKg: 20, rpe: 7 });
    expect(r.success).toBe(true);
  });

  it('parses valid duration set input', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 2, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
    expect(r.success).toBe(true);
  });

  it('rejects missing reps for rep set', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, type: 'reps', weightKg: null, rpe: null });
    expect(r.success).toBe(false);
  });

  it('rejects zero reps', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, type: 'reps', reps: 0, weightKg: null, rpe: null });
    expect(r.success).toBe(false);
  });

  it('converts empty weight to null', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, type: 'reps', reps: 10, weightKg: '', rpe: '' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.weightKg).toBeNull();
    expect(r.data.rpe).toBeNull();
  });
});

describe('deleteSetSchema', () => {
  it('parses valid input', () => {
    const r = deleteSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, setNumber: 1 });
    expect(r.success).toBe(true);
  });

  it('rejects negative set number', () => {
    const r = deleteSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, setNumber: -1 });
    expect(r.success).toBe(false);
  });
});

describe('completeSessionSchema', () => {
  it('parses valid input', () => {
    const r = completeSessionSchema.safeParse({ sessionId: 's-1' });
    expect(r.success).toBe(true);
  });

  it('rejects empty session ID', () => {
    const r = completeSessionSchema.safeParse({ sessionId: '' });
    expect(r.success).toBe(false);
  });
});

describe('startSessionSchema', () => {
  it('parses valid input', () => {
    const r = startSessionSchema.safeParse({ programSlug: 'test-program', weekNumber: 1, workoutOrder: 1 });
    expect(r.success).toBe(true);
  });

  it('rejects invalid slug', () => {
    const r = startSessionSchema.safeParse({ programSlug: 'Invalid Slug!', weekNumber: 1, workoutOrder: 1 });
    expect(r.success).toBe(false);
  });
});