/**
 * M15 Slice 2 — `planned_workouts` schema contract on real PostgreSQL.
 *
 * Pins the generated migration's shape: the DATE column, the composite primary
 * key, the exact name of the one-per-date unique constraint the repository
 * translates, the FK delete rules that give M15 its lifecycle cleanup, and the
 * standalone index the FK RESTRICT check needs.
 */

import { afterAll, describe, expect, it } from 'vitest';

import { client, closeDatabase } from './setup';

afterAll(async () => {
  await closeDatabase();
});

describe('planned_workouts schema', () => {
  it('persists planned_date as a NOT NULL date column', async () => {
    const rows = await client<{ data_type: string; is_nullable: string }[]>`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_name = 'planned_workouts' AND column_name = 'planned_date'
    `;

    expect(rows).toHaveLength(1);
    const column = rows[0];
    if (column === undefined) throw new Error('planned_date column missing');
    expect(column.data_type).toBe('date');
    expect(column.is_nullable).toBe('NO');
  });

  it('keys one planned workout per occurrence with the composite primary key', async () => {
    const rows = await client<{ conname: string; columns: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS columns
      FROM pg_constraint
      WHERE conrelid = 'planned_workouts'::regclass AND contype = 'p'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.conname).toBe('planned_workouts_enrollment_id_scheduled_workout_id_pk');
    expect(rows[0]?.columns).toContain('PRIMARY KEY (enrollment_id, scheduled_workout_id)');
  });

  it('names the one-per-date unique constraint exactly as the repository translates it', async () => {
    const rows = await client<{ conname: string; definition: string }[]>`
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conrelid = 'planned_workouts'::regclass AND contype = 'u'
    `;

    expect(rows).toHaveLength(1);
    expect(rows[0]?.conname).toBe('planned_workouts_enrollment_date_unique');
    expect(rows[0]?.definition).toContain('UNIQUE (enrollment_id, planned_date)');
  });

  it('cascades enrollment deletion and restricts scheduled-workout deletion', async () => {
    const rows = await client<{ conname: string; confdeltype: string }[]>`
      SELECT conname, confdeltype
      FROM pg_constraint
      WHERE conrelid = 'planned_workouts'::regclass AND contype = 'f'
      ORDER BY conname
    `;

    const rules = new Map(rows.map((row) => [row.conname, row.confdeltype]));
    // 'c' = ON DELETE CASCADE, 'r' = ON DELETE RESTRICT.
    expect(rules.get('planned_workouts_enrollment_id_program_enrollments_id_fk')).toBe('c');
    expect(rules.get('planned_workouts_scheduled_workout_id_scheduled_workouts_id_fk')).toBe('r');
  });

  it('indexes scheduled_workout_id for FK restrict checks', async () => {
    const rows = await client<{ indexname: string }[]>`
      SELECT indexname FROM pg_indexes WHERE tablename = 'planned_workouts'
    `;

    const indexNames = rows.map((row) => row.indexname);
    expect(indexNames).toContain('planned_workouts_scheduled_workout_id_idx');
  });

  it('rejects an impossible calendar date at the database boundary', async () => {
    // The DATE type is the structural guarantee behind the string-mode mapping:
    // a non-existent day can never be stored, so the mapper only has to reject
    // corruption that bypasses this type (pinned by the mapper unit test).
    await expect(
      client`
        INSERT INTO planned_workouts (enrollment_id, scheduled_workout_id, planned_date)
        VALUES ('enr-anything', 'sched-anything', '2026-02-30'::date)
      `,
    ).rejects.toThrow();
  });
});
