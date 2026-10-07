/**
 * Serializable DTOs for the M16 run-scoped plan follow-through read.
 *
 * The report restates rows: it reconciles the run's CURRENT calendar intent
 * (planned rows) with its execution truth (session facts) and reports counts.
 * Every value here is plain and presentation-safe — no repository models, no
 * enrollment/session ids, no branded ids, no mutable Domain objects, and instants
 * as ISO-8601 strings.
 *
 * Deliberately absent, and not to be added: percentages, ratios, adherence
 * scores, streaks, goals, on-track/off-track verdicts, and anything derived from
 * a plan that no longer exists (the report describes the calendar as it stands
 * now). Week labels, date ranges and all wording belong to the presentation
 * layer.
 *
 * `configured` is a discriminated union rather than a flag beside always-present
 * counts: a run with no planned rows has nothing to reconcile, so its variant
 * carries no week list and no totals at all. That makes "unconfigured, but here
 * are some zero counts" unrepresentable instead of merely forbidden.
 */

import type { FollowThroughSummary, FollowThroughWeek } from '@/domain/services/follow-through-week';
import type { PlannedDate } from '@/domain/value-objects/planned-date';

/** The six counts one week can report. Plain integers, never a judgement. */
export interface FollowThroughWeekCountsDto {
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

/** One reported week: its UTC window, whether it is over, and its counts. */
export interface FollowThroughWeekDto extends FollowThroughWeekCountsDto {
  /** ISO-8601 instant: the window's inclusive start (Monday 00:00 UTC). */
  readonly weekStart: string;
  /** ISO-8601 instant: the window's exclusive end (next Monday 00:00 UTC). */
  readonly weekEnd: string;
  /** True when the whole week lies in the past (`now >= weekEnd`). */
  readonly closed: boolean;
}

/** The same six numbers summed over the reported weeks. */
export type FollowThroughTotalsDto = FollowThroughWeekCountsDto;

/** A run that has never been configured: there is no calendar to report on. */
export interface UnconfiguredFollowThroughDto {
  readonly programSlug: string;
  /** The UTC calendar date this report was read for (the request clock's day). */
  readonly today: string;
  readonly configured: false;
}

/**
 * A configured run's follow-through report.
 *
 * `weeks` holds only the weeks with at least one planned occurrence, oldest
 * first: a window with nothing planned is omitted rather than rendered as a
 * fabricated zero week.
 */
export interface ConfiguredFollowThroughDto {
  readonly programSlug: string;
  /** The UTC calendar date this report was read for (the request clock's day). */
  readonly today: string;
  readonly configured: true;
  readonly weeks: ReadonlyArray<FollowThroughWeekDto>;
  readonly totals: FollowThroughTotalsDto;
}

/** The outcome of a follow-through read for a run that exists. */
export type EnrollmentFollowThroughDto = UnconfiguredFollowThroughDto | ConfiguredFollowThroughDto;

/** A run with no planned rows: no week list and no totals are fabricated. */
export function toUnconfiguredFollowThroughDto(
  programSlug: string,
  today: PlannedDate,
): UnconfiguredFollowThroughDto {
  return { programSlug, today, configured: false };
}

/**
 * Maps a Domain follow-through summary onto the DTO.
 *
 * A pure projection: each count is copied as the Domain reported it. Nothing is
 * recomputed, re-derived or normalized here — not a week count, not a total, not
 * a `closed` flag — so the report the Domain decided is the report the view sees.
 */
export function toConfiguredFollowThroughDto(
  programSlug: string,
  today: PlannedDate,
  summary: FollowThroughSummary,
): ConfiguredFollowThroughDto {
  return {
    programSlug,
    today,
    configured: true,
    weeks: summary.weeks.map(toFollowThroughWeekDto),
    totals: {
      planned: summary.totals.planned,
      completed: summary.totals.completed,
      completedEarly: summary.totals.completedEarly,
      completedLate: summary.totals.completedLate,
      started: summary.totals.started,
      pastDue: summary.totals.pastDue,
    },
  };
}

/** One week's window instants and counts, copied verbatim. */
function toFollowThroughWeekDto(week: FollowThroughWeek): FollowThroughWeekDto {
  return {
    weekStart: week.window.weekStart.toISOString(),
    weekEnd: week.window.weekEnd.toISOString(),
    closed: week.closed,
    planned: week.planned,
    completed: week.completed,
    completedEarly: week.completedEarly,
    completedLate: week.completedLate,
    started: week.started,
    pastDue: week.pastDue,
  };
}
