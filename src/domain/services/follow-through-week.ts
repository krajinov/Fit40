/**
 * Weekly aggregation for plan follow-through (M16).
 *
 * The second half of M16's domain model: `plan-follow-through.ts` decides how
 * ONE planned occurrence stands (completed early / on plan / late, started,
 * past-due, today, upcoming); this module buckets those occurrences into the
 * supplied UTC training weeks and totals them.
 *
 * Deliberate boundaries:
 * - **Pure and clock-free.** Windows, occurrences and `now` are all parameters.
 * - **Counts, never judgements.** No percentage, ratio, score, streak or goal,
 *   and no success/failure vocabulary: a week that is not over yet is simply
 *   not over yet (`closed: false`).
 * - **Weeks are M13's weeks.** `[weekStart, weekEnd)` Monday–Sunday UTC, as
 *   `listRecentTrainingWeekWindows` produces them; this module invents no
 *   second calendar.
 */

import {
  FollowThroughOutcome,
  resolveFollowThroughOutcome,
  type PlannedOccurrenceFacts,
} from '@/domain/services/plan-follow-through';
import type { TrainingWeekWindow } from '@/domain/services/training-week';
import {
  isPlannedDateBefore,
  plannedDateFromInstant,
  type PlannedDate,
} from '@/domain/value-objects/planned-date';

/**
 * The counts one week can report. Plain integers: they restate rows, and no
 * derived judgement is added. `completedOnPlan` is deliberately absent — it is
 * `completed - early - late`, and no M16 consumer needs it as a stored number.
 */
export interface FollowThroughWeekCounts {
  /** Planned occurrences dated inside the week. */
  readonly planned: number;
  /** Occurrences completed, whichever side of their planned date. */
  readonly completed: number;
  /** Completions whose UTC day precedes the planned date. */
  readonly completedEarly: number;
  /** Completions whose UTC day follows the planned date. */
  readonly completedLate: number;
  /** Occurrences with a live session and no completion. */
  readonly started: number;
  /** Occurrences with no session whose planned date has passed. */
  readonly pastDue: number;
}

/** One week's counts, its window and whether the week is over. */
export interface FollowThroughWeek extends FollowThroughWeekCounts {
  readonly window: TrainingWeekWindow;
  /** `now >= weekEnd`: the whole week lies in the past, so it is settled. */
  readonly closed: boolean;
}

/** The same six numbers summed over the returned weeks. */
export type FollowThroughTotals = FollowThroughWeekCounts;

/** The report: the planned weeks of the requested span, plus their totals. */
export interface FollowThroughSummary {
  readonly weeks: ReadonlyArray<FollowThroughWeek>;
  readonly totals: FollowThroughTotals;
}

interface MutableCounts {
  planned: number;
  completed: number;
  completedEarly: number;
  completedLate: number;
  started: number;
  pastDue: number;
}

function emptyCounts(): MutableCounts {
  return { planned: 0, completed: 0, completedEarly: 0, completedLate: 0, started: 0, pastDue: 0 };
}

/**
 * Buckets the supplied occurrences into the supplied UTC training weeks and
 * totals each one.
 *
 * Behavior:
 * - Placement is by the occurrence's `plannedDate` against the window's
 *   `[weekStart, weekEnd)` **dates** (the `summarizeTrainingWeeks` boundary in
 *   planned-date terms): a date on a window's `weekEnd` belongs to the next
 *   window, or to none. That is the week `startOfPlannedWeek` resolves to,
 *   obtained without re-deriving the calendar.
 * - Only weeks holding at least one planned occurrence are returned; a supplied
 *   window with nothing planned is omitted rather than rendered as a fake
 *   zero-planned week. The result mirrors the given window order.
 * - One occurrence contributes to exactly one week and exactly one counter, so
 *   no outcome can be counted twice. The input must therefore hold one fact per
 *   occurrence — which the schema guarantees (the `planned_workouts` primary key
 *   and `workout_sessions_enrollment_occurrence_unique`) — and a repeated
 *   `scheduledWorkoutId` is a contract violation that THROWS rather than being
 *   merged: merging two contradictory facts would report a number matching
 *   neither source, which is precisely what this module must never do.
 * - Occurrences dated outside every supplied window are ignored: they are
 *   simply not part of the requested span, which is not an error.
 * - `closed` is `now >= weekEnd`, and `today` is the UTC calendar day of `now`,
 *   so the summary can never be told a today that contradicts its own
 *   boundaries. Totals are the plain sum of the returned rows.
 * - The result never depends on input order, and no input is mutated.
 */
export function summarizeFollowThrough(
  occurrences: ReadonlyArray<PlannedOccurrenceFacts>,
  windows: ReadonlyArray<TrainingWeekWindow>,
  now: Date,
): FollowThroughSummary {
  const today = plannedDateFromInstant(now);
  const windowStarts = windows.map((window) => plannedDateFromInstant(window.weekStart));
  const windowEnds = windows.map((window) => plannedDateFromInstant(window.weekEnd));
  const countsByWindow = windows.map(() => emptyCounts());

  for (const occurrence of assertUniqueOccurrences(occurrences)) {
    const index = windows.findIndex((_window, position) => {
      const weekStart = windowStarts[position];
      const weekEnd = windowEnds[position];
      if (weekStart === undefined || weekEnd === undefined) {
        return false; // Unreachable: both lists mirror `windows`.
      }
      return isWithinWeek(occurrence.plannedDate, weekStart, weekEnd);
    });
    if (index === -1) continue;

    const counts = countsByWindow[index];
    if (counts === undefined) continue; // Unreachable: index comes from windows.

    applyOutcome(counts, resolveFollowThroughOutcome(occurrence, today));
  }

  const weeks: FollowThroughWeek[] = [];
  const totals = emptyCounts();

  windows.forEach((window, position) => {
    const counts = countsByWindow[position];
    if (counts === undefined || counts.planned === 0) {
      return; // Unreachable for `undefined`: `countsByWindow` mirrors `windows`.
    }

    weeks.push({
      window,
      closed: now.getTime() >= window.weekEnd.getTime(),
      planned: counts.planned,
      completed: counts.completed,
      completedEarly: counts.completedEarly,
      completedLate: counts.completedLate,
      started: counts.started,
      pastDue: counts.pastDue,
    });

    totals.planned += counts.planned;
    totals.completed += counts.completed;
    totals.completedEarly += counts.completedEarly;
    totals.completedLate += counts.completedLate;
    totals.started += counts.started;
    totals.pastDue += counts.pastDue;
  });

  return { weeks, totals };
}

/** `[weekStart, weekEnd)`: `weekStart` inclusive, `weekEnd` exclusive. */
function isWithinWeek(date: PlannedDate, weekStart: PlannedDate, weekEnd: PlannedDate): boolean {
  return !isPlannedDateBefore(date, weekStart) && isPlannedDateBefore(date, weekEnd);
}

/** Adds one resolved outcome to a week's counters; `planned` always counts. */
function applyOutcome(counts: MutableCounts, outcome: FollowThroughOutcome): void {
  counts.planned += 1;

  switch (outcome) {
    case FollowThroughOutcome.CompletedEarly:
      counts.completed += 1;
      counts.completedEarly += 1;
      return;
    case FollowThroughOutcome.CompletedOnPlan:
      counts.completed += 1;
      return;
    case FollowThroughOutcome.CompletedLate:
      counts.completed += 1;
      counts.completedLate += 1;
      return;
    case FollowThroughOutcome.Started:
      counts.started += 1;
      return;
    case FollowThroughOutcome.PastDue:
      counts.pastDue += 1;
      return;
    case FollowThroughOutcome.Today:
    case FollowThroughOutcome.Upcoming:
      // Date-derived but neither behind nor session-bearing: nothing to add
      // beyond `planned`.
      return;
    default: {
      const exhaustive: never = outcome;
      throw new Error(`Unhandled follow-through outcome: ${String(exhaustive)}`);
    }
  }
}

/**
 * Returns the occurrences unchanged, after asserting one fact per occurrence.
 *
 * `(enrollmentId, scheduledWorkoutId)` is unique in `planned_workouts` and in
 * `workout_sessions`, so the bounded reads feeding this module return at most
 * one planned row and at most one session per occurrence. A repeat here means a
 * caller (usually a JOIN that fanned out, or an assembly bug) produced two
 * facts for one occurrence, and it is NOT reconciled: two facts for one
 * occurrence can contradict each other, and any "winner" rule would invent a
 * policy and report a count matching neither row. The violation fails loudly
 * (the `plannedDateWeekday` / `'Schedule contract violated: …'` convention)
 * instead of being silently normalized.
 */
function assertUniqueOccurrences(
  occurrences: ReadonlyArray<PlannedOccurrenceFacts>,
): ReadonlyArray<PlannedOccurrenceFacts> {
  const seen = new Set<string>();

  for (const occurrence of occurrences) {
    const id = occurrence.scheduledWorkoutId;
    if (seen.has(id)) {
      throw new Error(`Follow-through contract violated: occurrence "${id}" was supplied more than once`);
    }
    seen.add(id);
  }

  return occurrences;
}
