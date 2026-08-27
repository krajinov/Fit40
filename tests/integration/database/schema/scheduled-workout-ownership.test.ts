/**
 * Scheduled-workout ownership.
 *
 * A scheduled occurrence carries its own `program_id`, so a foreign key on
 * `workout_id` alone cannot tell whether the referenced workout belongs to that
 * program: "program A schedules program B's workout" was storable. The composite
 * key `workouts (program_id, id)` and the foreign key from
 * `scheduled_workouts (program_id, workout_id)` to it close that hole, while the
 * delete behaviour a schedule already had — occurrences go when their workout goes
 * — is deliberately unchanged.
 */

import { beforeEach, describe, expect, it } from 'vitest';

import { and, eq, inArray } from 'drizzle-orm';

import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import { scheduledWorkouts, workouts } from '@/infrastructure/database/schema';
import { resetDatabase, setupTestDb, testDb } from '../setup';
import { failureMessage } from './constraint-helpers';

const BEGINNER_STRENGTH = 'prog-beginner-strength';
const STRONG_AT_HOME = 'prog-strong-at-home';

/**
 * A free slot in a seeded week of `prog-beginner-strength`, so the only thing a
 * write can be blamed for is the workout it names.
 */
const FREE_SLOT = {
  programId: BEGINNER_STRENGTH,
  weekNumber: 1,
  orderInWeek: 5,
};

async function rowsNamed(id: string) {
  return testDb.select().from(scheduledWorkouts).where(eq(scheduledWorkouts.id, id));
}

async function occurrencesOfWorkout(workoutId: string) {
  return testDb
    .select()
    .from(scheduledWorkouts)
    .where(eq(scheduledWorkouts.workoutId, workoutId));
}

describe('scheduled workout ownership', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  it('refuses an occurrence that schedules another program\'s workout', async () => {
    const message = await failureMessage(() =>
      testDb.insert(scheduledWorkouts).values({
        ...FREE_SLOT,
        id: 'sched-cross-program',
        // `wo-home-a` belongs to `prog-strong-at-home`, not to the program that
        // owns this schedule row.
        workoutId: 'wo-home-a',
      }),
    );

    expect(message).toMatch(/scheduled_workouts_workout_program_fk/);
    expect(await rowsNamed('sched-cross-program')).toHaveLength(0);
  });

  it('refuses an occurrence that names a workout which does not exist', async () => {
    const message = await failureMessage(() =>
      testDb.insert(scheduledWorkouts).values({
        ...FREE_SLOT,
        id: 'sched-missing-workout',
        workoutId: 'wo-never-created',
      }),
    );

    expect(message).toMatch(/scheduled_workouts_workout_program_fk/);
    expect(await rowsNamed('sched-missing-workout')).toHaveLength(0);
  });

  it('accepts the same workout scheduled by the program that owns it', async () => {
    await testDb.insert(scheduledWorkouts).values({
      id: 'sched-home-a-extra',
      programId: STRONG_AT_HOME,
      weekNumber: 1,
      orderInWeek: 5,
      workoutId: 'wo-home-a',
    });

    expect(await rowsNamed('sched-home-a-extra')).toHaveLength(1);
  });

  it('accepts every workout of a program scheduled inside that program', async () => {
    const owned = await testDb
      .select({ id: workouts.id })
      .from(workouts)
      .where(eq(workouts.programId, BEGINNER_STRENGTH));

    expect(owned.length).toBeGreaterThan(1);

    const rows = owned.map((workout, index) => ({
      id: `sched-owned-${workout.id}`,
      programId: BEGINNER_STRENGTH,
      weekNumber: 1,
      orderInWeek: 10 + index,
      workoutId: workout.id,
    }));

    await testDb.insert(scheduledWorkouts).values(rows);

    const stored = await testDb
      .select()
      .from(scheduledWorkouts)
      .where(inArray(scheduledWorkouts.id, rows.map((row) => row.id)));

    expect(stored).toHaveLength(owned.length);
  });

  it('still cascades a workout deletion to its occurrences and no further', async () => {
    const cascadedTo = await occurrencesOfWorkout('wo-home-c');
    const untouched = await occurrencesOfWorkout('wo-home-a');

    expect(cascadedTo.length).toBeGreaterThan(0);
    expect(untouched.length).toBeGreaterThan(0);

    await testDb.delete(workouts).where(eq(workouts.id, 'wo-home-c'));

    expect(await occurrencesOfWorkout('wo-home-c')).toHaveLength(0);
    expect(
      await testDb
        .select()
        .from(scheduledWorkouts)
        .where(
          and(
            eq(scheduledWorkouts.programId, STRONG_AT_HOME),
            eq(scheduledWorkouts.workoutId, 'wo-home-a'),
          ),
        ),
    ).toHaveLength(untouched.length);
  });
});