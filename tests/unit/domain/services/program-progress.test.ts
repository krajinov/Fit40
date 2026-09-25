import { describe, expect, it } from 'vitest';

import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { Difficulty } from '@/domain/types/exercise';
import {
  createExerciseId,
  createScheduledWorkoutId,
  type ScheduledWorkoutId,
} from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
import {
  calculateProgramProgress,
  getNextWorkout,
  isProgramComplete,
  listScheduledWorkoutsInOrder,
  resolveProgramCompletionDate,
  type SessionCompletionFact,
} from '@/domain/services/program-progress';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';

function validExerciseId() {
  const result = createExerciseId('ex-test');
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function validRepScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function makeWorkout(id: string) {
  const result = createWorkout({
    id,
    name: `Workout ${id}`,
    slug: `workout-${id}`,
    description: 'A test workout.',
    estimatedDurationMinutes: 30,
    exercises: [
      {
        exerciseId: validExerciseId(),
        order: 1,
        prescription: validRepScheme(),
        restSeconds: 60,
      },
    ],
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledIds(ids: ReadonlyArray<string>): ReadonlyArray<ScheduledWorkoutId> {
  return ids.map((id) => {
    const result = createScheduledWorkoutId(id);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
}

function makeTwoWeekProgram(): TrainingProgram {
  const workoutA = makeWorkout('wo-a');
  const workoutB = makeWorkout('wo-b');
  const idA1 = createScheduledWorkoutId('sched-a1');
  const idA2 = createScheduledWorkoutId('sched-a2');
  const idB1 = createScheduledWorkoutId('sched-b1');
  const idB2 = createScheduledWorkoutId('sched-b2');

  if (!idA1.ok || !idA2.ok || !idB1.ok || !idB2.ok) {
    throw new Error('Invalid scheduled workout id');
  }

  const result = createTrainingProgram({
    id: 'prog-test',
    name: 'Test Program',
    slug: 'test-program',
    description: 'A test program.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: 2,
    workoutsPerWeek: 2,
    workouts: [workoutA, workoutB],
    weeks: [
      {
        weekNumber: 1,
        scheduledWorkouts: [
          { id: idA1.data, workoutId: workoutA.id, order: 1 },
          { id: idB1.data, workoutId: workoutB.id, order: 2 },
        ],
      },
      {
        weekNumber: 2,
        scheduledWorkouts: [
          { id: idA2.data, workoutId: workoutA.id, order: 1 },
          { id: idB2.data, workoutId: workoutB.id, order: 2 },
        ],
      },
    ],
  });

  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/**
 * A structurally valid program whose schedule lists zero scheduled
 * occurrences.
 *
 * `createTrainingProgram` currently rejects such a shape (every week must
 * carry exactly `workoutsPerWeek` ≥ 1 occurrences), so this fixture
 * deliberately derives it from a valid program by clearing each week's
 * schedule. It exists to pin the M14 defense-in-depth contract: if catalog
 * data ever hydrates into an empty schedule, completion must never be
 * claimed from it.
 */
function makeZeroScheduledWorkoutProgram(): TrainingProgram {
  const program = makeTwoWeekProgram();
  return {
    ...program,
    weeks: program.weeks.map((week) => ({ ...week, scheduledWorkouts: [] })),
  };
}

/** One completed-session fact for `resolveProgramCompletionDate` tests. */
function completionFact(scheduledWorkoutId: string, completedAt: string): SessionCompletionFact {
  const idResult = createScheduledWorkoutId(scheduledWorkoutId);
  if (!idResult.ok) throw new Error(idResult.error.message);
  return {
    scheduledWorkoutId: idResult.data,
    completedAt: new Date(completedAt),
  };
}

describe('listScheduledWorkoutsInOrder', () => {
  it('returns scheduled workouts in week then order sequence', () => {
    const program = makeTwoWeekProgram();

    const ordered = listScheduledWorkoutsInOrder(program);

    expect(ordered).toHaveLength(4);
    expect(ordered[0]?.id).toBe('sched-a1');
    expect(ordered[1]?.id).toBe('sched-b1');
    expect(ordered[2]?.id).toBe('sched-a2');
    expect(ordered[3]?.id).toBe('sched-b2');
  });
});

describe('calculateProgramProgress', () => {
  it('reports 0% when no workouts are completed', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, []);

    expect(progress.totalWorkouts).toBe(4);
    expect(progress.completedWorkouts).toBe(0);
    expect(progress.remainingWorkouts).toBe(4);
    expect(progress.percentage).toBe(0);
    expect(progress.unrecognizedIds).toHaveLength(0);
  });

  it('reports partial progress', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, scheduledIds(['sched-a1']));

    expect(progress.totalWorkouts).toBe(4);
    expect(progress.completedWorkouts).toBe(1);
    expect(progress.remainingWorkouts).toBe(3);
    expect(progress.percentage).toBe(25);
  });

  it('reports 100% when all workouts are completed', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, scheduledIds([
      'sched-a1',
      'sched-b1',
      'sched-a2',
      'sched-b2',
    ]));

    expect(progress.totalWorkouts).toBe(4);
    expect(progress.completedWorkouts).toBe(4);
    expect(progress.remainingWorkouts).toBe(0);
    expect(progress.percentage).toBe(100);
  });

  it('counts duplicate completion ids only once', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, scheduledIds([
      'sched-a1',
      'sched-a1',
      'sched-a1',
    ]));

    expect(progress.completedWorkouts).toBe(1);
    expect(progress.percentage).toBe(25);
  });

  it('surfaces unrecognized completion ids and ignores them in the count', () => {
    const program = makeTwoWeekProgram();

    const progress = calculateProgramProgress(program, scheduledIds([
      'sched-a1',
      'unknown-id',
    ]));

    expect(progress.completedWorkouts).toBe(1);
    expect(progress.unrecognizedIds).toEqual(['unknown-id']);
  });
});

describe('getNextWorkout', () => {
  it('returns the first workout when nothing is completed', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, []);

    expect(next?.id).toBe('sched-a1');
  });

  it('returns the first uncompleted workout in program order', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, scheduledIds(['sched-a1']));

    expect(next?.id).toBe('sched-b1');
  });

  it('handles out-of-order completion input', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, scheduledIds(['sched-b1']));

    expect(next?.id).toBe('sched-a1');
  });

  it('returns null when all workouts are completed', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, scheduledIds([
      'sched-a1',
      'sched-b1',
      'sched-a2',
      'sched-b2',
    ]));

    expect(next).toBeNull();
  });

  it('ignores unknown completion ids', () => {
    const program = makeTwoWeekProgram();

    const next = getNextWorkout(program, scheduledIds(['unknown-id']));

    expect(next?.id).toBe('sched-a1');
  });
});

describe('isProgramComplete', () => {
  it('returns false when no scheduled workout is completed', () => {
    const program = makeTwoWeekProgram();

    expect(isProgramComplete(program, [])).toBe(false);
  });

  it('returns false when some but not all scheduled workouts are completed', () => {
    const program = makeTwoWeekProgram();

    const complete = isProgramComplete(program, scheduledIds(['sched-a1', 'sched-b1']));

    expect(complete).toBe(false);
  });

  it('returns true when every scheduled workout is completed', () => {
    const program = makeTwoWeekProgram();

    const complete = isProgramComplete(
      program,
      scheduledIds(['sched-a1', 'sched-b1', 'sched-a2', 'sched-b2']),
    );

    expect(complete).toBe(true);
  });

  it('returns true when workouts were completed out of order', () => {
    const program = makeTwoWeekProgram();

    const complete = isProgramComplete(
      program,
      scheduledIds(['sched-b2', 'sched-a2', 'sched-b1', 'sched-a1']),
    );

    expect(complete).toBe(true);
  });

  it('is unaffected by duplicate completed ids', () => {
    const program = makeTwoWeekProgram();

    const completeWithDuplicates = isProgramComplete(
      program,
      scheduledIds(['sched-a1', 'sched-b1', 'sched-a2', 'sched-b2', 'sched-a1', 'sched-b2']),
    );
    const partialWithDuplicates = isProgramComplete(
      program,
      scheduledIds(['sched-a1', 'sched-a1', 'sched-a1']),
    );

    expect(completeWithDuplicates).toBe(true);
    expect(partialWithDuplicates).toBe(false);
  });

  it('ignores unknown completed ids when every required id is covered', () => {
    const program = makeTwoWeekProgram();

    const complete = isProgramComplete(
      program,
      scheduledIds(['sched-a1', 'sched-b1', 'sched-a2', 'sched-b2', 'unknown-id']),
    );

    expect(complete).toBe(true);
  });

  it('does not let unknown ids make an incomplete program complete', () => {
    const program = makeTwoWeekProgram();

    const complete = isProgramComplete(
      program,
      scheduledIds(['sched-a1', 'unknown-1', 'unknown-2', 'unknown-3']),
    );

    expect(complete).toBe(false);
  });

  it('returns false for a program with zero scheduled workouts', () => {
    const program = makeZeroScheduledWorkoutProgram();

    // Even coverage over an empty schedule — or stray unknown ids — must
    // never claim completion: nothing was ever scheduled.
    expect(isProgramComplete(program, [])).toBe(false);
    expect(isProgramComplete(program, scheduledIds(['unknown-id']))).toBe(false);
  });

  it('diverges deliberately from getNextWorkout for a zero-schedule program (locked M14 edge)', () => {
    // Documented, pinned, and NOT an accidental inconsistency: getNextWorkout
    // answers "no uncompleted workout" (null) for an empty schedule, which
    // the dashboard preview historically renders as its `complete` preview
    // state — unreachable with the current seeds and out of M14 scope to
    // reconcile. isProgramComplete is the authoritative completion rule for
    // the completion summary and the restart gate: false.
    const program = makeZeroScheduledWorkoutProgram();

    expect(getNextWorkout(program, [])).toBeNull();
    expect(isProgramComplete(program, [])).toBe(false);
  });
});

describe('resolveProgramCompletionDate', () => {
  it('returns null when there are no completed sessions', () => {
    const program = makeTwoWeekProgram();

    expect(resolveProgramCompletionDate(program, [])).toBeNull();
  });

  it('returns null when no session belongs to the program schedule', () => {
    const program = makeTwoWeekProgram();

    const resolved = resolveProgramCompletionDate(program, [
      completionFact('unknown-1', '2026-03-01T10:00:00.000Z'),
      completionFact('unknown-2', '2026-03-02T10:00:00.000Z'),
    ]);

    expect(resolved).toBeNull();
  });

  it('returns the completedAt of a single matching session', () => {
    const program = makeTwoWeekProgram();

    const resolved = resolveProgramCompletionDate(program, [
      completionFact('sched-a1', '2026-03-01T10:00:00.000Z'),
    ]);

    expect(resolved?.toISOString()).toBe('2026-03-01T10:00:00.000Z');
  });

  it('returns the latest completedAt among multiple matching sessions', () => {
    const program = makeTwoWeekProgram();

    const resolved = resolveProgramCompletionDate(program, [
      completionFact('sched-a1', '2026-03-01T10:00:00.000Z'),
      completionFact('sched-b1', '2026-03-05T10:00:00.000Z'),
      completionFact('sched-a2', '2026-03-03T10:00:00.000Z'),
    ]);

    expect(resolved?.toISOString()).toBe('2026-03-05T10:00:00.000Z');
  });

  it('does not depend on input order', () => {
    const program = makeTwoWeekProgram();
    const facts = [
      completionFact('sched-a1', '2026-03-01T10:00:00.000Z'),
      completionFact('sched-b1', '2026-03-05T10:00:00.000Z'),
      completionFact('sched-a2', '2026-03-03T10:00:00.000Z'),
    ];

    const forward = resolveProgramCompletionDate(program, facts);
    const reversed = resolveProgramCompletionDate(program, [...facts].reverse());

    expect(forward?.toISOString()).toBe('2026-03-05T10:00:00.000Z');
    expect(reversed?.toISOString()).toBe(forward?.toISOString());
  });

  it('does not let an unknown later session become the completion date', () => {
    const program = makeTwoWeekProgram();

    const resolved = resolveProgramCompletionDate(program, [
      completionFact('sched-a1', '2026-03-01T10:00:00.000Z'),
      completionFact('unknown-id', '2026-03-09T10:00:00.000Z'),
      completionFact('sched-b1', '2026-03-05T10:00:00.000Z'),
    ]);

    expect(resolved?.toISOString()).toBe('2026-03-05T10:00:00.000Z');
  });

  it('does not mutate its inputs and returns a fresh Date value', () => {
    const program = makeTwoWeekProgram();
    const facts = [
      completionFact('sched-a1', '2026-03-01T10:00:00.000Z'),
      completionFact('sched-b1', '2026-03-05T10:00:00.000Z'),
      completionFact('unknown-id', '2026-03-09T10:00:00.000Z'),
    ];
    const snapshot = facts.map((fact) => ({
      id: fact.scheduledWorkoutId,
      completedAt: fact.completedAt.toISOString(),
    }));

    const resolved = resolveProgramCompletionDate(program, facts);

    expect(resolved?.toISOString()).toBe('2026-03-05T10:00:00.000Z');
    // The array, its order, and every fact's date are untouched...
    expect(
      facts.map((fact) => ({
        id: fact.scheduledWorkoutId,
        completedAt: fact.completedAt.toISOString(),
      })),
    ).toEqual(snapshot);
    // ...and the result never aliases a supplied Date, so mutating it cannot
    // reach back into the inputs.
    expect(resolved).not.toBe(facts[1]?.completedAt);
  });
});