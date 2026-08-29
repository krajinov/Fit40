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