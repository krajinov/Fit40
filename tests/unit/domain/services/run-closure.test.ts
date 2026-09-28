/**
 * M17 Slice 1 — run conclusion and restartability contracts.
 *
 * Pins the authored-program denominator, the settled set
 * (`completedIds ∪ notPerformedIds`), the zero-workout rule, the
 * date-independence of conclusion, the fact-list input contract (duplicates,
 * unknown ids, overlap), and the pure restartability rule. M14's
 * `isProgramComplete` is invoked here only to prove it is unaffected.
 */

import { describe, expect, it } from 'vitest';

import { createTrainingProgram, type TrainingProgram } from '@/domain/entities/training-program';
import { createWorkout } from '@/domain/entities/workout';
import { isProgramComplete } from '@/domain/services/program-progress';
import {
  isRunConcluded,
  isRunRestartable,
  resolveRunClosure,
  type RunClosure,
} from '@/domain/services/run-closure';
import { Difficulty } from '@/domain/types/exercise';
import {
  createExerciseId,
  createScheduledWorkoutId,
  type ScheduledWorkoutId,
} from '@/domain/types/ids';
import { ProgramGoal } from '@/domain/types/program';
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

/** A `weeks` × `perWeek` program: occurrences `sched-w{week}-{order}`. */
function makeProgram(weeks = 2, perWeek = 2): TrainingProgram {
  const workouts = Array.from({ length: perWeek }, (_, index) => makeWorkout(`wo-${index + 1}`));

  const programWeeks = Array.from({ length: weeks }, (_, weekIndex) => ({
    weekNumber: weekIndex + 1,
    scheduledWorkouts: Array.from({ length: perWeek }, (_, orderIndex) => {
      const scheduled = createScheduledWorkoutId(`sched-w${weekIndex + 1}-${orderIndex + 1}`);
      const workout = workouts[orderIndex];
      if (!scheduled.ok) throw new Error(scheduled.error.message);
      if (workout === undefined) throw new Error('missing workout template for occurrence');
      return { id: scheduled.data, workoutId: workout.id, order: orderIndex + 1 };
    }),
  }));

  const result = createTrainingProgram({
    id: 'prog-test',
    name: 'Test Program',
    slug: 'test-program',
    description: 'A test program.',
    difficulty: Difficulty.Beginner,
    goal: ProgramGoal.Strength,
    durationWeeks: weeks,
    workoutsPerWeek: perWeek,
    workouts,
    weeks: programWeeks,
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/**
 * A structurally valid program with zero scheduled occurrences.
 * `createTrainingProgram` rejects that shape, so it is derived by clearing each
 * week's schedule (the M14 `makeZeroScheduledWorkoutProgram` technique): if
 * catalog data ever hydrates empty, conclusion must never be claimed from it.
 */
function makeZeroWorkoutProgram(): TrainingProgram {
  const program = makeProgram();
  return {
    ...program,
    weeks: program.weeks.map((week) => ({ ...week, scheduledWorkouts: [] })),
  };
}

function ids(values: ReadonlyArray<string>): ReadonlyArray<ScheduledWorkoutId> {
  return values.map((value) => {
    const result = createScheduledWorkoutId(value);
    if (!result.ok) throw new Error(result.error.message);
    return result.data;
  });
}

function closure(
  input: {
    readonly completed?: ReadonlyArray<string>;
    readonly notPerformed?: ReadonlyArray<string>;
    readonly program?: TrainingProgram;
  } = {},
): RunClosure {
  return resolveRunClosure(input.program ?? makeProgram(), {
    completedIds: ids(input.completed ?? []),
    notPerformedIds: ids(input.notPerformed ?? []),
  });
}

describe('resolveRunClosure', () => {
  it('is never concluded when the program defines no authored workout', () => {
    const program = makeZeroWorkoutProgram();

    const empty = resolveRunClosure(program, { completedIds: [], notPerformedIds: [] });
    const withFacts = resolveRunClosure(program, {
      completedIds: ids(['sched-w1-1']),
      notPerformedIds: ids(['sched-w1-2']),
    });

    expect(empty).toMatchObject({ totalWorkouts: 0, openWorkouts: 0, isConcluded: false });
    expect(withFacts.isConcluded).toBe(false);
    expect(withFacts.unrecognizedIds).toEqual(ids(['sched-w1-1', 'sched-w1-2']));
  });

  it('is concluded when every authored occurrence has a completed session', () => {
    const state = closure({
      completed: ['sched-w1-1', 'sched-w1-2', 'sched-w2-1', 'sched-w2-2'],
    });

    expect(state).toMatchObject({
      totalWorkouts: 4,
      completedWorkouts: 4,
      notPerformedWorkouts: 0,
      settledWorkouts: 4,
      openWorkouts: 0,
      isConcluded: true,
    });
  });

  it('is concluded when every authored occurrence is recorded as not performed', () => {
    const state = closure({
      notPerformed: ['sched-w1-1', 'sched-w1-2', 'sched-w2-1', 'sched-w2-2'],
    });

    expect(state).toMatchObject({
      completedWorkouts: 0,
      notPerformedWorkouts: 4,
      settledWorkouts: 4,
      isConcluded: true,
    });
  });

  it('is concluded when completed and not-performed together cover the program', () => {
    const state = closure({
      completed: ['sched-w1-1', 'sched-w2-2'],
      notPerformed: ['sched-w1-2', 'sched-w2-1'],
    });

    expect(state).toMatchObject({
      completedWorkouts: 2,
      notPerformedWorkouts: 2,
      settledWorkouts: 4,
      openWorkouts: 0,
      isConcluded: true,
    });
  });

  it('stays open while one authored occurrence is settled by neither fact', () => {
    const state = closure({
      completed: ['sched-w1-1'],
      notPerformed: ['sched-w2-1', 'sched-w2-2'],
    });

    expect(state.isConcluded).toBe(false);
    expect(state.openWorkouts).toBe(1);
    expect(state.openInProgramOrder.map((occurrence) => occurrence.id)).toEqual(['sched-w1-2']);
  });

  it('is a fact-only derivation: no calendar state and no clock are inputs', () => {
    // Conclusion is structurally date-free: `resolveRunClosure` takes the
    // program and the two fact lists and nothing else, so a run with no
    // calendar information at all still concludes, and an unsettled occurrence
    // keeps it open regardless of when it was or was not planned.
    const state = closure({ completed: ['sched-w1-1', 'sched-w1-2', 'sched-w2-1', 'sched-w2-2'] });

    expect(state.isConcluded).toBe(true);
    expect(state.openInProgramOrder).toEqual([]);
  });

  it('accepts each valid fact arrangement: completed-only, not-performed-only, mixed distinct', () => {
    expect(closure({ completed: ['sched-w1-1'] }).completedWorkouts).toBe(1);
    expect(closure({ notPerformed: ['sched-w1-1'] }).notPerformedWorkouts).toBe(1);

    const mixed = closure({ completed: ['sched-w1-1'], notPerformed: ['sched-w1-2'] });

    expect(mixed.completedWorkouts).toBe(1);
    expect(mixed.notPerformedWorkouts).toBe(1);
    expect(mixed.settledWorkouts).toBe(2);
    expect(mixed.openWorkouts).toBe(2);
  });

  it('counts a duplicated completed id once', () => {
    const state = closure({ completed: ['sched-w1-1', 'sched-w1-1', 'sched-w1-2'] });

    expect(state.completedWorkouts).toBe(2);
    expect(state.settledWorkouts).toBe(2);
  });

  it('counts a duplicated not-performed id once', () => {
    const state = closure({ notPerformed: ['sched-w1-1', 'sched-w1-1'] });

    expect(state.notPerformedWorkouts).toBe(1);
    expect(state.settledWorkouts).toBe(1);
    expect(state.openWorkouts).toBe(3);
  });

  it('ignores fact ids outside the authored program and reports them', () => {
    const state = closure({
      completed: ['sched-w1-1'],
      notPerformed: ['unknown-1', 'unknown-1', 'unknown-2'],
    });

    expect(state.completedWorkouts).toBe(1);
    expect(state.notPerformedWorkouts).toBe(0);
    expect(state.unrecognizedIds).toEqual(ids(['unknown-1', 'unknown-2']));
    expect(state.isConcluded).toBe(false);
  });

  it('fails loudly when an authored occurrence is settled by both facts (I1)', () => {
    const program = makeProgram();

    // Contradictory authoritative execution facts: no winner rule is invented
    // and neither fact is discarded — the impossible state is made visible (the
    // `Follow-through contract violated: …` convention), because any precedence
    // rule would report counts matching neither fact.
    expect(() =>
      resolveRunClosure(program, {
        completedIds: ids(['sched-w1-1']),
        notPerformedIds: ids(['sched-w1-1']),
      }),
    ).toThrow(
      'Run closure contract violated: occurrence "sched-w1-1" is both completed and recorded as not performed',
    );
  });

  it('fails loudly through isRunConcluded as well', () => {
    const program = makeProgram();

    expect(() =>
      isRunConcluded(program, {
        completedIds: ids(['sched-w1-1', 'sched-w1-2']),
        notPerformedIds: ids(['sched-w1-2']),
      }),
    ).toThrow('Run closure contract violated');
  });

  it('keeps an unknown id in both fact lists a foreign id, never a settlement', () => {
    const program = makeProgram();

    // The contradiction rule is scoped to AUTHORED occurrences: an id the
    // program does not define can settle nothing, so it follows the established
    // foreign-id contract — reported once, counted nowhere, no throw.
    const state = resolveRunClosure(program, {
      completedIds: ids(['unknown-1']),
      notPerformedIds: ids(['unknown-1']),
    });

    expect(state.unrecognizedIds).toEqual(ids(['unknown-1']));
    expect(state.completedWorkouts).toBe(0);
    expect(state.notPerformedWorkouts).toBe(0);
    expect(state.settledWorkouts).toBe(0);
    expect(state.isConcluded).toBe(false);
  });

  it('keeps the open occurrences in authored program order', () => {
    const state = closure({ completed: ['sched-w2-2'], notPerformed: ['sched-w1-1'] });

    expect(state.openInProgramOrder.map((occurrence) => occurrence.id)).toEqual([
      'sched-w1-2',
      'sched-w2-1',
    ]);
  });

  it('does not mutate its inputs, and fact order never changes the result', () => {
    const program = makeProgram();
    const completed = ids(['sched-w1-1', 'unknown-1']);
    const notPerformed = ids(['sched-w1-2']);

    const first = resolveRunClosure(program, {
      completedIds: completed,
      notPerformedIds: notPerformed,
    });
    const reversed = resolveRunClosure(program, {
      completedIds: [...completed].reverse(),
      notPerformedIds: [...notPerformed],
    });

    expect(first).toEqual(reversed);
    expect(completed.map(String)).toEqual(['sched-w1-1', 'unknown-1']);
    expect(notPerformed.map(String)).toEqual(['sched-w1-2']);
  });

  it('leaves isProgramComplete unchanged: a run can be concluded and incomplete', () => {
    const program = makeProgram();
    const completed = ids(['sched-w1-1']);

    const state = resolveRunClosure(program, {
      completedIds: completed,
      notPerformedIds: ids(['sched-w1-2', 'sched-w2-1', 'sched-w2-2']),
    });

    expect(state.isConcluded).toBe(true);
    // M14's completion rule sees only completed sessions: not-performed facts
    // complete nothing, so the run is concluded and explicitly NOT complete.
    expect(isProgramComplete(program, completed)).toBe(false);
    expect(isRunConcluded(program, { completedIds: completed, notPerformedIds: [] })).toBe(false);
  });
});

describe('isRunRestartable', () => {
  it('is restartable when the program is complete', () => {
    expect(isRunRestartable({ programComplete: true, runConcluded: true })).toBe(true);
  });

  it('is restartable when the run is concluded but the program is not complete', () => {
    expect(isRunRestartable({ programComplete: false, runConcluded: true })).toBe(true);
  });

  it('is not restartable while the run is open', () => {
    expect(isRunRestartable({ programComplete: false, runConcluded: false })).toBe(false);
  });

  it('is not restartable for a run with no authored workout', () => {
    const program = makeZeroWorkoutProgram();

    expect(
      isRunRestartable({
        programComplete: isProgramComplete(program, []),
        runConcluded: isRunConcluded(program, { completedIds: [], notPerformedIds: [] }),
      }),
    ).toBe(false);
  });
});
