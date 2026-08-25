import { beforeEach, describe, expect, it } from 'vitest';

import { programRepository, resetAndSeed } from './setup';

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
});
