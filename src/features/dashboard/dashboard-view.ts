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
 */

import type { ProgramEnrollmentViewDto } from '@/application/dto/enrollment';
import type { ProgramDetailDto } from '@/application/dto/program';
import type { TrainingHistoryPageDto } from '@/application/dto/training-history';
import type { UserProfileDto } from '@/application/dto/user-profile';
import { getCurrentProgramDashboardUseCase } from '@/features/dashboard/services';
import { formatHistoryCount, formatHistoryDate } from '@/features/history/history-labels';
import { listTrainingHistoryUseCase } from '@/features/history/services';
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
}

/** One recent-completed-session row of the Recent Training card. */
export interface RecentTrainingSession {
  readonly sessionId: string;
  readonly workoutName: string;
  readonly programName: string;
  /** Concise UTC date label, e.g. "Feb 15, 2026". */
  readonly completedAtLabel: string;
  /** "12 sets" — the session's logged-set count. */
  readonly setsLabel: string;
}

/**
 * Recent Training card state, built from the user-global history read model
 * (bounded to RECENT_TRAINING_LIMIT sessions, newest first). A discriminated
 * union so a failed history read cannot be represented as — or conflated
 * with — the genuine empty history: `loaded` with an empty array is "no
 * completed training yet", `unavailable` is "the read failed" (rendered as
 * its own truthful card state, never as empty).
 */
export type RecentTrainingState =
  | { readonly status: 'loaded'; readonly sessions: ReadonlyArray<RecentTrainingSession> }
  | { readonly status: 'unavailable' };

export interface DashboardView {
  readonly profile: UserProfileDto;
  readonly currentProgram: DashboardProgramView | null;
  readonly recentTraining: RecentTrainingState;
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
 * Maps the history page DTO into the card's view rows. The repository's
 * order (the recency ladder, newest first) is preserved exactly — nothing
 * is re-sorted, trimmed, or fabricated.
 */
function toRecentTraining(page: TrainingHistoryPageDto | null): RecentTrainingState {
  if (page === null) {
    return { status: 'unavailable' };
  }

  return {
    status: 'loaded',
    sessions: page.sessions.map((session) => ({
      sessionId: session.sessionId,
      workoutName: session.workoutName,
      programName: session.programName,
      completedAtLabel: formatHistoryDate(session.completedAt),
      setsLabel: `${formatHistoryCount(session.metrics.totalSets)} ${
        session.metrics.totalSets === 1 ? 'set' : 'sets'
      }`,
    })),
  };
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
  const [result, recentTraining] = await Promise.all([
    getCurrentProgramDashboardUseCase.execute(userId),
    readRecentTrainingPage(userId).then(toRecentTraining),
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
          },
    recentTraining,
    weekSummaries,
  };
}
