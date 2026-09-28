/**
 * Real-PostgreSQL fixtures for the M17 not-performed persistence suite.
 *
 * Not a test file. This slice has NO production writer for the fact, so the only
 * statement path that exists is a raw insert — users, enrollments, programs and
 * sessions come from the shared fixtures, which drive the real write paths.
 * Replacing `insertFact` with the write repository is the later M17 slice's job.
 */

import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';

import { client } from './setup';

/** One raw fact: the run, the authored occurrence, and the recorded instant. */
export interface NotPerformedRowInput {
  readonly enrollmentId: string;
  readonly scheduledWorkoutId: string;
  /** ISO-8601 instant; stored as `timestamptz` (always UTC). */
  readonly recordedAt: string;
}

/** Raw insert of one fact. The slice's only write path — no writer exists yet. */
export async function insertFact(row: NotPerformedRowInput): Promise<void> {
  await client`
    INSERT INTO not_performed_workouts (enrollment_id, scheduled_workout_id, recorded_at)
    VALUES (${row.enrollmentId}, ${row.scheduledWorkoutId}, ${row.recordedAt}::timestamptz)
  `;
}

/** How many facts one run holds, straight from SQL (a cross-check of the read). */
export async function countFacts(enrollmentId: string): Promise<number> {
  const rows = await client<{ count: string }[]>`
    SELECT count(*)::text AS count
    FROM not_performed_workouts
    WHERE enrollment_id = ${enrollmentId}
  `;

  const [row] = rows;
  if (row === undefined) throw new Error('count(*) returned no row');
  return Number.parseInt(row.count, 10);
}

/** `occurrence@instant` lines: identity AND the recorded instant. */
export function factLines(rows: ReadonlyArray<NotPerformedOccurrence>): ReadonlyArray<string> {
  return rows.map((row) => `${row.scheduledWorkoutId}@${row.recordedAt.toISOString()}`);
}