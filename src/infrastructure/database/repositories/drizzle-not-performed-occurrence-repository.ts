import { asc, eq } from 'drizzle-orm';

import type { NotPerformedOccurrenceRepository } from '@/application/ports/not-performed-occurrence-repository';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { EnrollmentId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapRowToNotPerformedOccurrence } from '../mappers/not-performed-occurrence-mapper';
import { notPerformedWorkouts } from '../schema';

/**
 * Drizzle implementation of the read-only NotPerformedOccurrenceRepository port.
 *
 * Read-only by construction: this class contains no insert, update or delete and
 * needs no transaction. Recording and undo are enrollment-serialized writes owned
 * by the separate M17 write repository, so there is exactly one mutation
 * authority for the fact and it is not here.
 */
export class DrizzleNotPerformedOccurrenceRepository implements NotPerformedOccurrenceRepository {
  constructor(private readonly db: Database) {}

  async listByEnrollment(
    enrollmentId: EnrollmentId,
  ): Promise<ReadonlyArray<NotPerformedOccurrence>> {
    // One statement, enrollment-scoped, no joins: recording does not require a
    // planned row, so a fact whose calendar row was regenerated away is still
    // reported. Ordering comes from the query, never from implicit database
    // order — the primary key leads with enrollment_id, so scheduling the order
    // by scheduled_workout_id is a total order within the run.
    const rows = await this.db
      .select()
      .from(notPerformedWorkouts)
      .where(eq(notPerformedWorkouts.enrollmentId, enrollmentId))
      .orderBy(asc(notPerformedWorkouts.scheduledWorkoutId));

    return rows.map(mapRowToNotPerformedOccurrence);
  }
}