/**
 * Server-side view assembly for the training-history screen.
 *
 * `toHistoryView` is the pure DTO → view-model mapping — labels are
 * formatted here so the components stay presentational. `buildHistoryView`
 * orchestrates the two read use cases through the feature composition root.
 *
 * Everything rendered is data the application layer already exposes. The
 * aggregate's `totalDurationSeconds` is deliberately omitted from the view:
 * it is the sum of logged timed work, not the workout's duration, and
 * labeling it "duration" would misrepresent the metric. Zero-value reps and
 * volume are suppressed (e.g. bodyweight-only sessions) instead of showing
 * misleading "0" badges.
 *
 * The "recently trained exercises" shortcuts are the one derived-presentation
 * addition: distinct performed exercises are selected from the page already
 * loaded for this screen (newest occurrence first; occurrences the user
 * skipped or that logged no sets are excluded) and resolved through ONE
 * batched catalog lookup. No extra session read happens, and an exercise the
 * catalog no longer resolves is omitted rather than fabricated.
 */

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import type {
  TrainingHistoryPageDto,
  TrainingHistorySessionDto,
  TrainingTotalsDto,
} from '@/application/dto/training-history';
import { err, ok, type Result } from '@/domain/types/result';
import {
  formatHistoryCount,
  formatHistoryDate,
  formatHistoryVolume,
} from '@/features/history/history-labels';
import {
  getExercisesByIdsUseCase,
  getTrainingTotalsUseCase,
  listTrainingHistoryUseCase,
} from '@/features/history/services';

/** How many "recently trained exercises" shortcuts the screen shows at most. */
export const MAX_HISTORY_EXERCISE_SHORTCUTS = 10;

export interface HistoryTotalsView {
  readonly completedWorkouts: string;
  readonly loggedSets: string;
}

export interface HistorySessionView {
  readonly sessionId: string;
  readonly workoutName: string;
  readonly programName: string;
  readonly completedAtLabel: string;
  readonly setsLabel: string;
  /** Null when the session logged no reps (e.g. duration-only training). */
  readonly repsLabel: string | null;
  /** Null when the session produced no external-load volume. */
  readonly volumeLabel: string | null;
}

/**
 * One "recently trained exercise" shortcut: a link into that exercise's
 * performance history. Only exercises the catalog still resolves appear.
 */
export interface HistoryExerciseShortcutView {
  readonly exerciseId: string;
  readonly name: string;
  /** `/history/exercises/<slug>`. */
  readonly href: string;
}

export interface HistoryView {
  readonly totals: HistoryTotalsView;
  readonly sessions: ReadonlyArray<HistorySessionView>;
  /**
   * Distinct exercises performed within the loaded page, most recently
   * trained first and capped. Empty means "render no shortcut section" — the
   * screen never shows an empty shelf.
   */
  readonly exerciseShortcuts: ReadonlyArray<HistoryExerciseShortcutView>;
  /** `/history?cursor=…` when an older page exists, else null. */
  readonly olderPageHref: string | null;
}

export interface HistoryViewError {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
}

/**
 * Distinct PERFORMED exercise ids of the page, most recently trained first.
 *
 * An occurrence counts as performed only when BOTH hold: the user did not
 * skip it (M10: the persisted flag is authoritative — zero logged sets never
 * means skipped) AND it carries at least one logged set. Completion only
 * requires one logged set somewhere in the session, so a non-skipped
 * occurrence may legitimately have `sets: []`; that is not training, so it
 * must neither create a shortcut of its own nor rank the exercise by the
 * occurrence's position. The zero-set filter runs BEFORE the id is marked as
 * seen, so such a newer occurrence never suppresses (nor relocates) an older
 * occurrence that really logged sets.
 *
 * The cap applies BEFORE the catalog lookup, so a page of many sessions never
 * widens the query beyond the shortcuts actually rendered.
 */
export function selectRecentlyTrainedExerciseIds(
  sessions: ReadonlyArray<TrainingHistorySessionDto>,
): ReadonlyArray<string> {
  const selected: string[] = [];
  const seen = new Set<string>();

  for (const session of sessions) {
    for (const log of session.exerciseLogs) {
      if (log.isSkipped || log.sets.length === 0 || seen.has(log.performedExerciseId)) {
        continue;
      }
      seen.add(log.performedExerciseId);
      selected.push(log.performedExerciseId);
      if (selected.length === MAX_HISTORY_EXERCISE_SHORTCUTS) {
        return selected;
      }
    }
  }

  return selected;
}

/**
 * Resolves the selected ids against the catalog summaries fetched for them,
 * keeping the newest-trained-first order and omitting ids the catalog no
 * longer resolves — absence is never replaced by a fabricated entry.
 */
function toExerciseShortcuts(
  sessions: ReadonlyArray<TrainingHistorySessionDto>,
  exercises: ReadonlyArray<ExerciseSummaryDto>,
): ReadonlyArray<HistoryExerciseShortcutView> {
  const byId = new Map(exercises.map((exercise) => [exercise.id, exercise]));
  const shortcuts: HistoryExerciseShortcutView[] = [];

  for (const exerciseId of selectRecentlyTrainedExerciseIds(sessions)) {
    const exercise = byId.get(exerciseId);
    if (exercise === undefined) {
      continue;
    }
    shortcuts.push({
      exerciseId: exercise.id,
      name: exercise.name,
      href: `/history/exercises/${exercise.slug}`,
    });
  }

  return shortcuts;
}

/**
 * Pure DTO → view-model mapping. Session order is preserved exactly as the
 * application layer delivered it (newest first); nothing is sorted, trimmed,
 * or fabricated here.
 *
 * `trainedExercises` are the catalog summaries of the ids selected from this
 * page (one batched lookup) — they only ever supply names and slugs.
 */
export function toHistoryView(
  page: TrainingHistoryPageDto,
  totals: TrainingTotalsDto,
  trainedExercises: ReadonlyArray<ExerciseSummaryDto>,
): HistoryView {
  const sessions = page.sessions.map((session) => ({
    sessionId: session.sessionId,
    workoutName: session.workoutName,
    programName: session.programName,
    completedAtLabel: formatHistoryDate(session.completedAt),
    setsLabel: `${formatHistoryCount(session.metrics.totalSets)} ${
      session.metrics.totalSets === 1 ? 'set' : 'sets'
    }`,
    repsLabel:
      session.metrics.totalReps > 0
        ? `${formatHistoryCount(session.metrics.totalReps)} reps`
        : null,
    volumeLabel:
      session.metrics.volume > 0 ? formatHistoryVolume(session.metrics.volume) : null,
  }));

  return {
    totals: {
      completedWorkouts: formatHistoryCount(totals.completedSessions),
      loggedSets: formatHistoryCount(totals.loggedSets),
    },
    sessions,
    exerciseShortcuts: toExerciseShortcuts(page.sessions, trainedExercises),
    olderPageHref:
      page.nextCursor === null
        ? null
        : `/history?cursor=${encodeURIComponent(page.nextCursor)}`,
  };
}

/**
 * Builds the history view for one authenticated user and page position.
 *
 * The cursor is an opaque token from a previous page of this screen; a token
 * that fails validation is reported as INVALID_INPUT so the route can handle
 * it like any other unresolvable URL input.
 *
 * The shortcut catalog lookup runs last and is scoped to at most
 * MAX_HISTORY_EXERCISE_SHORTCUTS ids derived from the page already in hand
 * (an empty selection resolves without querying). Those ids come from
 * persisted sessions, so a rejection is an invariant break: it is surfaced
 * like the other read failures rather than silently hidden behind an empty
 * shortcut row.
 */
export async function buildHistoryView(
  userId: string,
  cursor: string | null,
): Promise<Result<HistoryView, HistoryViewError>> {
  const pageResult = await listTrainingHistoryUseCase.execute({ userId, cursor });
  if (!pageResult.ok) {
    return err({ code: pageResult.error.code, message: pageResult.error.message });
  }

  const totalsResult = await getTrainingTotalsUseCase.execute(userId);
  if (!totalsResult.ok) {
    return err({ code: totalsResult.error.code, message: totalsResult.error.message });
  }

  const exercisesResult = await getExercisesByIdsUseCase.execute({
    exerciseIds: selectRecentlyTrainedExerciseIds(pageResult.data.sessions),
  });
  if (!exercisesResult.ok) {
    return err({ code: exercisesResult.error.code, message: exercisesResult.error.message });
  }

  return ok(toHistoryView(pageResult.data, totalsResult.data, exercisesResult.data));
}
