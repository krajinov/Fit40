import { beforeEach, describe, expect, it } from 'vitest';

import { Difficulty } from '@/domain/types/exercise';
import { ProgramGoal } from '@/domain/types/program';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { seedCatalog } from '@/infrastructure/database/seed/seed-catalog';
import * as schema from '@/infrastructure/database/schema';
import { seedPrograms } from '@/infrastructure/programs/seed-programs';
import { resetDatabase, setupTestDb, testDb } from '../setup';

const PROGRAM_SLUG = 'fit40-beginner-strength';
const PROGRAM_ID = 'prog-beginner-strength';

describe('DrizzleProgramRepository', () => {
  beforeEach(async () => {
    await setupTestDb();
    await resetDatabase();
    await seedCatalog(testDb);
  });

  const repository = () => new DrizzleProgramRepository(testDb);

  it('lists all seeded programs', async () => {
    const programs = await repository().list();

    expect(programs.map((program) => program.slug)).toEqual(
      seedPrograms.map((program) => program.slug),
    );
  });

  it('loads program metadata', async () => {
    const program = await repository().findBySlug(PROGRAM_SLUG);

    expect(program).not.toBeNull();
    expect(program?.id).toBe(PROGRAM_ID);
    expect(program?.name).toBe('Fit40 Beginner Strength');
    expect(program?.difficulty).toBe(Difficulty.Beginner);
    expect(program?.goal).toBe(ProgramGoal.Strength);
    expect(program?.durationWeeks).toBe(6);
    expect(program?.workoutsPerWeek).toBe(3);
    const scheduledCount = program?.weeks.reduce(
      (total, week) => total + week.scheduledWorkouts.length,
      0,
    );

    expect(scheduledCount).toBe(18);
  });

  it('loads workouts with ordered exercises and prescriptions', async () => {
    const program = await repository().findBySlug(PROGRAM_SLUG);
    const [firstWorkout] = program?.workouts ?? [];

    expect(program?.workouts.map((workout) => workout.name)).toEqual([
      'Full Body A',
      'Full Body B',
      'Full Body C',
    ]);
    expect(firstWorkout?.estimatedDurationMinutes).toBe(45);
    expect(firstWorkout?.exercises.map((exercise) => exercise.order)).toEqual([1, 2, 3, 4, 5]);
    expect(firstWorkout?.exercises[0]).toMatchObject({
      exerciseId: 'ex-002',
      restSeconds: 90,
      notes: null,
      prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
    });
  });

  it('loads duration prescriptions without rep bounds', async () => {
    const program = await repository().findBySlug(PROGRAM_SLUG);
    const held = program?.workouts
      .flatMap((workout) => workout.exercises)
      .find((exercise) => exercise.prescription.type === 'duration');

    expect(held?.prescription).toEqual({ type: 'duration', sets: 3, seconds: 30 });
    expect(held?.restSeconds).toBe(60);
  });

  it('round-trips nullable notes and custom rest seconds', async () => {
    await testDb.insert(schema.workouts).values({
      id: 'wo-notes-probe',
      programId: PROGRAM_ID,
      slug: 'notes-probe',
      name: 'Notes Probe',
      description: 'Exercises the nullable columns of the program aggregate.',
      estimatedDurationMinutes: 30,
    });
    await testDb.insert(schema.workoutExercises).values({
      workoutId: 'wo-notes-probe',
      exerciseOrder: 1,
      exerciseId: 'ex-001',
      prescriptionType: 'reps',
      sets: 3,
      minReps: 8,
      maxReps: 12,
      durationSeconds: null,
      restSeconds: 75,
      notes: 'Stop the set when form breaks down.',
    });

    const program = await repository().findBySlug(PROGRAM_SLUG);
    const probe = program?.workouts.find((workout) => workout.id === 'wo-notes-probe');

    expect(probe?.exercises[0]?.notes).toBe('Stop the set when form breaks down.');
    expect(probe?.exercises[0]?.restSeconds).toBe(75);
  });

  it('loads weeks in order with scheduled occurrences pointing at workouts', async () => {
    const program = await repository().findBySlug(PROGRAM_SLUG);
    const workoutIds = new Set((program?.workouts ?? []).map((workout) => workout.id));

    expect(program?.weeks.map((week) => week.weekNumber)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(program?.weeks[0]?.scheduledWorkouts.map((scheduled) => scheduled.order)).toEqual([
      1, 2, 3,
    ]);
    expect(program?.weeks[0]?.scheduledWorkouts[0]?.id).toBe(`${PROGRAM_SLUG}-w1-1`);
    expect(
      (program?.weeks ?? []).every((week) =>
        week.scheduledWorkouts.every((scheduled) => workoutIds.has(scheduled.workoutId)),
      ),
    ).toBe(true);
  });

  it('returns null when program slug does not exist', async () => {
    const program = await repository().findBySlug('non-existent-program');

    expect(program).toBeNull();
  });
});
