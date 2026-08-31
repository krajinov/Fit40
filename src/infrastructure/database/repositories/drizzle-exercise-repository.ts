import { asc, eq, inArray } from 'drizzle-orm';

import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { Exercise } from '@/domain/entities/exercise';
import type { ExerciseId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapExerciseRow } from '../mappers/exercise-mapper';
import { exercises } from '../schema';

/**
 * Drizzle implementation of the read-only ExerciseRepository port.
 */
export class DrizzleExerciseRepository implements ExerciseRepository {
  constructor(private readonly db: Database) {}

  async list(): Promise<ReadonlyArray<Exercise>> {
    const rows = await this.db.select().from(exercises).orderBy(asc(exercises.name));
    return rows.map(mapExerciseRow);
  }

  async findBySlug(slug: string): Promise<Exercise | null> {
    const rows = await this.db
      .select()
      .from(exercises)
      .where(eq(exercises.slug, slug))
      .limit(1);

    const row = rows[0];
    return row === undefined ? null : mapExerciseRow(row);
  }

  async findByIds(ids: ReadonlyArray<ExerciseId>): Promise<ReadonlyArray<Exercise>> {
    if (ids.length === 0) {
      return [];
    }

    const rows = await this.db
      .select()
      .from(exercises)
      .where(inArray(exercises.id, [...ids]));

    return rows.map(mapExerciseRow);
  }
}
