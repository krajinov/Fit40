/**
 * Server-side view assembly for the dashboard screen.
 *
 * Orchestrates existing read-only use cases (profile, enrollments, program
 * details, enrollment progress, next-workout state) into a serializable
 * view passed to presentational components. It derives nothing the
 * application layer does not already expose: Pencil fields with no source
 * data (calendar day dots, session history dates/volume, program cadence)
 * are omitted rather than fabricated.
 */

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ProgramDetailDto } from '@/application/dto/program';
import type { UserProfileDto } from '@/application/dto/user-profile';
import { getProgramEnrollmentUseCase, listUserEnrollmentsUseCase } from '@/features/enrollment/services';
import { getProgramBySlugUseCase } from '@/features/programs/services';
import {
  buildNextWorkoutView,
  type NextWorkoutView,
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
  readonly nextWorkout: NextWorkoutView | null;
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
 * Derives the "current" program view: the user's most recently joined
 * enrollment (the repository lists enrollments by joined time ascending),
 * hydrated with program detail, per-enrollment progress and next-workout
 * state.
 *
 * Returns null when the user is enrolled in nothing (the dashboard renders
 * its empty states) or when the enrolled catalog entry cannot be resolved.
 */
async function buildCurrentProgramView(
  userId: string,
): Promise<DashboardProgramView | null> {
  const enrollments = await listUserEnrollmentsUseCase.execute(userId);
  if (enrollments.length === 0) {
    return null;
  }

  const latest = enrollments.at(-1);
  if (latest === undefined) {
    return null;
  }

  const programResult = await getProgramBySlugUseCase.execute(latest.programSlug);
  if (!programResult.ok) {
    return null;
  }

  const enrollmentResult = await getProgramEnrollmentUseCase.execute({
    userId,
    program: programResult.data.program,
  });
  if (!enrollmentResult.ok) {
    return null;
  }
  const enrollment = enrollmentResult.data;
  if (enrollment.status !== 'enrolled') {
    return null;
  }

  let nextWorkout: NextWorkoutView | null = null;
  if (enrollment.nextWorkout !== null) {
    nextWorkout = await buildNextWorkoutView({
      userId,
      programSlug: programResult.data.program.slug,
      weekNumber: enrollment.nextWorkout.weekNumber,
      workoutOrder: enrollment.nextWorkout.workoutOrder,
    });
  }

  return {
    program: programResult.data.detail,
    enrollment,
    nextWorkout,
  };
}

/**
 * Builds the complete dashboard view for a user with a verified profile.
 *
 * The profile is passed in (the page loads it first to decide the
 * onboarding redirect) so it is fetched exactly once per request.
 */
export async function buildDashboardView(
  userId: string,
  profile: UserProfileDto,
): Promise<DashboardView> {
  const currentProgram = await buildCurrentProgramView(userId);

  let completedWorkouts: ReadonlyArray<CompletedWorkoutEntry> = [];
  let weekSummaries: ReadonlyArray<WeekSummary> = [];
  if (currentProgram !== null) {
    const completedIds = currentProgram.enrollment.completedScheduledWorkoutIds;
    const nextWeekNumber =
      currentProgram.enrollment.nextWorkout === null
        ? null
        : currentProgram.enrollment.nextWorkout.weekNumber;

    completedWorkouts = buildCompletedWorkouts(currentProgram.program, completedIds);
    weekSummaries = buildWeekSummaries(
      currentProgram.program,
      new Set(completedIds),
      nextWeekNumber,
    );
  }

  return {
    profile,
    currentProgram,
    completedWorkouts,
    weekSummaries,
  };
}
