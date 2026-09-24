/**
 * Training-week vocabulary and pure UTC week arithmetic (M13 Slice 1).
 *
 * A **training week** is a fixed UTC calendar week: Monday 00:00:00.000 UTC
 * (inclusive) to the next Monday 00:00:00.000 UTC (exclusive). Every window is
 * derived from a caller-supplied instant with plain epoch-millisecond
 * arithmetic, so a window is deterministic for a given instant regardless of
 * the server's, database's, or viewer's timezone.
 *
 * Deliberate boundaries of this module:
 * - **UTC only.** No local-time calendar, no `Intl` week-of-year (locale
 *   dependent), no `Date.now()`: the current instant is always a parameter.
 * - **No framework, ORM or date-library vocabulary.** The module imports
 *   nothing; it is pure TypeScript over `Date` instants and numbers.
 * - **No presentation.** Week labels, relative wording ("last week") and
 *   formatted dates belong to the presentation layer; only the numeric
 *   window/delta facts live here.
 * - **No "untracked" state.** A window with no completed sessions is an
 *   authoritative zero: the data model cannot distinguish "did not train" from
 *   "was not tracked", so this module never invents that distinction.
 *
 * `count` and activity values are trusted, normalized inputs (the repository
 * `limit` convention): callers pass a non-negative integer count, and log
 * counts that were already validated at their boundary.
 */

// ─── Constants ───────────────────────────────────────────────────────────────

/** Milliseconds in one day; epoch arithmetic is timezone-independent. */
const MS_PER_DAY = 86_400_000;

/** Milliseconds in one training week (seven UTC days). */
const MS_PER_WEEK = 7 * MS_PER_DAY;

// ─── Windows ─────────────────────────────────────────────────────────────────

/**
 * One contiguous UTC training week. `weekStart` is inclusive and `weekEnd` is
 * exclusive, so an instant belongs to exactly one window.
 *
 * `weekIndex` is the window's position relative to the instant the list was
 * resolved from: `0` is the week containing that instant, `-1` the week
 * before it, and so on. It is a position label, never a duration or an
 * identity: two separate resolutions of the same week both report `0` only if
 * both were resolved from an instant inside it.
 */
export interface TrainingWeekWindow {
  readonly weekStart: Date;
  readonly weekEnd: Date;
  readonly weekIndex: number;
}

/**
 * Returns the UTC week start (Monday 00:00:00.000) of the day containing
 * `instant`, as epoch milliseconds. Pure UTC arithmetic: the day boundary is
 * found by flooring epoch milliseconds, the weekday by reading the UTC
 * calendar, and the distance back to Monday is subtracted in whole days.
 */
function utcWeekStartMs(instant: Date): number {
  const time = instant.getTime();
  const dayStartMs = Math.floor(time / MS_PER_DAY) * MS_PER_DAY;
  const dayOfWeek = new Date(dayStartMs).getUTCDay(); // 0 = Sunday … 6 = Saturday
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return dayStartMs - daysSinceMonday * MS_PER_DAY;
}

/**
 * The current UTC training week containing `now` (`weekIndex` `0`).
 *
 * `now` must be a valid `Date`; it is trusted input from the application
 * layer, which captures the request clock once and passes it down.
 */
export function resolveTrainingWeekWindow(now: Date): TrainingWeekWindow {
  const weekStartMs = utcWeekStartMs(now);
  return {
    weekStart: new Date(weekStartMs),
    weekEnd: new Date(weekStartMs + MS_PER_WEEK),
    weekIndex: 0,
  };
}

/**
 * `count` consecutive UTC training weeks ending with the week containing
 * `now`, ordered oldest → newest (the final entry is the current week).
 *
 * Behavior:
 * - Exactly `count` windows are returned; consecutive windows are contiguous
 *   (`weekEnd` equals the next `weekStart`) and never overlap.
 * - `weekIndex` runs from `-(count - 1)` (oldest) to `0` (the current week).
 * - A non-positive `count` yields an empty list.
 * - `count` is trusted to be a non-negative integer.
 */
export function listRecentTrainingWeekWindows(
  now: Date,
  count: number,
): ReadonlyArray<TrainingWeekWindow> {
  const currentWeekStartMs = utcWeekStartMs(now);
  const windows: TrainingWeekWindow[] = [];

  for (let offset = count - 1; offset >= 0; offset -= 1) {
    const weekStartMs = currentWeekStartMs - offset * MS_PER_WEEK;
    windows.push({
      weekStart: new Date(weekStartMs),
      weekEnd: new Date(weekStartMs + MS_PER_WEEK),
      // The current week is plain `0`, never `-0`: negating the offset would
      // otherwise produce negative zero for it, which compares surprisingly
      // (`Object.is`, `1 / index`) and is not the honest "current" label.
      weekIndex: offset === 0 ? 0 : -offset,
    });
  }

  return windows;
}

// ─── Bucketing ───────────────────────────────────────────────────────────────

/**
 * One completed session as week bucketing consumes it: the completion instant
 * that places it in a week, and the session's already-counted logged sets.
 *
 * Its shape is structural on purpose, so a bounded repository read can hand
 * its rows over without this module knowing anything about persistence.
 * A zero-set completed session still counts as one completed workout: the
 * session is a real completed session, and its `loggedSets` is simply `0`
 * (skipped or set-less occurrences have no set rows to count).
 */
export interface CompletedSessionActivity {
  readonly completedAt: Date;
  readonly loggedSets: number;
}

/** One window's factual totals: completed workouts and their logged sets. */
export interface TrainingWeekSummary {
  readonly window: TrainingWeekWindow;
  readonly completedWorkouts: number;
  readonly loggedSets: number;
}

/**
 * Buckets completed sessions into the supplied windows and totals each one.
 *
 * Behavior:
 * - Placement is `[weekStart, weekEnd)` — `weekStart` is inclusive, `weekEnd`
 *   exclusive, so an instant on a boundary belongs to exactly one window.
 * - Every in-window activity counts as one completed workout; `loggedSets`
 *   are summed (a zero-set completed session therefore counts as a workout).
 * - Activities outside every supplied window are ignored (they are simply not
 *   part of the requested span; this is not an error).
 * - Windows are assumed contiguous and non-overlapping, as
 *   `listRecentTrainingWeekWindows` produces them. Should a caller supply
 *   overlapping windows, the earliest matching window owns the activity, so
 *   the result is still deterministic.
 * - The result mirrors the given window order and never depends on activity
 *   order; one summary is returned per supplied window, zeros included.
 * - Inputs are never mutated: the returned summaries are fresh objects.
 */
export function summarizeTrainingWeeks(
  activities: ReadonlyArray<CompletedSessionActivity>,
  windows: ReadonlyArray<TrainingWeekWindow>,
): ReadonlyArray<TrainingWeekSummary> {
  const summaries: TrainingWeekSummary[] = windows.map((window) => ({
    window,
    completedWorkouts: 0,
    loggedSets: 0,
  }));

  for (const activity of activities) {
    const completedAtMs = activity.completedAt.getTime();
    const index = windows.findIndex(
      (window) =>
        completedAtMs >= window.weekStart.getTime() &&
        completedAtMs < window.weekEnd.getTime(),
    );
    if (index === -1) continue;

    const summary = summaries[index];
    if (summary === undefined) continue; // Unreachable: index comes from windows.

    summaries[index] = {
      window: summary.window,
      completedWorkouts: summary.completedWorkouts + 1,
      loggedSets: summary.loggedSets + activity.loggedSets,
    };
  }

  return summaries;
}

// ─── Comparison ──────────────────────────────────────────────────────────────

/**
 * Plain week-over-week deltas (`current - previous`), in the metric's own
 * unit: workouts and logged sets.
 *
 * There is deliberately no nullable "untracked" variant. Both weeks are
 * concrete UTC windows and a week without completed sessions is an
 * authoritative zero, so every delta is an ordinary integer — negative when
 * current is below previous. Whether a delta is worded as a number, as "same
 * as last week", or as "no training last week" is presentation's decision.
 */
export interface TrainingWeekComparison {
  readonly workoutDelta: number;
  readonly setDelta: number;
}

/** Computes the factual deltas between two week summaries. Pure arithmetic. */
export function compareTrainingWeeks(
  current: TrainingWeekSummary,
  previous: TrainingWeekSummary,
): TrainingWeekComparison {
  return {
    workoutDelta: current.completedWorkouts - previous.completedWorkouts,
    setDelta: current.loggedSets - previous.loggedSets,
  };
}