/**
 * Training-progress period aggregation (M18 Slice 1).
 *
 * Pure Domain rules for the M18 Progress surface. The canonical semantics are
 * `docs/training-progress.md`; the three functions here are the single
 * authority for:
 *
 * 1. `summarizeProgressWeeks` — buckets completed-session activity rows into
 *    the CALLER's UTC training-week windows with the same `[weekStart,
 *    weekEnd)` placement rule as M13's `summarizeTrainingWeeks` (memo §5.4),
 *    and adds external-load volume with the §6.3 presence rule: a week's
 *    `externalLoad` is null iff every in-week session had NO eligible loaded
 *    set (bodyweight/duration-only training is unloaded training, never zero
 *    loaded training), while a genuine sum of `0 kg` sets stays a real zero.
 * 2. `summarizeProgressPeriod` — totals across exactly the supplied windows
 *    (memo §4.4, including the current partial week when the caller supplies
 *    it); the period `externalLoad` is null iff every week is null.
 * 3. `resolveAverageWorkoutsPerWeek` — the §4.5 anchored average: the LAST
 *    supplied window is the current partial week (the
 *    `listRecentTrainingWeekWindows` contract) and is excluded; the
 *    denominator is the count of completed weeks from the first completed
 *    week holding ≥1 workout through the last completed week, so interior AND
 *    trailing zero weeks count while pre-tracking weeks never do. No
 *    completed training weeks ⇒ `null` — never a fabricated `0`.
 *
 * Boundaries: no clock (windows are always a parameter), no formatting, no
 * persistence vocabulary, no repository types, no knowledge of any particular
 * horizon length. Inputs are trusted (the repository `limit` convention) and
 * are never mutated. One summary is returned per supplied window, in the
 * supplied order, zeros included: a week without completed sessions is an
 * authoritative zero, never an "untracked" state.
 */

import type { TrainingWeekWindow } from '@/domain/services/training-week';

// ─── Inputs ─────────────────────────────────────────────────────────────────

/**
 * One completed session as period aggregation consumes it — structurally
 * compatible with M13's `CompletedSessionActivity`, plus the external-load
 * fact.
 *
 * `externalLoadVolume` is the session's `calculateSessionMetrics().volume`
 * when the session logged at least one rep set with `weightKg !== null`, and
 * `null` when it logged none (§6.3 presence, resolved by the read side):
 * `0` is a genuine zero external load, `null` is no eligible data. The two
 * must never collapse into one another.
 */
export interface ProgressActivityRow {
  readonly completedAt: Date;
  readonly loggedSets: number;
  readonly externalLoadVolume: number | null;
}

// ─── Outputs ────────────────────────────────────────────────────────────────

/** A week's (or period's) external-load sum in `kg × reps`, when present. */
export interface ProgressExternalLoad {
  readonly volumeKgReps: number;
}

/** One supplied window's factual totals (memo §4.1–§4.3). */
export interface ProgressWeekSummary {
  readonly window: TrainingWeekWindow;
  readonly completedWorkouts: number;
  readonly loggedSets: number;
  /** null iff no in-week session carried eligible external-load data. */
  readonly externalLoad: ProgressExternalLoad | null;
}

/** Totals across every supplied window (memo §4.4). */
export interface ProgressPeriodTotals {
  readonly completedWorkouts: number;
  readonly loggedSets: number;
  /** null iff every supplied week's `externalLoad` is null. */
  readonly externalLoad: ProgressExternalLoad | null;
}

/**
 * The §4.5 anchored average: `workoutsPerWeek` is the raw quotient (rounding
 * and wording are presentation concerns) and `denominatorWeeks` is the exact
 * divisor used, so the UI can state the basis in words.
 */
export interface AverageWorkoutsPerWeek {
  readonly workoutsPerWeek: number;
  readonly denominatorWeeks: number;
}

// ─── Week bucketing ─────────────────────────────────────────────────────────

/**
 * Buckets activity rows into the supplied windows and totals each one.
 *
 * Behavior (mirrors `summarizeTrainingWeeks` for workouts/sets):
 * - Placement is `[weekStart, weekEnd)` — `weekStart` inclusive,
 *   `weekEnd` exclusive, so an instant on a boundary belongs to exactly one
 *   window and attribution is decided by `completedAt` alone.
 * - Every in-window row counts as one completed workout; `loggedSets` are
 *   summed (a zero-set completed session therefore counts as a workout).
 * - A row's volume contributes only when it is non-null; a week's
 *   `externalLoad` is null iff every in-week row is null, otherwise the sum
 *   of the non-null rows (which may legitimately be `0`).
 * - Rows outside every supplied window are ignored — they are simply not
 *   part of the requested span, not an error.
 * - One summary is returned per supplied window, in the supplied order, zeros
 *   included; inputs are never mutated.
 */
export function summarizeProgressWeeks(
  rows: ReadonlyArray<ProgressActivityRow>,
  windows: ReadonlyArray<TrainingWeekWindow>,
): ReadonlyArray<ProgressWeekSummary> {
  const summaries: ProgressWeekSummary[] = windows.map((window) => ({
    window,
    completedWorkouts: 0,
    loggedSets: 0,
    externalLoad: null,
  }));

  for (const row of rows) {
    const completedAtMs = row.completedAt.getTime();
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
      loggedSets: summary.loggedSets + row.loggedSets,
      externalLoad:
        row.externalLoadVolume === null
          ? summary.externalLoad
          : {
              volumeKgReps:
                (summary.externalLoad?.volumeKgReps ?? 0) + row.externalLoadVolume,
            },
    };
  }

  return summaries;
}

// ─── Period totals ──────────────────────────────────────────────────────────

/**
 * Totals one supplied period (memo §4.4): plain sums of workouts and logged
 * sets, plus the external-load sum whose presence follows §6.3 — the period
 * value is null iff every week is null, never a misleading `0`.
 */
export function summarizeProgressPeriod(
  summaries: ReadonlyArray<ProgressWeekSummary>,
): ProgressPeriodTotals {
  let completedWorkouts = 0;
  let loggedSets = 0;
  let volumeKgReps: number | null = null;

  for (const summary of summaries) {
    completedWorkouts += summary.completedWorkouts;
    loggedSets += summary.loggedSets;
    if (summary.externalLoad !== null) {
      volumeKgReps = (volumeKgReps ?? 0) + summary.externalLoad.volumeKgReps;
    }
  }

  return {
    completedWorkouts,
    loggedSets,
    externalLoad: volumeKgReps === null ? null : { volumeKgReps },
  };
}

// ─── Anchored average ───────────────────────────────────────────────────────

/**
 * The §4.5 anchored average over the supplied summaries.
 *
 * Contract: the LAST supplied window is the current partial week (exactly
 * what `listRecentTrainingWeekWindows` produces) and never enters the
 * average — its count is already visible as "This week". The denominator is
 * the completed weeks from the first completed week holding ≥1 workout
 * through the last completed week:
 * - interior zero weeks count (a gap inside the span is a real zero),
 * - trailing zero weeks count (stopping training lowers the average),
 * - weeks before the first trained week never count (they are pre-tracking,
 *   not "did not train").
 *
 * Returns `null` — never `0` — when no completed week holds a workout (memo
 * §4.5 missing-data behavior), including an empty input or a horizon whose
 * only window is the current partial week.
 */
export function resolveAverageWorkoutsPerWeek(
  summaries: ReadonlyArray<ProgressWeekSummary>,
): AverageWorkoutsPerWeek | null {
  const completedWeeks = summaries.slice(0, -1);

  let anchor = -1;
  let numerator = 0;
  for (let index = 0; index < completedWeeks.length; index += 1) {
    const summary = completedWeeks[index];
    if (summary === undefined) continue; // Unreachable: index from length.

    numerator += summary.completedWorkouts;
    if (anchor === -1 && summary.completedWorkouts > 0) {
      anchor = index;
    }
  }

  if (anchor === -1) {
    return null;
  }

  return {
    workoutsPerWeek: numerator / (completedWeeks.length - anchor),
    denominatorWeeks: completedWeeks.length - anchor,
  };
}
