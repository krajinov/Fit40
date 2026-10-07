/**
 * Server-side view assembly for the dashboard screen.
 *
 * Current-program selection and hydration live in
 * GetCurrentProgramDashboardUseCase (application layer); this module maps
 * the use-case DTO into the serializable view passed to presentational
 * components. It derives nothing the application layer does not already
 * expose: Pencil fields with no source data (calendar day dots, program
 * cadence) are omitted rather than fabricated.
 *
 * Recent Training is read from the user-global Training History read model
 * (ListTrainingHistoryUseCase) — the same source of truth as /history — so
 * the card reflects completed sessions from every enrollment, including
 * detached ones, instead of the current enrollment's progress ids.
 *
 * Weekly insights (M13) follow the same pattern: one read through the
 * composed application use case, mapped to presentation labels here, and
 * degrading to `unavailable` — never to zeros — when the read fails.
 */

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { DashboardScheduleState } from '@/application/dto/dashboard';
import type { ProgramDetailDto } from '@/application/dto/program';
import type { TrainingHistoryPageDto } from '@/application/dto/training-history';
import type { TrainingWeeklyInsightsDto } from '@/application/dto/training-insights';
import type { UserProfileDto } from '@/application/dto/user-profile';
import {
  getCurrentProgramDashboardUseCase,
  getTrainingWeeklyInsightsUseCase,
} from '@/features/dashboard/services';
import {
  toRecentTraining,
  type RecentTrainingState,
} from '@/features/dashboard/recent-training-view';
import {
  toWeeklyInsightsView,
  type WeeklyInsightsView,
} from '@/features/dashboard/weekly-insights-view';
import { listTrainingHistoryUseCase } from '@/features/history/services';

export type {
  RecentTrainingSession,
  RecentTrainingState,
} from '@/features/dashboard/recent-training-view';
import {
  nextWorkoutPreviewState,
  toNextWorkoutView,
  type NextWorkoutPreviewState,
} from '@/features/sessions/next-workout-view';

export type WeekStatus = 'completed' | 'in-progress' | 'upcoming';

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
  /**
   * The run's M15 training calendar (M15 Slice 5): pass-through of the
   * application's schedule state — this module derives nothing from it.
   * `unavailable` (failed read) and `configured: false` (never set up) stay
   * distinct, and the completed-program state is keyed exclusively off
   * `nextWorkoutPreview` as before.
   */
  readonly schedule: DashboardScheduleState;
}

/**
 * Weekly insights card state (M13): `loaded` carries the mapped view of a
 * successful read — genuine zero-training weeks included — and
 * `unavailable` is the logged read failure, which must never be rendered
 * as zeros, an empty week, or an authoritative "no training".
 */
export type WeeklyInsightsState =
  | { readonly status: 'loaded'; readonly data: WeeklyInsightsView }
  | { readonly status: 'unavailable' };

export interface DashboardView {
  readonly profile: UserProfileDto;
  readonly currentProgram: DashboardProgramView | null;
  readonly recentTraining: RecentTrainingState;
  /**
   * Calendar-week insights (user-global): see WeeklyInsightsState —
   * empty-but-successful is data, a failed read is `unavailable`.
   */
  readonly weeklyInsights: WeeklyInsightsState;
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

/** Bounded recency window of the Recent Training card (rows shown). */
const RECENT_TRAINING_LIMIT = 3;

/**
 * Reads one bounded page of the user's completed sessions through the
 * existing History use case — no dashboard-specific query, no second
 * recent-training use case. Returns null both for a typed rejection and for
 * an unexpected infrastructure failure so the caller can render the
 * truthful `unavailable` state instead of an empty one.
 */
async function readRecentTrainingPage(userId: string): Promise<TrainingHistoryPageDto | null> {
  try {
    const result = await listTrainingHistoryUseCase.execute({
      userId,
      limit: RECENT_TRAINING_LIMIT,
    });
    return result.ok ? result.data : null;
  } catch (error: unknown) {
    // Unexpected infrastructure failure (e.g. the history read cannot reach
    // the database). Recorded per docs/error-handling.md §Logging — the
    // dashboard degrades gracefully, so without this the failure would be
    // swallowed entirely. The rest of the dashboard stays usable; the card
    // degrades to `unavailable` — never to "empty", which would claim the
    // user has no training.
    console.error(
      `Unexpected failure reading recent training for user ${userId}`,
      error,
    );
    return null;
  }
}

/**
 * Reads the user-global weekly insights through the composed use case.
 * Returns null for a typed rejection and for an unexpected infrastructure
 * failure — logged per docs/error-handling.md §Logging, because the
 * dashboard degrades gracefully and would otherwise swallow it — so the
 * caller renders `unavailable`, never an authoritative zero week.
 */
async function readWeeklyInsights(
  userId: string,
  now: Date,
): Promise<TrainingWeeklyInsightsDto | null> {
  try {
    const result = await getTrainingWeeklyInsightsUseCase.execute({ userId, now });
    return result.ok ? result.data : null;
  } catch (error: unknown) {
    console.error(`Unexpected failure reading weekly insights for user ${userId}`, error);
    return null;
  }
}

/** null → `unavailable`; a successful read maps to its presentation view. */
function toWeeklyInsightsState(dto: TrainingWeeklyInsightsDto | null): WeeklyInsightsState {
  return dto === null
    ? { status: 'unavailable' }
    : { status: 'loaded', data: toWeeklyInsightsView(dto) };
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
  /** The request clock: the insights' current UTC week contains this instant. */
  now: Date,
): Promise<DashboardView> {
  const [result, recentTraining, weeklyInsights] = await Promise.all([
    getCurrentProgramDashboardUseCase.execute(userId, now),
    readRecentTrainingPage(userId).then(toRecentTraining),
    readWeeklyInsights(userId, now).then(toWeeklyInsightsState),
  ]);
  const current = result.ok && result.data !== null ? result.data : null;

  let weekSummaries: ReadonlyArray<WeekSummary> = [];
  let nextWorkoutPreview: NextWorkoutPreviewState = { status: 'complete' };
  if (current !== null) {
    const enrollment = current.enrollment;
    const completedIds = enrollment.completedScheduledWorkoutIds;
    const nextWeekNumber =
      enrollment.nextWorkout === null ? null : enrollment.nextWorkout.weekNumber;

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
            schedule: current.schedule,
          },
    recentTraining,
    weeklyInsights,
    weekSummaries,
  };
}
