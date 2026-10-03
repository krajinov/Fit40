/**
 * M17 Slice 11 / final review — the enrollment panel's view model.
 *
 * Pure: the three states are chosen from Slice 10's DTO verdicts and its
 * `restartAvailable` is copied, never recomputed; a null DTO degrades to the
 * pre-M17 keying (completion surface when there is no next workout, no counts,
 * no restart). The CURRENT WEEK follows the run's authoritative first OPEN
 * occurrence when closure truth is available — never the completion-only M14
 * next workout — is null for a concluded-but-incomplete run, and preserves the
 * exact M14 fallback when the closure read failed.
 */

import { describe, expect, it } from 'vitest';

import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import {
  resolveEnrolledPanelState,
  type EnrolledPanelStateInput,
  type PanelNextWorkout,
} from '@/features/enrollment/program-panel-state';

const NEXT: PanelNextWorkout = {
  weekNumber: 1,
  workoutOrder: 2,
  workoutName: 'Push B',
  metaLabel: '6 exercises · about 45 minutes',
  sessionState: 'not-started',
};

const DURATION_WEEKS = 4;

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

function input(overrides: Partial<EnrolledPanelStateInput> = {}): EnrolledPanelStateInput {
  return {
    nextWorkout: NEXT,
    runClosure: closure(),
    enrollmentNextWorkout: { weekNumber: 1, workoutOrder: 2 },
    durationWeeks: DURATION_WEEKS,
    ...overrides,
  };
}

describe('resolveEnrolledPanelState — lifecycle', () => {
  it('keeps a complete run on the M14 completion surface, with restart from the DTO', () => {
    const state = resolveEnrolledPanelState(
      input({
        nextWorkout: null,
        enrollmentNextWorkout: null,
        runClosure: closure({
          completedWorkouts: 36,
          notPerformedWorkouts: 0,
          isConcluded: true,
          isProgramComplete: true,
          restartAvailable: true,
        }),
      }),
    );

    expect(state).toEqual({
      kind: 'complete',
      currentWeekNumber: DURATION_WEEKS,
      restartAvailable: true,
    });
  });

  it('marks a concluded-but-incomplete run as concluded with its two counts and NO current week', () => {
    const state = resolveEnrolledPanelState(input());

    expect(state).toEqual({
      kind: 'concluded',
      currentWeekNumber: null,
      completedWorkouts: 30,
      notPerformedWorkouts: 6,
      restartAvailable: true,
    });
  });

  it('marks an open run as open with the DTO counts, no restart, and the first open week', () => {
    const state = resolveEnrolledPanelState(
      input({
        runClosure: closure({
          completedWorkouts: 5,
          notPerformedWorkouts: 1,
          openWorkouts: 30,
          hasOpenWorkout: true,
          openInProgramOrder: [
            { scheduledWorkoutId: 'sw-1', weekNumber: 3, workoutOrder: 1, workoutName: 'C' },
          ],
          isConcluded: false,
          restartAvailable: false,
        }),
      }),
    );

    expect(state).toEqual({
      kind: 'open',
      currentWeekNumber: 3,
      openWorkouts: 30,
      totalWorkouts: 36,
      restartAvailable: false,
    });
  });

  it('keeps a zero-workout run factual: open, zero counts, no restart', () => {
    const state = resolveEnrolledPanelState(
      input({
        nextWorkout: null,
        enrollmentNextWorkout: null,
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
      }),
    );

    expect(state).toEqual({
      kind: 'open',
      currentWeekNumber: DURATION_WEEKS,
      openWorkouts: 0,
      totalWorkouts: 0,
      restartAvailable: false,
    });
  });

  it('never infers completion or restartability when the closure read failed', () => {
    const open = resolveEnrolledPanelState(input({ runClosure: null }));
    expect(open).toEqual({
      kind: 'open',
      currentWeekNumber: 1,
      openWorkouts: null,
      totalWorkouts: null,
      restartAvailable: false,
    });

    const complete = resolveEnrolledPanelState(
      input({ nextWorkout: null, enrollmentNextWorkout: null, runClosure: null }),
    );
    expect(complete).toEqual({
      kind: 'complete',
      currentWeekNumber: DURATION_WEEKS,
      restartAvailable: true,
    });
  });

  it('copies restartAvailable exactly — never derives it from the counts', () => {
    // A concluded run whose DTO says restart is NOT available (however it got
    // that way) must be rendered without restart: the component never overrides
    // the Domain's answer.
    const state = resolveEnrolledPanelState(
      input({ nextWorkout: null, runClosure: closure({ restartAvailable: false }) }),
    );

    expect(state.kind).toBe('concluded');
    expect(state.restartAvailable).toBe(false);
  });
});

describe('resolveEnrolledPanelState — current week authority (M17 final review)', () => {
  it('open run: current week follows the first OPEN occurrence, never the recorded M14 next workout', () => {
    // M14 next is B=(1,2) — an occurrence RECORDED as not performed; the first
    // OPEN authored occurrence is C=(2,1). The current week must be C's (2).
    const state = resolveEnrolledPanelState(
      input({
        nextWorkout: 'unavailable',
        enrollmentNextWorkout: { weekNumber: 1, workoutOrder: 2 },
        runClosure: closure({
          completedWorkouts: 1,
          notPerformedWorkouts: 1,
          openWorkouts: 1,
          hasOpenWorkout: true,
          openInProgramOrder: [
            { scheduledWorkoutId: 'sw-c', weekNumber: 2, workoutOrder: 1, workoutName: 'C' },
          ],
          isConcluded: false,
          restartAvailable: false,
        }),
      }),
    );

    expect(state.kind).toBe('open');
    expect(state.currentWeekNumber).toBe(2);
  });

  it('multiple settled leading weeks advance the current week to the first open one', () => {
    const state = resolveEnrolledPanelState(
      input({
        nextWorkout: 'unavailable',
        enrollmentNextWorkout: { weekNumber: 1, workoutOrder: 1 },
        runClosure: closure({
          completedWorkouts: 2,
          notPerformedWorkouts: 2,
          openWorkouts: 1,
          hasOpenWorkout: true,
          openInProgramOrder: [
            { scheduledWorkoutId: 'sw-x', weekNumber: 3, workoutOrder: 2, workoutName: 'X' },
          ],
          isConcluded: false,
          restartAvailable: false,
        }),
      }),
    );

    expect(state.currentWeekNumber).toBe(3);
  });

  it('concluded-but-incomplete: no current week even though the M14 next workout is non-null', () => {
    const state = resolveEnrolledPanelState(
      input({
        nextWorkout: null,
        enrollmentNextWorkout: { weekNumber: 1, workoutOrder: 2 },
        runClosure: closure(),
      }),
    );

    expect(state.kind).toBe('concluded');
    expect(state.currentWeekNumber).toBeNull();
  });

  it('complete: keeps the last authored week', () => {
    const state = resolveEnrolledPanelState(
      input({
        nextWorkout: null,
        enrollmentNextWorkout: null,
        runClosure: closure({ isProgramComplete: true, restartAvailable: true }),
      }),
    );

    expect(state).toEqual({
      kind: 'complete',
      currentWeekNumber: DURATION_WEEKS,
      restartAvailable: true,
    });
  });

  it('closure unavailable: preserves the exact M14 fallback week', () => {
    const resolved = resolveEnrolledPanelState(input({ runClosure: null }));
    expect(resolved.currentWeekNumber).toBe(1);

    const degraded = resolveEnrolledPanelState(
      input({
        nextWorkout: 'unavailable',
        enrollmentNextWorkout: { weekNumber: 3, workoutOrder: 4 },
        runClosure: null,
      }),
    );
    expect(degraded.currentWeekNumber).toBe(3);
  });
});
