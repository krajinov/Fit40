/**
 * Program Detail — settlement truthfulness when the M15 calendar degrades.
 *
 * The confirmed P2 finding: `recordedKeys` was built ONLY from the schedule
 * read, so an `unavailable` calendar emptied it and recorded occurrences
 * rendered as "Scheduled" / weeks as "Upcoming" even though the closure read
 * had already established the run was closed. These tests pin the fix: the
 * closure DTO's AUTHORED identity sets are the authoritative fallback, so the
 * cards and week badges stay truthful without the calendar.
 *
 * Composition only: every identity asserted here arrives as a prop from the
 * application layer — the component never infers settlement from counts.
 */

import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

// The panel's Server Actions and composed reads reach the database only through
// the feature service modules, stubbed at the module boundary (the program
// detail page test's convention) so this component test never loads a database
// client. The repository barrel fails loudly if presentation imports it.
vi.mock('@/infrastructure/database/repositories', () => {
  throw new Error('presentation must not import database repositories directly');
});
vi.mock('@/features/auth/current-user', () => ({
  getCurrentUser: vi.fn(),
  requireUser: vi.fn(),
}));
vi.mock('@/features/enrollment/services', () => ({
  getProgramEnrollmentUseCase: { execute: vi.fn() },
  getRunClosureSummaryUseCase: { execute: vi.fn() },
}));
vi.mock('@/features/programs/services', () => ({
  getProgramBySlugUseCase: { execute: vi.fn() },
}));
vi.mock('@/features/sessions/services', () => ({
  resolveNextWorkoutUseCase: { execute: vi.fn() },
}));
vi.mock('@/features/schedule/services', () => ({
  getEnrollmentScheduleUseCase: { execute: vi.fn() },
  getEnrollmentFollowThroughUseCase: { execute: vi.fn() },
}));
vi.mock('@/features/enrollment/actions/join-program', () => ({ joinProgramAction: vi.fn() }));
vi.mock('@/features/enrollment/actions/leave-program', () => ({ leaveProgramAction: vi.fn() }));
vi.mock('@/features/enrollment/actions/restart-program', () => ({
  restartProgramAction: vi.fn(),
}));
vi.mock('@/features/schedule/actions/configure-training-days', () => ({
  configureTrainingDaysAction: vi.fn(),
}));
vi.mock('@/features/schedule/actions/reschedule-planned-workout', () => ({
  reschedulePlannedWorkoutAction: vi.fn(),
}));

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ProgramDetailDto } from '@/application/dto/program';
import type { RunClosureSummaryDto } from '@/application/dto/run-closure';
import type { ScheduleReadState } from '@/application/dto/schedule';
import { ProgramDetail } from '@/features/programs/components/ProgramDetail';

const PROGRAM: ProgramDetailDto = {
  id: 'p1',
  name: 'Fit40 Beginner Strength',
  slug: 'fit40-beginner-strength',
  description: 'A program.',
  difficulty: 'beginner',
  goal: 'strength',
  durationWeeks: 2,
  workoutsPerWeek: 2,
  weeks: [
    {
      weekNumber: 1,
      scheduledWorkouts: [
        {
          scheduledWorkoutId: 'sw-1-1',
          workoutId: 'wo-a',
          workoutName: 'Upper Body A',
          workoutSlug: 'upper-body-a',
          order: 1,
          estimatedDurationMinutes: 30,
        },
        {
          scheduledWorkoutId: 'sw-1-2',
          workoutId: 'wo-b',
          workoutName: 'Lower Body B',
          workoutSlug: 'lower-body-b',
          order: 2,
          estimatedDurationMinutes: 45,
        },
      ],
    },
    {
      weekNumber: 2,
      scheduledWorkouts: [
        {
          scheduledWorkoutId: 'sw-2-1',
          workoutId: 'wo-a',
          workoutName: 'Upper Body A',
          workoutSlug: 'upper-body-a',
          order: 1,
          estimatedDurationMinutes: 30,
        },
      ],
    },
  ],
};

function enrollment(completedIds: ReadonlyArray<string>): ProgramEnrollmentViewDto {
  return {
    status: 'enrolled',
    enrollmentId: 'enr-a',
    enrolledAt: '2026-01-01T00:00:00.000Z',
    progress: { totalWorkouts: 3, completedWorkouts: completedIds.length, percentage: 0 },
    nextWorkout: null,
    completedScheduledWorkoutIds: completedIds,
  };
}

function closure(overrides: Partial<RunClosureSummaryDto> = {}): RunClosureSummaryDto {
  return {
    programSlug: PROGRAM.slug,
    totalWorkouts: 3,
    completedWorkouts: 0,
    notPerformedWorkouts: 0,
    openWorkouts: 3,
    hasOpenWorkout: true,
    openInProgramOrder: [],
    completedInProgramOrder: [],
    notPerformedInProgramOrder: [],
    isConcluded: false,
    isProgramComplete: false,
    restartAvailable: false,
    ...overrides,
  };
}

const UNAVAILABLE: ScheduleReadState = { status: 'unavailable' };

function occurrence(id: string, weekNumber: number, workoutOrder: number, workoutName: string) {
  return { scheduledWorkoutId: id, weekNumber, workoutOrder, workoutName };
}

function render(props: {
  readonly enrollment: ProgramEnrollmentViewDto;
  readonly schedule: ScheduleReadState | null;
  readonly runClosure: RunClosureSummaryDto | null;
  readonly nextWorkoutPreview?: null;
}): string {
  return renderToStaticMarkup(
    createElement(ProgramDetail, {
      program: PROGRAM,
      enrollment: props.enrollment,
      nextWorkoutPreview: props.nextWorkoutPreview ?? null,
      schedule: props.schedule,
      followThrough: null,
      runClosure: props.runClosure,
    }),
  );
}

describe('ProgramDetail — settlement truth survives an unavailable schedule', () => {
  it('A. concluded-but-incomplete run: recorded and completed cards stay truthful and no settled week reads as Upcoming', () => {
    const markup = render({
      // Week 1 fully settled: 1-1 completed, 1-2 recorded. Week 2 open.
      enrollment: enrollment(['sw-1-1']),
      schedule: UNAVAILABLE,
      runClosure: closure({
        completedWorkouts: 1,
        notPerformedWorkouts: 1,
        openWorkouts: 1,
        hasOpenWorkout: true,
        completedInProgramOrder: [occurrence('sw-1-1', 1, 1, 'Upper Body A')],
        notPerformedInProgramOrder: [occurrence('sw-1-2', 1, 2, 'Lower Body B')],
        openInProgramOrder: [occurrence('sw-2-1', 2, 1, 'Upper Body A')],
      }),
    });

    // The recorded card keeps its settlement caption; the completed card its own.
    expect(markup).toContain('Recorded as not performed');
    expect(markup).toContain('Completed');
    // The fully settled week is NOT "Upcoming" — it is Settled (recorded truth).
    expect(markup).toContain('Settled');
    expect(markup).not.toContain('Upcoming');
  });

  it('B. open run: a recorded occurrence before the first open one stays recorded, never Scheduled/Upcoming', () => {
    const markup = render({
      enrollment: enrollment([]),
      schedule: UNAVAILABLE,
      runClosure: closure({
        notPerformedWorkouts: 1,
        openWorkouts: 2,
        notPerformedInProgramOrder: [occurrence('sw-1-1', 1, 1, 'Upper Body A')],
        openInProgramOrder: [occurrence('sw-1-2', 1, 2, 'Lower Body B')],
      }),
    });

    // The recorded occurrence is settled truth, not a scheduled card…
    expect(markup).toContain('Recorded as not performed');
    // …and the run's first OPEN occurrence is still the up-next one.
    expect(markup).toContain('Up next');
    // Week 1 is current (it holds the first open occurrence), never Upcoming.
    expect(markup).toContain('In progress');
  });

  it('C. available schedule: existing calendar-derived rendering is unchanged', () => {
    const markup = render({
      enrollment: enrollment(['sw-1-1']),
      schedule: {
        status: 'loaded',
        schedule: {
          programSlug: PROGRAM.slug,
          configured: true,
          today: '2026-02-18',
          items: [
            {
              scheduledWorkoutId: 'sw-1-1',
              weekNumber: 1,
              workoutOrder: 1,
              workoutName: 'Upper Body A',
              plannedDate: '2026-02-16',
              status: 'completed',
            },
            {
              scheduledWorkoutId: 'sw-1-2',
              weekNumber: 1,
              workoutOrder: 2,
              workoutName: 'Lower Body B',
              plannedDate: '2026-02-18',
              status: 'not-performed',
            },
          ],
          unplacedNotPerformedWorkouts: [],
          focus: { today: null, next: null, pastDue: null, notPerformedRecorded: 1 },
        },
      },
      runClosure: closure({
        completedWorkouts: 1,
        notPerformedWorkouts: 1,
        openWorkouts: 1,
        completedInProgramOrder: [occurrence('sw-1-1', 1, 1, 'Upper Body A')],
        notPerformedInProgramOrder: [occurrence('sw-1-2', 1, 2, 'Lower Body B')],
        openInProgramOrder: [occurrence('sw-2-1', 2, 1, 'Upper Body A')],
      }),
    });

    expect(markup).toContain('Recorded as not performed');
    expect(markup).toContain('Settled');
  });

  it('D. closure unavailable: no settlement identity is invented', () => {
    const markup = render({
      enrollment: enrollment([]),
      schedule: UNAVAILABLE,
      // The closure read failed: nothing claims a recorded occurrence.
      runClosure: null,
    });

    // The degraded behavior is preserved: no fabricated settlement caption.
    expect(markup).not.toContain('Recorded as not performed');
    expect(markup).toContain('Scheduled');
  });
});
