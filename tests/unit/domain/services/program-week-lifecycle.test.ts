/**
 * M17 final review — authored program-week lifecycle (pure Domain).
 *
 * `resolveProgramWeekLifecycle` decides a week's status from AUTHORED occurrence
 * truth: "completed" is decided ONLY by the enrollment's completed occurrence
 * ids, a recorded-not-performed occurrence settles a week without completing
 * it, and a concluded-but-incomplete run can never paint a week "Completed".
 * No React, no dates, no I/O — the behavioral contract the presentation layer
 * (ProgramDetail / ProgramWeekSection) renders verbatim.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveProgramWeekLifecycle,
  type OccurrenceCoordinates,
  type ProgramWeekLifecycleInput,
  type ProgramWeekOccurrence,
} from '@/domain/services/program-week-lifecycle';

function occurrence(workoutOrder: number, id: string): ProgramWeekOccurrence {
  return { scheduledWorkoutId: id, workoutOrder };
}

function recorded(weekNumber: number, workoutOrder: number): OccurrenceCoordinates {
  return { weekNumber, workoutOrder };
}

/** A two-workout week: A = order 1 / sw-a, B = order 2 / sw-b. */
const WEEK_1: ReadonlyArray<ProgramWeekOccurrence> = [
  occurrence(1, 'sw-a'),
  occurrence(2, 'sw-b'),
];

function status(overrides: Partial<ProgramWeekLifecycleInput> = {}) {
  return resolveProgramWeekLifecycle({
    enrolled: true,
    weekNumber: 1,
    occurrences: WEEK_1,
    completedIds: new Set<string>(),
    recordedCoordinates: [],
    firstOpen: null,
    ...overrides,
  });
}

describe('resolveProgramWeekLifecycle', () => {
  it('reports every week upcoming for an anonymous / not-enrolled visitor', () => {
    expect(status({ enrolled: false })).toBe('upcoming');
  });

  it('reports an authored-empty week upcoming — nothing to claim', () => {
    expect(status({ occurrences: [] })).toBe('upcoming');
  });

  it('(1) is completed only when EVERY authored occurrence is completed', () => {
    expect(status({ completedIds: new Set(['sw-a', 'sw-b']) })).toBe('completed');
  });

  it('(2) is NOT completed when a completion is paired with a recorded not-performed fact', () => {
    // Week 1: A completed, B recorded N — settled, but NOT completed.
    const state = status({
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [recorded(1, 2)],
    });
    expect(state).not.toBe('completed');
    expect(state).toBe('settled');
  });

  it('(3) is NOT completed when every authored occurrence is recorded not performed', () => {
    const state = status({ recordedCoordinates: [recorded(1, 1), recorded(1, 2)] });
    expect(state).not.toBe('completed');
    expect(state).toBe('settled');
  });

  it('(4) marks the week holding the authoritative first OPEN occurrence in-progress', () => {
    const state = status({
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [recorded(1, 1)],
      firstOpen: { weekNumber: 1, workoutOrder: 2 },
    });
    expect(state).toBe('in-progress');
  });

  it('(4) never marks a week in-progress when the first open occurrence is actually recorded', () => {
    // A recorded occurrence is settled, so a week whose only "open-looking"
    // occurrences are recorded stays settled — never the run's current week.
    const state = status({
      recordedCoordinates: [recorded(1, 1), recorded(1, 2)],
      firstOpen: { weekNumber: 1, workoutOrder: 1 },
    });
    expect(state).not.toBe('in-progress');
    expect(state).toBe('settled');
  });

  it('(4) leaves a week with an open occurrence (and no assignment) upcoming', () => {
    expect(status()).toBe('upcoming');
  });

  it('(4) leaves a later untouched week upcoming while the run is current in an earlier week', () => {
    const week2 = resolveProgramWeekLifecycle({
      enrolled: true,
      weekNumber: 2,
      occurrences: [occurrence(1, 'sw-c')],
      completedIds: new Set<string>(),
      recordedCoordinates: [],
      firstOpen: { weekNumber: 1, workoutOrder: 1 },
    });
    expect(week2).toBe('upcoming');
    expect(week2).not.toBe('in-progress');
  });

  it('(5) shows a settled earlier week and a later current week for a concluded-but-incomplete run', () => {
    // Concluded run: week 1 (A completed, B recorded N) is settled; week 2
    // holds an open occurrence (only possible if the run is not concluded —
    // the "concluded" case renders the run callout, not a current week).
    const week1 = status({
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [recorded(1, 2)],
    });
    const week2 = resolveProgramWeekLifecycle({
      enrolled: true,
      weekNumber: 2,
      occurrences: [occurrence(1, 'sw-c')],
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [recorded(1, 2)],
      firstOpen: { weekNumber: 2, workoutOrder: 1 },
    });
    expect(week1).toBe('settled');
    expect(week2).toBe('in-progress');
  });

  it('(5) never claims a completed week in a concluded-but-incomplete run (no false Completed)', () => {
    // Week 1: A completed, B recorded N. Week 2: C recorded N, D completed.
    const week1 = status({
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [recorded(1, 2)],
    });
    const week2 = resolveProgramWeekLifecycle({
      enrolled: true,
      weekNumber: 2,
      occurrences: [occurrence(1, 'sw-c'), occurrence(2, 'sw-d')],
      completedIds: new Set(['sw-a', 'sw-d']),
      recordedCoordinates: [recorded(1, 2), recorded(2, 1)],
      firstOpen: null,
    });
    expect(week1).not.toBe('completed');
    expect(week2).not.toBe('completed');
    expect(week1).toBe('settled');
    expect(week2).toBe('settled');
  });

  it('(5) keeps a recorded week before the first open occurrence settled — never in-progress or upcoming', () => {
    // The degraded-schedule fact pattern at the resolver seam: week 1's only
    // occurrence is recorded (closure identity, calendar unavailable) while
    // the run's first OPEN occurrence is week 2's.
    const week1 = resolveProgramWeekLifecycle({
      enrolled: true,
      weekNumber: 1,
      occurrences: [occurrence(1, 'sw-a')],
      completedIds: new Set<string>(),
      recordedCoordinates: [recorded(1, 1)],
      firstOpen: { weekNumber: 2, workoutOrder: 1 },
    });
    expect(week1).toBe('settled');
    expect(week1).not.toBe('in-progress');
    expect(week1).not.toBe('upcoming');
  });

  it('(6) keeps a genuinely completed run all-completed', () => {
    expect(status({ completedIds: new Set(['sw-a', 'sw-b']) })).toBe('completed');
  });

  it('(7) resolves by authored identity, including a rowless recorded occurrence', () => {
    // The rowless record participates through the SAME authored coordinates the
    // card's route key encodes; the completion id is not consulted for the record.
    const state = status({
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [recorded(1, 2)],
    });
    expect(state).toBe('settled');
  });

  it('(8) never counts a recorded occurrence as completed, even alongside a completion', () => {
    const state = status({
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [recorded(1, 2)],
    });
    expect(state).not.toBe('completed');
  });
});
