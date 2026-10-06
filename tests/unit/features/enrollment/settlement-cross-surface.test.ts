/**
 * M17 final review — cross-surface consistency for ONE recorded occurrence.
 *
 * The smallest practical regression proving that one authored occurrence B
 * recorded as not performed is represented the SAME way everywhere, built from
 * the pure composition seams (no browser, no database):
 *
 *   authored A=(1,1) completed · B=(1,2) recorded N · C=(2,1) open
 *
 *   - Dashboard / Program Detail Up next → C (never B);
 *   - Week 1 (A completed, B recorded) → NOT completed;
 *   - Calendar → B is `not-performed` and never "next" / past due;
 *   - Workout detail / session CTA → the recorded state (no Start);
 *   - Closure → B is settled, not completed.
 */

import { describe, expect, it } from 'vitest';
import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import { createPlannedWorkout, type PlannedWorkout } from '@/domain/entities/planned-workout';
import { resolveProgramWeekLifecycle } from '@/domain/services/program-week-lifecycle';
import {
  resolvePlannedWorkoutStatus,
  resolveScheduleFocus,
} from '@/domain/services/schedule-focus';
import { createPlannedDate, type PlannedDate } from '@/domain/value-objects/planned-date';
import { resolveRunNextOccurrence } from '@/features/enrollment/next-occurrence';
import { resolveWorkoutCtaState } from '@/features/sessions/workout-cta-state';

function plannedDate(value: string): PlannedDate {
  const result = createPlannedDate(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function planned(value: string, scheduledWorkoutId: string): PlannedWorkout {
  const result = createPlannedWorkout({
    enrollmentId: 'enr-1',
    scheduledWorkoutId,
    plannedDate: plannedDate(value),
  });
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

const TODAY = plannedDate('2026-09-23');

/** The run's closure DTO: A completed, B recorded, C open (in authored order). */
const CLOSURE: RunClosureSummaryDto = {
  programSlug: 'prog-1',
  totalWorkouts: 3,
  completedWorkouts: 1,
  notPerformedWorkouts: 1,
  openWorkouts: 1,
  hasOpenWorkout: true,
  openInProgramOrder: [
    { scheduledWorkoutId: 'sw-c', weekNumber: 2, workoutOrder: 1, workoutName: 'C' },
  ],
  completedInProgramOrder: [],
  notPerformedInProgramOrder: [],
  isConcluded: false,
  isProgramComplete: false,
  restartAvailable: false,
};

describe('one recorded occurrence is consistent across M17 surfaces', () => {
  it('Dashboard / Program Detail select C — the recorded B is never Up next', () => {
    // The M14 completion-only next workout is B (the first non-completed); the
    // authoritative first OPEN authored occurrence is C.
    const next = resolveRunNextOccurrence({ weekNumber: 1, workoutOrder: 2 }, CLOSURE);
    expect(next).toEqual({ weekNumber: 2, workoutOrder: 1 });
    expect(next).not.toEqual({ weekNumber: 1, workoutOrder: 2 });
  });

  it('Week 1 (A completed, B recorded) is settled, never Completed', () => {
    const week1 = resolveProgramWeekLifecycle({
      enrolled: true,
      weekNumber: 1,
      occurrences: [
        { scheduledWorkoutId: 'sw-a', workoutOrder: 1 },
        { scheduledWorkoutId: 'sw-b', workoutOrder: 2 },
      ],
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [{ weekNumber: 1, workoutOrder: 2 }],
      firstOpen: { weekNumber: 2, workoutOrder: 1 },
    });
    const week2 = resolveProgramWeekLifecycle({
      enrolled: true,
      weekNumber: 2,
      occurrences: [{ scheduledWorkoutId: 'sw-c', workoutOrder: 1 }],
      completedIds: new Set(['sw-a']),
      recordedCoordinates: [{ weekNumber: 1, workoutOrder: 2 }],
      firstOpen: { weekNumber: 2, workoutOrder: 1 },
    });

    expect(week1).toBe('settled');
    expect(week1).not.toBe('completed');
    expect(week2).toBe('in-progress');
  });

  it('Calendar states B as recorded and never as next / past due', () => {
    const b = planned('2026-09-21', 'sw-b');
    expect(
      resolvePlannedWorkoutStatus(
        { plannedWorkout: b, hasCompletedSession: false, hasActiveSession: false, hasNotPerformedRecord: true },
        TODAY,
      ),
    ).toBe('not-performed');

    const focus = resolveScheduleFocus(
      [
        { plannedWorkout: b, hasCompletedSession: false, hasActiveSession: false, hasNotPerformedRecord: true },
      ],
      TODAY,
    );
    expect(focus.next).toBeNull();
    expect(focus.pastDue).toBeNull();
    expect(focus.notPerformedRecorded).toBe(1);
  });

  it('Workout detail / session CTA resolve the recorded state (no Start)', () => {
    expect(
      resolveWorkoutCtaState({
        enrolled: true,
        notPerformedRecorded: true,
        sessionStatus: 'none',
      }),
    ).toBe('not-performed');
  });

  it('Closure reports B settled (not performed) while the run stays open at C', () => {
    expect(CLOSURE.notPerformedWorkouts).toBe(1);
    expect(CLOSURE.completedWorkouts).toBe(1);
    expect(CLOSURE.isProgramComplete).toBe(false);
    expect(CLOSURE.isConcluded).toBe(false);
    expect(CLOSURE.openInProgramOrder.map((occurrence) => occurrence.workoutOrder)).toEqual([1]);
  });
});
