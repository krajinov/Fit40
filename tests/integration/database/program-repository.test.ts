import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { TrainingProgram } from '@/domain/entities/training-program';
import { createProgramId } from '@/domain/types/ids';
import { scheduledWorkouts, workouts } from '@/infrastructure/database/schema';
import { seedPrograms } from '@/infrastructure/programs/seed-programs';

import { closeDatabase, db, programRepository, resetAndSeed } from './setup';

/** Program ids are branded; the seed ids are known-valid strings. */
function pid(value: string) {
  const r = createProgramId(value);
  if (!r.ok) throw new Error(r.error.message);
  return r.data;
}

/**
 * Normalizes workout order (the aggregate treats workouts as an unordered
 * lookup set, so DB-returned order is not part of the mapping contract).
 */
function sortWorkouts(program: TrainingProgram): TrainingProgram {
  return {
    ...program,
    workouts: [...program.workouts].sort((a, b) => a.id.localeCompare(b.id)),
  };
}

describe('DrizzleProgramRepository', () => {
  beforeEach(async () => {
    await resetAndSeed();
  });

  it('list() returns programs with full nested structure', async () => {
    const programs = await programRepository.list();

    expect(programs).toHaveLength(3);

    const beginner = programs.find((program) => program.slug === 'fit40-beginner-strength');
    expect(beginner).toBeDefined();
    expect(beginner?.durationWeeks).toBe(6);
    expect(beginner?.workoutsPerWeek).toBe(3);
    expect(beginner?.workouts).toHaveLength(3);
    expect(beginner?.weeks).toHaveLength(6);
  });

  it('weeks are ordered by week_number and scheduled workouts by order', async () => {
    const beginner = await programRepository.findBySlug('fit40-beginner-strength');

    expect(beginner).not.toBeNull();
    expect(beginner?.weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3, 4, 5, 6]);

    for (const week of beginner?.weeks ?? []) {
      expect(week.scheduledWorkouts.map((scheduled) => scheduled.order)).toEqual([1, 2, 3]);
    }
  });

  it('workout exercises are ordered by exercise_order', async () => {
    const beginner = await programRepository.findBySlug('fit40-beginner-strength');
    const workout = beginner?.workouts.find((candidate) => candidate.slug === 'full-body-a');

    expect(workout).toBeDefined();
    expect(workout?.exercises.map((exercise) => exercise.order)).toEqual([1, 2, 3, 4, 5]);
    expect(workout?.exercises[0]?.restSeconds).toBe(90);
  });

  it('prescriptions map correctly (reps and duration variants)', async () => {
    const beginner = await programRepository.findBySlug('fit40-beginner-strength');
    const workout = beginner?.workouts.find((candidate) => candidate.slug === 'full-body-a');

    const reps = workout?.exercises[0]?.prescription;
    expect(reps?.type).toBe('reps');
    if (reps?.type === 'reps') {
      expect(reps.sets).toBe(3);
      expect(reps.minReps).toBe(8);
      expect(reps.maxReps).toBe(10);
    }

    const duration = workout?.exercises[3]?.prescription;
    expect(duration?.type).toBe('duration');
    if (duration?.type === 'duration') {
      expect(duration.sets).toBe(3);
      expect(duration.seconds).toBe(30);
    }
  });

  it('returns null for unknown slug', async () => {
    const program = await programRepository.findBySlug('does-not-exist');

    expect(program).toBeNull();
  });

  it('rejects a scheduled workout referencing a workout owned by a different program', async () => {
    await expect(
      db.insert(scheduledWorkouts).values({
        id: 'fit40-beginner-strength-cross-program',
        programId: 'prog-beginner-strength',
        weekNumber: 1,
        workoutId: 'wo-home-a', // owned by prog-strong-at-home
        orderInWeek: 4,
      }),
    ).rejects.toMatchObject({
      cause: expect.objectContaining({ code: '23503' }), // foreign_key_violation
    });
  });

  it('accepts scheduled workouts referencing workouts owned by the same program', async () => {
    // Repoint week 1 / order 1 to another workout template of the same program.
    await db
      .update(scheduledWorkouts)
      .set({ workoutId: 'wo-beginner-strength-b' })
      .where(eq(scheduledWorkouts.id, 'fit40-beginner-strength-w1-1'));

    const program = await programRepository.findBySlug('fit40-beginner-strength');
    expect(program).not.toBeNull();
    const weekOne = program?.weeks.find((week) => week.weekNumber === 1);
    expect(weekOne?.scheduledWorkouts[0]?.workoutId).toBe('wo-beginner-strength-b');
  });

  it('round-trips the full aggregate through the write and read mappers', async () => {
    const programs = await programRepository.list();

    expect(programs).toHaveLength(seedPrograms.length);

    for (const seeded of seedPrograms) {
      const loaded = programs.find((program) => program.id === seeded.id);
      expect(loaded).not.toBeUndefined();
      expect(sortWorkouts(loaded!)).toEqual(sortWorkouts(seeded));
    }
  });

  it('rejects a workout with zero estimated duration', async () => {
    await expect(
      db.insert(workouts).values({
        id: 'wo-test-duration-zero',
        programId: 'prog-beginner-strength',
        name: 'Test Workout',
        slug: 'test-workout-duration-zero',
        description: 'A test workout.',
        estimatedDurationMinutes: 0,
      }),
    ).rejects.toThrow();
  });

  it('rejects a workout with a negative estimated duration', async () => {
    await expect(
      db.insert(workouts).values({
        id: 'wo-test-duration-negative',
        programId: 'prog-beginner-strength',
        name: 'Test Workout',
        slug: 'test-workout-duration-negative',
        description: 'A test workout.',
        estimatedDurationMinutes: -5,
      }),
    ).rejects.toThrow();
  });

  it('accepts a workout with a positive estimated duration', async () => {
    await expect(
      db.insert(workouts).values({
        id: 'wo-test-duration-positive',
        programId: 'prog-beginner-strength',
        name: 'Test Workout',
        slug: 'test-workout-duration-positive',
        description: 'A test workout.',
        estimatedDurationMinutes: 45,
      }),
    ).resolves.toBeDefined();
  });

  it('listMetadataByIds returns only lightweight metadata for the requested programs', async () => {
    const metadata = await programRepository.listMetadataByIds([
      pid('prog-beginner-strength'),
      pid('prog-strong-at-home'),
    ]);

    expect(metadata).toHaveLength(2);
    for (const entry of metadata) {
      // Exactly the three display columns — no aggregate content leaked in.
      expect(Object.keys(entry).sort()).toEqual(['id', 'name', 'slug']);
    }
    expect(metadata.map((entry) => entry.id).sort()).toEqual([
      'prog-beginner-strength',
      'prog-strong-at-home',
    ]);
  });

  it('listMetadataByIds omits unknown program ids and returns empty for an empty request', async () => {
    const metadata = await programRepository.listMetadataByIds([
      pid('prog-beginner-strength'),
      pid('does-not-exist'),
    ]);
    expect(metadata.map((entry) => entry.id)).toEqual(['prog-beginner-strength']);

    expect(await programRepository.listMetadataByIds([])).toEqual([]);
  });
});

afterAll(async () => {
  await closeDatabase();
});
