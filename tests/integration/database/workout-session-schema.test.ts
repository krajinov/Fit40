import { describe, expect, it } from 'vitest';

import { client } from './setup';

describe('workout_sessions schema', () => {
  it('indexes scheduled_workout_id for occurrence lookups and FK restrict checks', async () => {
    const rows = await client<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'workout_sessions'
    `;

    const indexNames = rows.map((row) => row.indexname);
    expect(indexNames).toContain('workout_sessions_scheduled_workout_id_idx');
  });
});

describe('exercise_logs schema (M10)', () => {
  it('persists the skip decision as NOT NULL DEFAULT false', async () => {
    // The column contract added by migration 0009: the persisted skip
    // decision must exist on every row (pre-M10 rows hydrate as false) and
    // must be a boolean defaulting to false. There is deliberately no CHECK
    // tying it to set_logs — that rule is domain-enforced.
    const rows = await client<{ is_nullable: string; data_type: string; column_default: string }[]>`
      SELECT is_nullable, data_type, column_default
      FROM information_schema.columns
      WHERE table_name = 'exercise_logs' AND column_name = 'is_skipped'
    `;

    expect(rows).toHaveLength(1);
    const column = rows[0];
    if (column === undefined) throw new Error('is_skipped column missing');
    expect(column.is_nullable).toBe('NO');
    expect(column.data_type).toBe('boolean');
    expect(column.column_default).toBe('false');
  });
});
