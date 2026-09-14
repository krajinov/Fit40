import { describe, expect, it } from 'vitest';
import { logSetSchema, deleteSetSchema, completeSessionSchema, startSessionSchema, substituteExerciseSchema, restoreExerciseSchema, skipExerciseSchema, unskipExerciseSchema, moveExerciseSchema, expectedSessionVersionSchema } from '@/features/sessions/schemas/session-actions-schema';

describe('logSetSchema', () => {
  it('parses valid rep set input', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, type: 'reps', reps: 10, weightKg: 20, rpe: 7 });
    expect(r.success).toBe(true);
  });

  it('parses valid duration set input', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 2, expectedSessionVersion: 0, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null });
    expect(r.success).toBe(true);
  });

  it('rejects missing reps for rep set', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, type: 'reps', weightKg: null, rpe: null });
    expect(r.success).toBe(false);
  });

  it('rejects zero reps', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, type: 'reps', reps: 0, weightKg: null, rpe: null });
    expect(r.success).toBe(false);
  });

  it('converts empty weight to null', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, type: 'reps', reps: 10, weightKg: '', rpe: '' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.weightKg).toBeNull();
    expect(r.data.rpe).toBeNull();
  });

  it('coerces numeric-string weight and rpe the way FormData delivers them', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, type: 'reps', reps: '10', weightKg: '52.5', rpe: '7' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.weightKg).toBe(52.5);
    expect(r.data.rpe).toBe(7);
    expect(r.data.type === 'reps' && r.data.reps === 10).toBe(true);
  });

  it('treats an absent rpe field as null', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, type: 'reps', reps: '10', weightKg: null });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.rpe).toBeNull();
  });

  it('rejects an out-of-range numeric-string rpe', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, type: 'reps', reps: '10', weightKg: null, rpe: '11' });
    expect(r.success).toBe(false);
  });

  it('rejects a non-numeric weight string instead of NaN-passing it', () => {
    const r = logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, type: 'reps', reps: '10', weightKg: 'not-a-number', rpe: null });
    expect(r.success).toBe(false);
  });
});

describe('deleteSetSchema', () => {
  it('parses valid input', () => {
    const r = deleteSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, setNumber: 1 });
    expect(r.success).toBe(true);
  });

  it('rejects negative set number', () => {
    const r = deleteSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, setNumber: -1 });
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
describe('substituteExerciseSchema', () => {
  it('parses valid input', () => {
    const r = substituteExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, replacementExerciseId: 'ex-1' });
    expect(r.success).toBe(true);
  });

  it('coerces numeric-string exercise order the way FormData delivers it', () => {
    const r = substituteExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: '2', expectedSessionVersion: 0, replacementExerciseId: 'ex-1' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.exerciseOrder).toBe(2);
  });

  it('rejects an empty replacement exercise id', () => {
    const r = substituteExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, replacementExerciseId: '' });
    expect(r.success).toBe(false);
  });

  it('rejects a zero exercise order', () => {
    const r = substituteExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 0, expectedSessionVersion: 0, replacementExerciseId: 'ex-1' });
    expect(r.success).toBe(false);
  });

  it('never accepts a userId field as trusted input', () => {
    const r = substituteExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, replacementExerciseId: 'ex-1', userId: 'attacker' });
    if (!r.success) return;
    expect('userId' in r.data).toBe(false);
  });
});

describe('restoreExerciseSchema', () => {
  it('parses valid input', () => {
    const r = restoreExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0 });
    expect(r.success).toBe(true);
  });

  it('rejects a missing session id', () => {
    const r = restoreExerciseSchema.safeParse({ exerciseOrder: 1, expectedSessionVersion: 0 });
    expect(r.success).toBe(false);
  });

  it('rejects a negative exercise order', () => {
    const r = restoreExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: -1, expectedSessionVersion: 0 });
    expect(r.success).toBe(false);
  });
});

describe.each([
  ['skipExerciseSchema', skipExerciseSchema],
  ['unskipExerciseSchema', unskipExerciseSchema],
] as const)('%s', (_name, schema) => {
  it('parses valid input', () => {
    const r = schema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0 });
    expect(r.success).toBe(true);
  });

  it('rejects missing values', () => {
    expect(schema.safeParse({}).success).toBe(false);
    expect(schema.safeParse({ sessionId: 's-1' }).success).toBe(false);
    expect(schema.safeParse({ exerciseOrder: 1, expectedSessionVersion: 0 }).success).toBe(false);
  });

  it('rejects an invalid order (zero, negative, non-integer)', () => {
    expect(schema.safeParse({ sessionId: 's-1', exerciseOrder: 0, expectedSessionVersion: 0 }).success).toBe(false);
    expect(schema.safeParse({ sessionId: 's-1', exerciseOrder: -1, expectedSessionVersion: 0 }).success).toBe(false);
    expect(schema.safeParse({ sessionId: 's-1', exerciseOrder: 2.5, expectedSessionVersion: 0 }).success).toBe(false);
  });

  it('rejects a non-numeric string order instead of coercing it', () => {
    const r = schema.safeParse({ sessionId: 's-1', exerciseOrder: 'not-a-number', expectedSessionVersion: 0 });
    expect(r.success).toBe(false);
  });

  it('coerces a numeric-string order the way FormData delivers it', () => {
    const r = schema.safeParse({ sessionId: 's-1', exerciseOrder: '2', expectedSessionVersion: 0 });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.exerciseOrder).toBe(2);
  });

  it('never accepts a userId field as trusted input', () => {
    const r = schema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, userId: 'attacker' });
    if (!r.success) return;
    expect('userId' in r.data).toBe(false);
  });
});

describe('moveExerciseSchema', () => {
  it('parses valid input in both directions', () => {
    expect(moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 2, expectedSessionVersion: 0, direction: 'up' }).success).toBe(true);
    expect(moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, direction: 'down' }).success).toBe(true);
  });

  it('coerces numeric-string exercise order the way FormData delivers it', () => {
    const r = moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: '2', expectedSessionVersion: 0, direction: 'up' });
    expect(r.success).toBe(true);
    if (!r.success) return;
    expect(r.data.exerciseOrder).toBe(2);
  });

  it('rejects an unknown or missing direction', () => {
    expect(moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, direction: 'sideways' }).success).toBe(false);
    expect(moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0 }).success).toBe(false);
  });

  it('rejects an invalid order (zero, negative, non-integer)', () => {
    expect(moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 0, expectedSessionVersion: 0, direction: 'up' }).success).toBe(false);
    expect(moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: -1, expectedSessionVersion: 0, direction: 'up' }).success).toBe(false);
    expect(moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 2.5, expectedSessionVersion: 0, direction: 'up' }).success).toBe(false);
  });

  it('never accepts a userId field as trusted input', () => {
    const r = moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, direction: 'up', userId: 'attacker' });
    if (!r.success) return;
    expect('userId' in r.data).toBe(false);
  });
});

// ─── PR #13 Finding 1: the rendered-version field ────────────────────────────

describe('expectedSessionVersionSchema', () => {
  it('parses version 0 (fresh sessions) and coerces the FormData string form', () => {
    expect(expectedSessionVersionSchema.safeParse(0).success).toBe(true);
    const coerced = expectedSessionVersionSchema.safeParse('3');
    expect(coerced.success).toBe(true);
    if (!coerced.success) return;
    expect(coerced.data).toBe(3);
  });

  it('rejects negative, fractional and non-numeric versions instead of silently passing', () => {
    expect(expectedSessionVersionSchema.safeParse(-1).success).toBe(false);
    expect(expectedSessionVersionSchema.safeParse(1.5).success).toBe(false);
    expect(expectedSessionVersionSchema.safeParse('not-a-number').success).toBe(false);
  });
});

describe('stale rendered intent: every occurrence-addressed schema requires the version', () => {
  it.each([
    ['logSetSchema (reps)', () =>
      logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: -1, type: 'reps', reps: 10, weightKg: null, rpe: null })],
    ['logSetSchema (duration)', () =>
      logSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: -1, type: 'duration', durationSeconds: 30, weightKg: null, rpe: null })],
    ['deleteSetSchema', () =>
      deleteSetSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: -1, setNumber: 1 })],
    ['substituteExerciseSchema', () =>
      substituteExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: -1, replacementExerciseId: 'ex-1' })],
    ['restoreExerciseSchema', () =>
      restoreExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: -1 })],
    ['skipExerciseSchema', () =>
      skipExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: -1 })],
    ['unskipExerciseSchema', () =>
      unskipExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: -1 })],
    ['moveExerciseSchema', () =>
      moveExerciseSchema.safeParse({ sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: -1, direction: 'up' })],
  ] as const)('%s rejects a stale (negative) expected version', (_name, parse) => {
    expect(parse().success).toBe(false);
  });
});

describe('occurrence-key boundary (PR #13 Finding 1)', () => {
  // `occurrenceKey` is a presentation/persistence token only. It must NEVER
  // become part of the command surface: the business occurrence locator stays
  // (sessionId, exerciseOrder) and every action continues to address an
  // occurrence with sessionId + exerciseOrder + expectedSessionVersion.
  // Every session action schema strips a client-supplied occurrenceKey — it
  // is never carried through to the parsed command.
  const cases: ReadonlyArray<{
    readonly name: string;
    readonly parse: () => { success: boolean; data?: Record<string, unknown> };
  }> = [
    {
      name: 'logSetSchema (reps)',
      parse: () =>
        logSetSchema.safeParse({
          sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, occurrenceKey: 999,
          type: 'reps', reps: 10, weightKg: 20, rpe: null,
        }),
    },
    {
      name: 'deleteSetSchema',
      parse: () =>
        deleteSetSchema.safeParse({
          sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, occurrenceKey: 999, setNumber: 1,
        }),
    },
    {
      name: 'substituteExerciseSchema',
      parse: () =>
        substituteExerciseSchema.safeParse({
          sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, occurrenceKey: 999,
          replacementExerciseId: 'ex-2',
        }),
    },
    {
      name: 'restoreExerciseSchema',
      parse: () =>
        restoreExerciseSchema.safeParse({
          sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, occurrenceKey: 999,
        }),
    },
    {
      name: 'skipExerciseSchema',
      parse: () =>
        skipExerciseSchema.safeParse({
          sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, occurrenceKey: 999,
        }),
    },
    {
      name: 'unskipExerciseSchema',
      parse: () =>
        unskipExerciseSchema.safeParse({
          sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, occurrenceKey: 999,
        }),
    },
    {
      name: 'moveExerciseSchema',
      parse: () =>
        moveExerciseSchema.safeParse({
          sessionId: 's-1', exerciseOrder: 1, expectedSessionVersion: 0, occurrenceKey: 999, direction: 'up',
        }),
    },
  ] as const;

  it.each(cases)('$name strips a client-supplied occurrenceKey instead of accepting it', ({ parse }) => {
    const result = parse();
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data).not.toHaveProperty('occurrenceKey');
  });
});
