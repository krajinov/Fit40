/**
 * Presentation labels for the M18 Progress surface
 * (`docs/training-progress.md` §4, §6, §11).
 *
 * Deterministic: fixed UTC timezone and en-US locale, so a week or value always
 * renders the same label wherever the server runs. The locked vocabulary rules
 * apply here — factual observations only, no adherence/streak/score/verdict
 * wording — and no label mentions "UTC" (M15 owns the app's only UTC lines).
 */

import {
  formatHistoryCount,
  formatHistoryVolume,
} from '@/features/history/history-labels';

export const PROGRESS_HEADING = 'Progress';
export const PROGRESS_SUBHEADING =
  'Your last 13 weeks of completed training, week by week.';

export const WORKOUTS_CHART_TITLE = 'Completed workouts';
export const WORKOUTS_CHART_CAPTION = 'Completed workouts per week.';
export const WORKOUTS_CHART_ARIA_LABEL = 'Completed workouts by week';

export const SETS_CHART_TITLE = 'Logged sets';
export const SETS_CHART_CAPTION = 'Logged sets per week.';
export const SETS_CHART_ARIA_LABEL = 'Logged sets by week';

export const EXTERNAL_LOAD_CHART_TITLE = 'External load';
export const EXTERNAL_LOAD_CHART_CAPTION = 'External load per week, in kg × reps.';
export const EXTERNAL_LOAD_CHART_ARIA_LABEL = 'External load by week';

export const SUMMARY_TITLE = 'Last 13 weeks';
export const SUMMARY_NOTE_EMPTY = 'No completed workouts in the last 13 weeks.';
export const NO_LOADED_SETS_NOTE = 'No loaded sets in the last 13 weeks.';
export const ABSENT_LOAD_POINT_LABEL = 'No loaded sets';

export const THIS_WEEK_LABEL = 'This week';

export const UNAVAILABLE_ACTIVITY_MESSAGE = "Couldn't load your training activity.";
export const UNAVAILABLE_LOAD_MESSAGE = "Couldn't load your external load.";
export const UNAVAILABLE_SUMMARY_MESSAGE = "Couldn't load your period summary.";
export const UNAVAILABLE_PERSONAL_BESTS_MESSAGE = "Couldn't load your personal bests.";

// ─── Historical personal-best events (M18 Slice 6, memo §8.5, §11) ───────────
//
// Wording is historical on purpose, exactly like M14's run-scoped records: these
// rows are the PR events the period produced, NOT the user's current personal
// bests (the dashboard's M13 "Personal bests" card owns that claim). The
// separation is stated in the caption so no row can be read as a current best.

export const PERSONAL_BESTS_TIMELINE_TITLE = 'Personal bests in the last 13 weeks';
export const PERSONAL_BESTS_TIMELINE_CAPTION =
  'Historical events: each row is a personal best you set, not necessarily your current best.';
export const PERSONAL_BESTS_NONE_LABEL = 'No personal bests in the last 13 weeks.';
export const PERSONAL_BESTS_EMPTY_TITLE = 'No personal bests in the last 13 weeks';
export const PERSONAL_BESTS_EMPTY_BODY =
  'Personal bests you set in the last 13 weeks will appear here.';
/** Stated only when the exact count has no renderable row (memo §8.5). */
export const PERSONAL_BESTS_UNRESOLVED_NOTE =
  'Exercise details are not available for these personal bests.';

/** "First time" for a first exposure; otherwise the previous value (memo §8.5). */
export const FIRST_TIME_LABEL = 'First time';
export const STILL_YOUR_BEST_LABEL = 'Still your best';
export const SINCE_SURPASSED_LABEL = 'Since surpassed';

/**
 * The EXACT period count in words, e.g. "12 personal bests set in the last 13
 * weeks." A genuine zero renders as such — the count is never a fabricated
 * number, and it is never the display list's length.
 */
export function personalBestsCountCaption(count: number): string {
  if (count === 0) {
    return PERSONAL_BESTS_NONE_LABEL;
  }
  if (count === 1) {
    return '1 personal best set in the last 13 weeks.';
  }
  return `${formatHistoryCount(count)} personal bests set in the last 13 weeks.`;
}


/** The §4.5 missing-data copy: no average is rendered, never a fabricated 0. */
export const NO_AVERAGE_LABEL =
  'A weekly average appears once a completed week holds a workout.';

const MONTH_DAY = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

const MS_PER_DAY = 86_400_000;

/**
 * "Jun 29 – Jul 5" — the Monday–Sunday range of one week, from its UTC start.
 * Component-formatted, never a raw instant.
 */
export function formatWeekRange(weekStartIso: string): string {
  const start = new Date(weekStartIso);
  const end = new Date(start.getTime() + 6 * MS_PER_DAY);
  return `${MONTH_DAY.format(start)} – ${MONTH_DAY.format(end)}`;
}

/** "3 workouts" / "1 workout". */
export function formatWorkoutsValue(value: number): string {
  return `${formatHistoryCount(value)} ${value === 1 ? 'workout' : 'workouts'}`;
}

/** "18 sets" / "1 set". */
export function formatSetsValue(value: number): string {
  return `${formatHistoryCount(value)} ${value === 1 ? 'set' : 'sets'}`;
}

/**
 * "1,240 kg × reps" — the shared M18 volume label (Slice 3 alignment). A
 * genuine zero renders "0 kg × reps"; absence never reaches this formatter.
 */
export function formatExternalLoadValue(value: number): string {
  return formatHistoryVolume(value);
}

/** "2.3" — at most one fractional digit, en-US (memo §4.5). */
export function formatAverageWorkoutsPerWeek(workoutsPerWeek: number): string {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 1 }).format(workoutsPerWeek);
}

/**
 * "Showing the 10 newest." — stated only when the exact count exceeds the rows
 * actually rendered (the display cap, memo §8.5). The number is the count of
 * RENDERED rows: a catalog-unresolved event has no row at all and never inflates
 * the sentence, and the exact count above it is never rewritten.
 */
export function personalBestsCapNote(shown: number): string {
  return `Showing the ${formatHistoryCount(shown)} newest.`;
}

/**
 * "12 personal bests" — the period summary's fragment, from the EXACT count
 * (never the display list's length). A genuine zero stays "0 personal bests":
 * an unavailable read has no fragment at all, so the two states never blur.
 */
export function personalBestsSummaryFragment(count: number): string {
  return `${formatHistoryCount(count)} ${count === 1 ? 'personal best' : 'personal bests'}`;
}


/**
 * The §4.5 locked basis wording: the average's denominator counts completed
 * weeks from the first one holding a workout, so the sentence states that
 * basis rather than implying "weeks you trained".
 */
export function averageWorkoutsLabel(workoutsPerWeek: number): string {
  return `${formatAverageWorkoutsPerWeek(workoutsPerWeek)} workouts per week on average since your first completed workout in this period`;
}

/** "Across 12 completed weeks." — the exact divisor the Domain used. */
export function averageBasisCaption(denominatorWeeks: number): string {
  return denominatorWeeks === 1
    ? 'Across 1 completed week.'
    : `Across ${formatHistoryCount(denominatorWeeks)} completed weeks.`;
}
