import { describe, expect, it } from 'vitest';

import { client } from './setup';

describe('program_enrollments schema', () => {
  it('indexes program_id for program-scoped lookups and FK restrict checks', async () => {
    const rows = await client<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'program_enrollments'
    `;

    const indexNames = rows.map((row) => row.indexname);
    expect(indexNames).toContain('program_enrollments_program_id_idx');
  });
});
