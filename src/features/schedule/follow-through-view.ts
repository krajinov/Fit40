/**
 * Presentation view assembly for the M16 plan follow-through section (Slice 4).
 *
 * Pure and presentational. Every number it renders — a week's counts, the
 * section totals, `closed`, `today` — arrives already decided on the Slice 3
 * DTO; this module only turns those authoritative values into display labels.
 * It never resolves a follow-through outcome, buckets an occurrence, sums a
 * total, decides what is past due or completed early/late, or decides whether a
 * week is closed, and it never reads a clock.
 *
 * Calendar labels are built the M15 way: the DTO's window bounds are
 * authoritative ISO instants, so their UTC calendar dates are read as
 * components and the week's last covered day is derived with the domain's own
 * date helpers. No zoneless date is ever parsed into a local `Date`, and no
 * locale/timezone preference is introduced.
 */

import type {
  ConfiguredFollowThroughDto,
  FollowThroughWeekCountsDto,
  FollowThroughWeekDto,
} from '@/application/dto/follow-through';
import {
  addDaysToPlannedDate,
  createPlannedDate,
  type PlannedDate,
} from '@/domain/value-objects/planned-date';
import { formatPlannedDateLabel } from '@/lib/dates';

/** The locked section framing: what this report is, and the horizon it covers. */
export const FOLLOW_THROUGH_TITLE = 'This plan so far';
export const FOLLOW_THROUGH_HORIZON_LABEL = 'last 8 weeks';

/**
 * The single locked disclosure for this report (M16 plan R6). The M13
 * convention is a copy constant rather than a derived horizon label, so the
 * wording stays reviewable in one place.
 */
export const FOLLOW_THROUGH_DISCLOSURE =
  'This describes the dates currently on your calendar. Changing your training days replaces them.';

/**
 * Rendered when the run has a calendar but no planned date inside the horizon:
 * an honest statement about the span, never a fabricated zero week.
 */
export const FOLLOW_THROUGH_HORIZON_EMPTY_MESSAGE = 'No planned dates in the last 8 weeks.';

/** The current (still open) week's marker — text, never colour alone. */
export const CURRENT_WEEK_LABEL = 'This week';

/** One week's presentation labels. Counts are copied from the DTO verbatim. */
export interface FollowThroughWeekRowView {
  /** Stable key: the window's inclusive start instant. */
  readonly weekStart: string;
  /** The week's covered days, e.g. `Sep 21–27` or `Sep 28–Oct 4`. */
  readonly rangeLabel: string;
  /** `2 of 3 done` — the DTO's own completed-over-planned counts. */
  readonly progressLabel: string;
  /** `1 started`, or null when the DTO reports none. */
  readonly startedLabel: string | null;
  /** `1 past due`, or null when the DTO reports none. */
  readonly pastDueLabel: string | null;
  /** `1 not performed`, or null when the DTO reports none. */
  readonly notPerformedLabel: string | null;
  /**
   * True only for the still-open week containing the DTO's `today`. `closed`
   * stays authoritative and is never recomputed; a provisional future week is
   * not `isCurrent` and is framed no differently from a closed one.
   */
  readonly isCurrent: boolean;
}

/**
 * The reported weeks and their totals, or the honest empty-horizon statement.
 * Modelled as a variant so "empty report, but here are zero totals" cannot be
 * rendered by accident.
 */
export type FollowThroughSummaryView =
  | { readonly status: 'empty'; readonly message: string }
  | {
      readonly status: 'weeks';
      readonly totalsLabel: string;
      readonly weeks: ReadonlyArray<FollowThroughWeekRowView>;
    };

export interface FollowThroughSectionView {
  readonly title: string;
  readonly horizonLabel: string;
  readonly summary: FollowThroughSummaryView;
  /**
   * One factual line when the run has recorded occurrences with no current
   * planned row, or null otherwise. It names the count and the surface that owns
   * them (the calendar on this page); it carries no action, no undo control and
   * no unplaced-copy sentence — the labelled list lives in the M15 calendar.
   */
  readonly unplacedNotPerformedLabel: string | null;
  readonly disclosure: string;
}

/** Builds every label the section renders from one configured report. */
export function buildFollowThroughView(dto: ConfiguredFollowThroughDto): FollowThroughSectionView {
  return {
    title: FOLLOW_THROUGH_TITLE,
    horizonLabel: FOLLOW_THROUGH_HORIZON_LABEL,
    summary:
      dto.weeks.length === 0
        ? { status: 'empty', message: FOLLOW_THROUGH_HORIZON_EMPTY_MESSAGE }
        : {
            status: 'weeks',
            totalsLabel: totalsLabel(dto.totals),
            weeks: dto.weeks.map((week) => weekRowView(week, dto.today)),
          },
    unplacedNotPerformedLabel:
      dto.notPerformedUnplaced > 0
        ? countLabel(dto.notPerformedUnplaced, FOLLOW_THROUGH_UNPLACED_POINTER)
        : null,
    disclosure: FOLLOW_THROUGH_DISCLOSURE,
  };
}

/**
 * The pointer phrase for recorded occurrences that hold no current planned row.
 *
 * Factual and verbless, so any count reads correctly and nothing is claimed about
 * dates, weeks or the horizon. It names the calendar section on this page, which
 * is where those occurrences are listed and undone — this report only points.
 */
export const FOLLOW_THROUGH_UNPLACED_POINTER =
  'recorded as not performed without a calendar date — see Training schedule';

/** One week's labels, using only values the DTO already carries. */
function weekRowView(week: FollowThroughWeekDto, today: string): FollowThroughWeekRowView {
  const weekStartDate = utcDateOf(week.weekStart);
  const weekEndDate = utcDateOf(week.weekEnd);

  return {
    weekStart: week.weekStart,
    rangeLabel: weekRangeLabel(week.weekStart, week.weekEnd),
    progressLabel: `${week.completed} of ${week.planned} done`,
    startedLabel: week.started > 0 ? countLabel(week.started, 'started') : null,
    pastDueLabel: week.pastDue > 0 ? countLabel(week.pastDue, 'past due') : null,
    notPerformedLabel:
      week.notPerformed > 0 ? countLabel(week.notPerformed, 'not performed') : null,
    // `closed` is authoritative: a closed week is never the current one, and a
    // week is only "current" when today falls inside its [start, end) dates.
    isCurrent:
      !week.closed &&
      weekStartDate !== null &&
      weekEndDate !== null &&
      weekStartDate <= today &&
      today < weekEndDate,
  };
}

/**
 * The section totals as one compact, factual line.
 *
 * The two core counts always show (a real zero stays a zero); the classifications
 * appear only when they carry information, because early/late are section-level
 * context rather than per-row noise. Nothing here is summed from the week rows,
 * turned into a percentage or a score, or compared against a target.
 */
function totalsLabel(totals: FollowThroughWeekCountsDto): string {
  const fragments = [`${totals.planned} planned`, `${totals.completed} done`];

  if (totals.completedEarly > 0) {
    fragments.push(`${totals.completedEarly} completed early`);
  }
  if (totals.completedLate > 0) {
    fragments.push(`${totals.completedLate} completed late`);
  }
  if (totals.started > 0) {
    fragments.push(countLabel(totals.started, 'started'));
  }
  if (totals.pastDue > 0) {
    fragments.push(countLabel(totals.pastDue, 'past due'));
  }
  if (totals.notPerformed > 0) {
    // A restatement of the recorded facts in the reported weeks — never a
    // separate denominator: those occurrences are already counted as planned.
    fragments.push(countLabel(totals.notPerformed, 'not performed'));
  }

  return fragments.join(' · ');
}

/** `1 past due` / `2 past due` — no noun, so no pluralisation to get wrong. */
function countLabel(count: number, phrase: string): string {
  return `${count} ${phrase}`;
}

/**
 * The week's covered days, e.g. `Sep 21–27`, or `Sep 28–Oct 4` when the week
 * spans two months.
 *
 * Both bounds are authoritative ISO instants: the window's own start date and
 * the day before its exclusive end. A bound that is not a canonical UTC date is
 * corrupt input, so the raw start instant is returned unchanged rather than a
 * fabricated range (the `formatPlannedDateLabel` rule).
 */
function weekRangeLabel(weekStartIso: string, weekEndIso: string): string {
  const startDate = utcDateOf(weekStartIso);
  const endDate = utcDateOf(weekEndIso);
  if (startDate === null || endDate === null) {
    return weekStartIso;
  }

  const start = createPlannedDate(startDate);
  const exclusiveEnd = createPlannedDate(endDate);
  if (!start.ok || !exclusiveEnd.ok) {
    return weekStartIso;
  }

  // The window's exclusive end is the day after its last covered day.
  const lastDay = addDaysToPlannedDate(exclusiveEnd.data, -1);
  if (!lastDay.ok) {
    return weekStartIso;
  }

  return rangeLabel(start.data, lastDay.data);
}

/** `Sep 21–27` inside one month, `Sep 28–Oct 4` across two. */
function rangeLabel(start: PlannedDate, lastDay: PlannedDate): string {
  const startLabel = formatPlannedDateLabel(start);
  const lastDayLabel = formatPlannedDateLabel(lastDay);

  if (start.slice(0, 7) === lastDay.slice(0, 7)) {
    // Same calendar month: the month is named once, like the locked example.
    return `${startLabel}–${dayOfMonth(lastDay)}`;
  }
  return `${startLabel}–${lastDayLabel}`;
}

/** The day number of a canonical date, leading zeros dropped (`04` → `4`). */
function dayOfMonth(date: PlannedDate): string {
  return String(Number(date.slice(8, 10)));
}

/**
 * The UTC calendar date of an authoritative ISO instant, or null when the value
 * is not a parseable instant. The instant is read as its UTC date part — never
 * through a local-time conversion — and every window bound produced by the
 * shared week model is exactly UTC midnight, so this projection is lossless.
 */
function utcDateOf(isoInstant: string): string | null {
  const time = Date.parse(isoInstant);
  if (Number.isNaN(time)) {
    return null;
  }
  return new Date(time).toISOString().slice(0, 10);
}
