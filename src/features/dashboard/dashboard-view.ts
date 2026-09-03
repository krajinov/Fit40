/**
 * Server-side view assembly for the dashboard screen.
 *
 * Current-program selection and hydration live in
 * GetCurrentProgramDashboardUseCase (application layer); this module maps
 * the use-case DTO into the serializable view passed to presentational
 * components. It derives nothing the application layer does not already
 * expose: Pencil fields with no source data (calendar day dots, session
 * history dates/volume, program cadence) are omitted rather than fabricated.
 */

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ProgramDetailDto } from '@/application/dto/program';
import type { UserProfileDto } from '@/application/dto/user-profile';
import { getCurrentProgramDashboardUseCase } from '@/features/dashboard/services';
import {
  nextWorkoutPreviewState,
  toNextWorkoutView,
  type NextWorkoutPreviewState,
} from '@/features/sessions/next-workout-view';

export type WeekStatus = 'completed' | 'in-progress' | 'upcoming';

export interface CompletedWorkoutEntry {
  readonly programSlug: string;
  readonly weekNumber: number;
  readonly workoutOrder: number;
  readonly workoutName: string;
}

export interface WeekSummary {
  readonly weekNumber: number;
  readonly totalWorkouts: number;
  readonly completedCount: number;
  readonly status: WeekStatus;
}

export interface DashboardProgramView {
  readonly program: ProgramDetailDto;
  readonly enrollment: Extract<ProgramEnrollmentViewDto, { status: 'enrolled' }>;
  /**
   * Three-valued next-workout state (see NextWorkoutPreviewState): a
   * preview that fails to resolve (e.g. catalog drift) renders as
   * "unavailable" — the program is complete only when the enrollment
   * reports no next workout at all.
   */
  readonly nextWorkoutPreview: NextWorkoutPreviewState;
}

export interface DashboardView {
  readonly profile: UserProfileDto;
  readonly currentProgram: DashboardProgramView | null;
  /**
   * Completed workouts of the current enrollment in completion order (the
   * repository orders them by session start time ascending). No dates or
   * volume are included — none are exposed by the application layer.
   */
  readonly completedWorkouts: ReadonlyArray<CompletedWorkoutEntry>;
  /**
   * Per-week completion of the current program, aligned with
   * `currentProgram.program.weeks` order.
   */
  readonly weekSummaries: ReadonlyArray<WeekSummary>;
}


/**
 * Derives per-week summaries for the enrolled program view.
 */
function buildWeekSummaries(
  program: ProgramDetailDto,
  completedIds: ReadonlySet<string>,
  nextWeekNumber: number | null,
): WeekSummary[] {
  return program.weeks.map((week) => {
    const completedCount = week.scheduledWorkouts.filter((scheduled) =>
      completedIds.has(scheduled.scheduledWorkoutId),
    ).length;

    let status: WeekStatus;
    if (nextWeekNumber === null) {
      status = 'completed';
    } else if (week.weekNumber < nextWeekNumber) {
      status = 'completed';
    } else if (week.weekNumber === nextWeekNumber) {
      status = 'in-progress';
    } else {
      status = 'upcoming';
    }

    return {
      weekNumber: week.weekNumber,
      totalWorkouts: week.scheduledWorkouts.length,
      completedCount,
      status,
    };
  });
}

/**
 * Lists the enrollment's completed workouts in completion order. The
 * enrollment DTO's completed ids are ordered by session start time
 * ascending (repository contract), so no extra history query is needed —
 * and no dates or volume are fabricated.
 */
function buildCompletedWorkouts(
  program: ProgramDetailDto,
  completedIds: ReadonlyArray<string>,
): CompletedWorkoutEntry[] {
  const byId = new Map<string, CompletedWorkoutEntry>();
  for (const week of program.weeks) {
    for (const scheduled of week.scheduledWorkouts) {
      byId.set(scheduled.scheduledWorkoutId, {
        programSlug: program.slug,
        weekNumber: week.weekNumber,
        workoutOrder: scheduled.order,
        workoutName: scheduled.workoutName,
      });
    }
  }

  const entries: CompletedWorkoutEntry[] = [];
  for (const id of completedIds) {
    const entry = byId.get(id);
    if (entry !== undefined) {
      entries.push(entry);
    }
  }
  return entries;
}

/**
 * Builds the complete dashboard view for a user with a verified profile.
 *
 * The profile is passed in (the page loads it first to decide the
 * onboarding redirect) so it is fetched exactly once per request. An
 * unresolvable current program (e.g. catalog drift) degrades to the
 * dashboard's empty states: the use case reports the typed failure and this
 * deliberate presentation choice preserves the pre-refactor behavior
 * instead of rendering partial data.
 */
export async function buildDashboardView(
  userId: string,
  profile: UserProfileDto,
): Promise<DashboardView> {
  const result = await getCurrentProgramDashboardUseCase.execute(userId);
  const current = result.ok && result.data !== null ? result.data : null;

  let completedWorkouts: ReadonlyArray<CompletedWorkoutEntry> = [];
  let weekSummaries: ReadonlyArray<WeekSummary> = [];
  let nextWorkoutPreview: NextWorkoutPreviewState = { status: 'complete' };
  if (current !== null) {
    const enrollment = current.enrollment;
    const completedIds = enrollment.completedScheduledWorkoutIds;
    const nextWeekNumber =
      enrollment.nextWorkout === null ? null : enrollment.nextWorkout.weekNumber;

    completedWorkouts = buildCompletedWorkouts(current.program, completedIds);
    weekSummaries = buildWeekSummaries(
      current.program,
      new Set(completedIds),
      nextWeekNumber,
    );
    nextWorkoutPreview = nextWorkoutPreviewState(
      enrollment.nextWorkout,
      current.nextWorkout === null ? null : toNextWorkoutView(current.nextWorkout),
    );
  }

  return {
    profile,
    currentProgram:
      current === null
        ? null
        : {
            program: current.program,
            enrollment: current.enrollment,
            nextWorkoutPreview,
          },
    completedWorkouts,
    weekSummaries,
  };
}
