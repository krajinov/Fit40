import type {
  RecentPersonalBestDto,
  TrainingWeeklyInsightsDto,
  WeeklyInsightWeekDto,
} from '@/application/dto/training-insights';
import { personalBestValueLabel } from '@/features/history/personal-best-view';
import { formatHistoryDate } from '@/features/history/history-labels';

export interface WeeklyStatView {
  readonly label: string;
  readonly value: string;
}

export interface WeeklyActivityWeekView {
  readonly weekStart: string;
  readonly completedWorkouts: number;
  readonly accessibleLabel: string;
  readonly isCurrentWeek: boolean;
}

export interface WeeklyPersonalBestView {
  readonly sessionId: string;
  readonly exerciseName: string;
  readonly exerciseSlug: string;
  readonly valueLabel: string;
  readonly completedAtLabel: string;
}

export interface WeeklyInsightsView {
  readonly weekLabel: string;
  readonly stats: ReadonlyArray<WeeklyStatView>;
  readonly comparisonLabel: string;
  readonly activityCaption: string;
  readonly activityWeeks: ReadonlyArray<WeeklyActivityWeekView>;
  readonly personalBestsCaption: string;
  readonly personalBests: ReadonlyArray<WeeklyPersonalBestView>;
}

export const WEEKS_RUN_MONDAY_SUNDAY_UTC = 'Weeks run Monday–Sunday (UTC).';
export const STILL_STANDING_PB_CAPTION =
  'Still-standing personal bests achieved this week.';
export const RECENT_PERSONAL_BESTS_CAPTION =
  'Current bests achieved in the last 8 weeks — only bests that still stand are shown.';
export const WEEKLY_INSIGHTS_UNAVAILABLE_MESSAGE =
  "Couldn't load this week's summary.";
export const RECENT_PERSONAL_BESTS_UNAVAILABLE_MESSAGE =
  "Couldn't load recent personal records.";
export const WEEKLY_INSIGHTS_TITLE = 'This week';
export const PERSONAL_BESTS_TITLE = 'Personal bests';
export const PERSONAL_BESTS_EMPTY_MESSAGE =
  'Personal bests you achieve in the coming weeks will appear here.';

/** "Feb 16" — en-US + fixed UTC, matching the dashboard date convention. */
const MONTH_DAY_FORMAT = new Intl.DateTimeFormat('en-US', {
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "Week of Feb 16" (fixed UTC), matching the dashboard date convention. */
export function formatWeekStartLabel(weekStartIso: string): string {
  return `Week of ${MONTH_DAY_FORMAT.format(new Date(weekStartIso))}`;
}

/** "Feb 16, 2026" (fixed UTC), matching the history date convention. */
export function formatPersonalBestDate(completedAtIso: string): string {
  return formatHistoryDate(completedAtIso);
}

function pluralize(count: number, singular: string): string {
  return count === 1 ? singular : `${singular}s`;
}

/** Signed unit fragment: "+2 workouts" / "−1 workout" / "±0 workouts". */
function signedUnits(delta: number, singular: string): string {
  const sign = delta > 0 ? '+' : delta < 0 ? '−' : '±';
  return `${sign}${Math.abs(delta)} ${pluralize(
    Math.abs(delta),
    singular,
  )}`;
}

/**
 * Factual week-over-week comparison copy. Wording branches only — all values
 * come from the Application DTO (domain-computed deltas), never re-derived.
 */
export function weeklyComparisonLabel(
  currentWorkouts: number,
  previousWorkouts: number,
  workoutDelta: number,
  setDelta: number,
): string {
  if (previousWorkouts === 0 && currentWorkouts === 0) {
    return 'No training in the last two weeks.';
  }
  if (previousWorkouts === 0) {
    return 'No training last week.';
  }
  if (workoutDelta === 0 && setDelta === 0) {
    return 'Same as last week.';
  }
  return `${signedUnits(workoutDelta, 'workout')} · ${signedUnits(
    setDelta,
    'set',
  )} vs last week`;
}

function toActivityWeekView(
  week: WeeklyInsightWeekDto,
  index: number,
  weeks: ReadonlyArray<WeeklyInsightWeekDto>,
): WeeklyActivityWeekView {
  const isCurrentWeek = index === weeks.length - 1;
  const weekLabel = formatWeekStartLabel(week.weekStart);
  return {
    weekStart: week.weekStart,
    completedWorkouts: week.completedWorkouts,
    accessibleLabel: `${weekLabel}: ${week.completedWorkouts} ${pluralize(
      week.completedWorkouts,
      'workout',
    )}${isCurrentWeek ? ' (this week)' : ''}`,
    isCurrentWeek,
  };
}

function toPersonalBestView(dto: RecentPersonalBestDto): WeeklyPersonalBestView {
  return {
    sessionId: dto.sessionId,
    exerciseName: dto.exerciseName,
    exerciseSlug: dto.exerciseSlug,
    // M12's shared value formatter ("82.5 kg" / "18 reps" / "75 sec") —
    // presentation rules live in one place. It reads only metric and value;
    // no intra-session position exists on this DTO and none is invented.
    valueLabel: personalBestValueLabel({ metric: dto.metric, value: dto.value }),
    completedAtLabel: formatPersonalBestDate(dto.completedAt),
  };
}

/**
 * Maps the TrainingWeeklyInsights DTO to display labels. Presentation-only:
 * no domain semantics are recomputed here.
 */
export function toWeeklyInsightsView(
  dto: TrainingWeeklyInsightsDto,
): WeeklyInsightsView {
  const current = dto.summary.currentWeek;
  const previous = dto.summary.previousWeek;
  return {
    weekLabel: formatWeekStartLabel(dto.weekStart),
    stats: [
      { label: 'Workouts', value: String(current.completedWorkouts) },
      { label: 'Sets', value: String(current.loggedSets) },
      {
        label: 'Current PBs set',
        value: String(dto.summary.currentPersonalBestsSetThisWeek),
      },
    ],
    comparisonLabel: weeklyComparisonLabel(
      current.completedWorkouts,
      previous.completedWorkouts,
      dto.summary.workoutDelta,
      dto.summary.setDelta,
    ),
    activityCaption: WEEKS_RUN_MONDAY_SUNDAY_UTC,
    activityWeeks: dto.weeks.map(toActivityWeekView),
    personalBestsCaption: RECENT_PERSONAL_BESTS_CAPTION,
    personalBests: dto.recentPersonalBests.map(toPersonalBestView),
  };
}
