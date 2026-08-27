import type { ExerciseRepository } from '@/application/ports/exercise-repository';
import type { Exercise } from '@/domain/entities/exercise';

import { eq } from 'drizzle-orm';
import { exerciseToDomain } from '../mappers/exercise-mapper';
import { exercises } from '../schema';

import type { DrizzleDatabase } from './types';

export class DrizzleExerciseRepository implements ExerciseRepository {
  constructor(private readonly db: DrizzleDatabase) {}

  async list(): Promise<ReadonlyArray<Exercise>> {
    const rows = await this.db.select().from(exercises).orderBy(exercises.name);

    return rows.map((row) => exerciseToDomain(row));
  }

  async findBySlug(slug: string): Promise<Exercise | null> {
    const rows = await this.db.select().from(exercises).where(eq(exercises.slug, slug));
    const row = rows[0];

    if (row === undefined) {
      return null;
    }

    return exerciseToDomain(row);
  }
}
