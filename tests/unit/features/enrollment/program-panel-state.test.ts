/**
 * M17 Slice 11 — the enrollment panel's lifecycle view model.
 *
 * Pure: the three states are chosen from Slice 10's DTO verdicts and its
 * `restartAvailable` is copied, never recomputed; a null DTO degrades to the
 * pre-M17 keying (completion surface when there is no next workout, no counts,
 * no restart).
 */

import { describe, expect, it } from 'vitest';

import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import {
  resolveEnrolledPanelState,
  type PanelNextWorkout,
} from '@/features/enrollment/program-panel-state';

const NEXT: PanelNextWorkout = {
  weekNumber: 1,
  workoutOrder: 2,
  workoutName: 'Push B',
  metaLabel: '6 exercises · about 45 minutes',
  sessionState: 'not-started',
};

function closure(overrides: Partial<RunClosureSummaryDto> = {}): RunClosureSummaryDto {
  return {
    programSlug: 'fit40-beginner-strength',
    totalWorkouts: 36,
    completedWorkouts: 30,
    notPerformedWorkouts: 6,
    openWorkouts: 0,
    hasOpenWorkout: false,
    openInProgramOrder: [],
    isConcluded: true,
    isProgramComplete: false,
    restartAvailable: true,
    ...overrides,
  };
}

describe('resolveEnrolledPanelState', () => {
  it('keeps a complete run on the M14 completion surface, with restart from the DTO', () => {
    const state = resolveEnrolledPanelState({
      nextWorkout: null,
      runClosure: closure({
        completedWorkouts: 36,
        notPerformedWorkouts: 0,
        isConcluded: true,
        isProgramComplete: true,
        restartAvailable: true,
      }),
    });

    expect(state).toEqual({ kind: 'complete', restartAvailable: true });
  });

  it('marks a concluded-but-incomplete run as concluded with its two counts', () => {
    const state = resolveEnrolledPanelState({ nextWorkout: NEXT, runClosure: closure() });

    expect(state).toEqual({
      kind: 'concluded',
      completedWorkouts: 30,
      notPerformedWorkouts: 6,
      restartAvailable: true,
    });
  });

  it('marks an open run as open with the DTO counts and no restart', () => {
    const state = resolveEnrolledPanelState({
      nextWorkout: NEXT,
      runClosure: closure({
        completedWorkouts: 5,
        notPerformedWorkouts: 1,
        openWorkouts: 30,
        hasOpenWorkout: true,
        isConcluded: false,
        restartAvailable: false,
      }),
    });

    expect(state).toEqual({
      kind: 'open',
      openWorkouts: 30,
      totalWorkouts: 36,
      restartAvailable: false,
    });
  });

  it('keeps a zero-workout run factual: open, zero counts, no restart', () => {
    const state = resolveEnrolledPanelState({
      nextWorkout: null,
      runClosure: closure({
        totalWorkouts: 0,
        completedWorkouts: 0,
        notPerformedWorkouts: 0,
        openWorkouts: 0,
        hasOpenWorkout: false,
        isConcluded: false,
        isProgramComplete: false,
        restartAvailable: false,
      }),
    });

    expect(state).toEqual({
      kind: 'open',
      openWorkouts: 0,
      totalWorkouts: 0,
      restartAvailable: false,
    });
  });

  it('never infers completion or restartability when the closure read failed', () => {
    const open = resolveEnrolledPanelState({ nextWorkout: NEXT, runClosure: null });
    expect(open).toEqual({
      kind: 'open',
      openWorkouts: null,
      totalWorkouts: null,
      restartAvailable: false,
    });

    const complete = resolveEnrolledPanelState({ nextWorkout: null, runClosure: null });
    expect(complete).toEqual({ kind: 'complete', restartAvailable: true });
  });

  it('copies restartAvailable exactly — never derives it from the counts', () => {
    // A concluded run whose DTO says restart is NOT available (however it got
    // that way) must be rendered without restart: the component never overrides
    // the Domain's answer.
    const state = resolveEnrolledPanelState({
      nextWorkout: null,
      runClosure: closure({ restartAvailable: false }),
    });

    expect(state.kind).toBe('concluded');
    expect(state.restartAvailable).toBe(false);
  });
});
