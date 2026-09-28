import {
  createNotPerformedOccurrence,
  type NotPerformedOccurrence,
} from '@/domain/entities/not-performed-occurrence';

import type { notPerformedWorkouts } from '../schema/not-performed-workouts';

type NotPerformedWorkoutRow = typeof notPerformedWorkouts.$inferSelect;

/**
 * Reconstructs a domain NotPerformedOccurrence from a persisted row.
 *
 * The database is trusted structurally — `recorded_at` is a NOT NULL
 * `timestamptz`, both ids are NOT NULL text columns with foreign keys, and the
 * composite primary key makes one fact per occurrence per run — so a row that
 * cannot satisfy the domain invariants (an empty id, an invalid instant)
 * indicates corruption and must fail loudly rather than be silently normalized.
 *
 * This module has no write direction yet: the row mapper for recording arrives
 * with the M17 write repository, the first slice that inserts a fact.
 */
export function mapRowToNotPerformedOccurrence(
  row: NotPerformedWorkoutRow,
): NotPerformedOccurrence {
  const rowLabel = `not_performed_workouts row "${row.enrollmentId}/${row.scheduledWorkoutId}"`;

  const result = createNotPerformedOccurrence({
    enrollmentId: row.enrollmentId,
    scheduledWorkoutId: row.scheduledWorkoutId,
    recordedAt: row.recordedAt,
  });
  if (!result.ok) {
    throw new Error(`Corrupt data in ${rowLabel}: ${result.error.message}`);
  }

  return result.data;
}