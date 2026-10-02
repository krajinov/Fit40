/**
 * M17 final review — authored program-week status (pure).
 *
 * `resolveProgramWeekStatus` decides a week's status from AUTHORED occurrence
 * truth: "completed" is decided ONLY by the enrollment's completed occurrence
 * ids, a recorded-not-performed occurrence settles a week without completing
 * it, and a concluded-but-incomplete run can never paint a week "Completed".
 * No React, no dates, no Domain call.
 */

import { describe, expect, it } from 'vitest';
import {
  resolveProgramWeekStatus,
  type ProgramWeekOccurrence,
  type ProgramWeekStatusInput,
} from '@/features/programs/week-status';

function occurrence(weekNumber: number, order: number, id: string): ProgramWeekOccurrence {
  return { scheduledWorkoutId: id, key: `${weekNumber}-${order}` };
}

/** A two-workout week: A = (1,1) / sw-a, B = (1,2) / sw-b. */
const WEEK_1: ReadonlyArray<ProgramWeekOccurrence> = [
  occurrence(1, 1, 'sw-a'),
  occurrence(1, 2, 'sw-b'),
];

function status(overrides: Partial<ProgramWeekStatusInput> = {}) {
  return resolveProgramWeekStatus({
    enrolled: true,
    weekNumber: 1,
    occurrences: WEEK_1,
    completedIds: new Set<string>(),
    recordedKeys: new Set<string>(),
    upNext: null,
    ...overrides,
  });
}

describe('resolveProgramWeekStatus', () => {
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
      recordedKeys: new Set(['1-2']),
    });
    expect(state).not.toBe('completed');
    expect(state).toBe('settled');
  });

  it('(3) is NOT completed when every authored occurrence is recorded not performed', () => {
    const state = status({ recordedKeys: new Set(['1-1', '1-2']) });
    expect(state).not.toBe('completed');
    expect(state).toBe('settled');
  });

  it('(4) marks the week holding the authoritative first OPEN occurrence in-progress', () => {
    const state = status({
      completedIds: new Set(['sw-a']),
      recordedKeys: new Set(['1-1']),
      upNext: { weekNumber: 1, workoutOrder: 2 },
    });
    expect(state).toBe('in-progress');
  });

  it('(4) never marks a week in-progress when the first open occurrence is actually recorded', () => {
    // A recorded occurrence is settled, so a week whose only "open-looking"
    // occurrences are recorded stays settled — never the run's current week.
    const state = status({
      recordedKeys: new Set(['1-1', '1-2']),
      upNext: { weekNumber: 1, workoutOrder: 1 },
    });
    expect(state).not.toBe('in-progress');
    expect(state).toBe('settled');
  });

  it('(4) leaves a week with an open occurrence (and no assignment) upcoming', () => {
    expect(status()).toBe('upcoming');
  });

  it('(5) shows a settled earlier week and a later current week for a concluded-but-incomplete run', () => {
    // Concluded run: week 1 (A completed, B recorded N) is settled; week 2
    // holds an open occurrence (only possible if the run is not concluded —
    // the "concluded" case renders the run callout, not a current week).
    const week1 = status({
      completedIds: new Set(['sw-a']),
      recordedKeys: new Set(['1-2']),
    });
    const week2 = resolveProgramWeekStatus({
      enrolled: true,
      weekNumber: 2,
      occurrences: [occurrence(2, 1, 'sw-c')],
      completedIds: new Set(['sw-a']),
      recordedKeys: new Set(['1-2']),
      upNext: { weekNumber: 2, workoutOrder: 1 },
    });
    expect(week1).toBe('settled');
    expect(week2).toBe('in-progress');
  });

  it('(5) never claims a completed week in a concluded-but-incomplete run (no false Completed)', () => {
    // Week 1: A completed, B recorded N. Week 2: C recorded N, D completed.
    const week1 = status({
      completedIds: new Set(['sw-a']),
      recordedKeys: new Set(['1-2']),
    });
    const week2 = resolveProgramWeekStatus({
      enrolled: true,
      weekNumber: 2,
      occurrences: [occurrence(2, 1, 'sw-c'), occurrence(2, 2, 'sw-d')],
      completedIds: new Set(['sw-a', 'sw-d']),
      recordedKeys: new Set(['1-2', '2-1']),
      upNext: null,
    });
    expect(week1).not.toBe('completed');
    expect(week2).not.toBe('completed');
    expect(week1).toBe('settled');
    expect(week2).toBe('settled');
  });

  it('(6) keeps a genuinely completed run all-completed', () => {
    expect(status({ completedIds: new Set(['sw-a', 'sw-b']) })).toBe('completed');
  });

  it('(7) resolves by authored identity, including a rowless recorded occurrence key', () => {
    // The rowless record is addressed by the SAME authored route key the card
    // uses ("week-order"); the id is not consulted for the record.
    const state = status({
      completedIds: new Set(['sw-a']),
      recordedKeys: new Set(['1-2']),
    });
    expect(state).toBe('settled');
  });

  it('(8) never counts a recorded occurrence as completed, even alongside a completion', () => {
    const state = status({
      completedIds: new Set(['sw-a']),
      recordedKeys: new Set(['1-2']),
    });
    expect(state).not.toBe('completed');
  });
});