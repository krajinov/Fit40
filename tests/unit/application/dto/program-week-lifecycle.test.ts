/**
 * M17 - authored program-week lifecycle (pure Domain rule).
 *
 * Moved out of `src/features/programs/week-status.ts` (Codex architecture review)
 * deciding a week's lifecycle from authored completion / settlement / open
 * truth is business meaning, not rendering, so it lives in the Domain and
 * presentation only maps the returned value to a label and badge style.
 *
 * The behavioural contract is unchanged: "completed" is decided ONLY by the
 * completed occurrence ids, a recorded-not-performed occurrence settles a week
 * without completing it, and a concluded-but-incomplete run can never paint a
 * week "completed".
 */

import { describe, expect, it } from 'vitest';

import {
  resolveProgramWeekLifecycle,
  type ProgramWeekLifecycleFacts,
  type ProgramWeekLifecycleOccurrence,
} from '@/application/dto/program-week-lifecycle';

function occurrence(id: string, workoutOrder: number): ProgramWeekLifecycleOccurrence {
  return { scheduledWorkoutId: id, workoutOrder };
}

/** A two-workout week: A = order 1 / sw-a, B = order 2 / sw-b. */
const WEEK_1: ReadonlyArray<ProgramWeekLifecycleOccurrence> = [
  occurrence('sw-a', 1),
  occurrence('sw-b', 2),
];

function lifecycle(overrides: Partial<ProgramWeekLifecycleFacts> = {}) {
  return resolveProgramWeekLifecycle({
    weekNumber: 1,
    occurrences: WEEK_1,
    completedIds: new Set<string>(),
    notPerformedIds: new Set<string>(),
    firstOpenOccurrence: null,
    ...overrides,
  });
}

describe('resolveProgramWeekLifecycle', () => {
  it('reports an authored-empty week upcoming - nothing to claim', () => {
    expect(lifecycle({ occurrences: [] })).toBe('upcoming');
  });

  it('is completed only when EVERY authored occurrence is completed', () => {
    expect(lifecycle({ completedIds: new Set(['sw-a', 'sw-b']) })).toBe('completed');
  });

  it('is NOT completed when a completion is paired with a recorded not-performed fact', () => {
    const state = lifecycle({
      completedIds: new Set(['sw-a']),
      notPerformedIds: new Set(['sw-b']),
    });
    expect(state).not.toBe('completed');
    expect(state).toBe('settled');
  });

  it('is NOT completed when every authored occurrence is recorded not performed', () => {
    const state = lifecycle({ notPerformedIds: new Set(['sw-a', 'sw-b']) });
    expect(state).not.toBe('completed');
    expect(state).toBe('settled');
  });

  it('marks the week holding the authoritative first OPEN occurrence in-progress', () => {
    const state = lifecycle({
      completedIds: new Set(['sw-a']),
      notPerformedIds: new Set(['sw-a']),
      firstOpenOccurrence: { weekNumber: 1, workoutOrder: 2 },
    });
    expect(state).toBe('in-progress');
  });

  it('never marks a week in-progress when the first open occurrence is actually recorded', () => {
    // A recorded occurrence is settled, so a week whose only "open-looking"
    // occurrences are recorded stays settled - never the run's current week.
    const state = lifecycle({
      notPerformedIds: new Set(['sw-a', 'sw-b']),
      firstOpenOccurrence: { weekNumber: 1, workoutOrder: 1 },
    });
    expect(state).not.toBe('in-progress');
    expect(state).toBe('settled');
  });

  it('leaves a week with an open occurrence (and no assignment) upcoming', () => {
    expect(lifecycle()).toBe('upcoming');
  });

  it('shows a settled earlier week and a later current week', () => {
    const week1 = lifecycle({
      completedIds: new Set(['sw-a']),
      notPerformedIds: new Set(['sw-b']),
    });
    const week2 = resolveProgramWeekLifecycle({
      weekNumber: 2,
      occurrences: [occurrence('sw-c', 1)],
      completedIds: new Set(['sw-a']),
      notPerformedIds: new Set(['sw-b']),
      firstOpenOccurrence: { weekNumber: 2, workoutOrder: 1 },
    });
    expect(week1).toBe('settled');
    expect(week2).toBe('in-progress');
  });

  it('never claims a completed week in a concluded-but-incomplete run (no false Completed)', () => {
    // Week 1: A completed, B recorded. Week 2: C recorded, D completed.
    const week1 = lifecycle({
      completedIds: new Set(['sw-a']),
      notPerformedIds: new Set(['sw-b']),
    });
    const week2 = resolveProgramWeekLifecycle({
      weekNumber: 2,
      occurrences: [occurrence('sw-c', 1), occurrence('sw-d', 2)],
      completedIds: new Set(['sw-a', 'sw-d']),
      notPerformedIds: new Set(['sw-b', 'sw-c']),
      firstOpenOccurrence: null,
    });
    expect(week1).not.toBe('completed');
    expect(week2).not.toBe('completed');
    expect(week1).toBe('settled');
    expect(week2).toBe('settled');
  });

  it('keeps a genuinely completed run all-completed', () => {
    expect(lifecycle({ completedIds: new Set(['sw-a', 'sw-b']) })).toBe('completed');
  });

  it('resolves by authored occurrence identity, including a rowless recorded occurrence', () => {
    const state = lifecycle({
      completedIds: new Set(['sw-a']),
      notPerformedIds: new Set(['sw-b']),
    });
    expect(state).toBe('settled');
  });

  it('never counts a recorded occurrence as completed, even alongside a completion', () => {
    const state = lifecycle({
      completedIds: new Set(['sw-a']),
      notPerformedIds: new Set(['sw-b']),
    });
    expect(state).not.toBe('completed');
  });
});
