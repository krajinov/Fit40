/**
 * Server-side view assembly for the Progress personal-best timeline
 * (M18 Slice 6, `docs/training-progress.md` §8.3–§8.5).
 *
 * `toProgressRecordTimelineView` is the pure DTO → view-model mapping for the
 * historical PR events the Slice 5 read resolved: it formats the exact count,
 * the metric/value pairs, the dates and the session hrefs, and it maps
 * still-stands context straight from the DTO's `stillStanding` fact.
 *
 * It decides NOTHING about records. It never sorts, never re-slices the newest-N
 * selection, never recomputes ownership, never infers still-stands from value
 * equality, and never counts the display rows — the count comes from
 * `recordEventCount` and the rows keep the DTO's chronological order
 * (oldest → newest, memo §8.4).
 *
 * Degradation matches the activity read: a typed rejection and an unexpected
 * failure both become `unavailable` (the failure is logged) — never a zero
 * count, which would claim the period produced no personal best.
 */

import type {
  ProgressRecordEventDto,
  ProgressRecordEventsDto,
} from '@/application/dto/training-progress';
import { formatHistoryDate } from '@/features/history/history-labels';
import {
  personalBestMetricLabel,
  personalBestValueLabel,
} from '@/features/history/personal-best-view';
import {
  FIRST_TIME_LABEL,
  PERSONAL_BESTS_EMPTY_BODY,
  PERSONAL_BESTS_EMPTY_TITLE,
  PERSONAL_BESTS_TIMELINE_CAPTION,
  PERSONAL_BESTS_TIMELINE_TITLE,
  PERSONAL_BESTS_UNRESOLVED_NOTE,
  personalBestsCapNote,
  personalBestsCountCaption,
  personalBestsSummaryFragment,
  SINCE_SURPASSED_LABEL,
  STILL_YOUR_BEST_LABEL,
} from '@/features/progress/progress-labels';
import { getTrainingProgressRecordEventsUseCase } from '@/features/progress/services';

/** One historical personal-best event, formatted for a timeline row. */
export interface ProgressRecordEventView {
  /** Stable row identity: the event's own logged set, so same-session rows differ. */
  readonly key: string;
  readonly exerciseName: string;
  /** What the record measures, e.g. "Heaviest load" (M12's shared formatter). */
  readonly metricLabel: string;
  /** The record value in its metric's own unit, e.g. "82.5 kg" / "18 reps". */
  readonly valueLabel: string;
  /** The event's completion date, e.g. "Sep 21, 2026" (UTC, deterministic). */
  readonly completedAtLabel: string;
  /** "First time" for a first exposure, otherwise "Previous best 80 kg". */
  readonly previousBestLabel: string;
  /** "Still your best" / "Since surpassed" — carried, never recomputed here. */
  readonly standingLabel: string;
  /** The DTO's ownership fact, so a row can style its context without comparing. */
  readonly stillStanding: boolean;
  /** The completed session holding the event's logged set. */
  readonly sessionHref: string;
}

/** The period's historical personal-best timeline (memo §8.3–§8.5). */
export interface ProgressRecordTimelineView {
  readonly title: string;
  readonly caption: string;
  /** EXACT period event count — never the display list's length. */
  readonly recordEventCount: number;
  readonly countCaption: string;
  readonly events: ReadonlyArray<ProgressRecordEventView>;
  /** "Showing the 10 newest." when the count exceeds the rendered rows, else null. */
  readonly capNote: string | null;
  /** The factual empty state, present only when the period holds no event. */
  readonly emptyState: { readonly title: string; readonly body: string } | null;
  /**
   * Stated only when the exact count has no renderable row: a
   * catalog-unresolved event is never backfilled, renamed or invented as a row
   * and never changes the count (memo §8.5).
   */
  readonly unresolvedNote: string | null;
  /** "12 personal bests" — the period summary's fragment (the exact count). */
  readonly summaryFragment: string;
}

export type ProgressRecordTimelineState =
  | { readonly status: 'loaded'; readonly data: ProgressRecordTimelineView }
  | { readonly status: 'unavailable' };

/**
 * "Previous best 80 kg" / "First time" — the previous value in the metric's own
 * unit (kilograms, reps or seconds; never the volume unit).
 */
function previousBestLabel(event: ProgressRecordEventDto): string {
  return event.previousBest === null
    ? FIRST_TIME_LABEL
    : `Previous best ${personalBestValueLabel({
        metric: event.metric,
        value: event.previousBest,
      })}`;
}

/** Pure DTO → view mapping for the period's historical personal-best events. */
export function toProgressRecordTimelineView(
  dto: ProgressRecordEventsDto,
): ProgressRecordTimelineView {
  const shown = dto.events.length;
  const count = dto.recordEventCount;

  return {
    title: PERSONAL_BESTS_TIMELINE_TITLE,
    caption: PERSONAL_BESTS_TIMELINE_CAPTION,
    recordEventCount: count,
    countCaption: personalBestsCountCaption(count),
    events: dto.events.map((event, index) => ({
      key: `${index}-${event.sessionId}-${event.exerciseId}-${event.metric}`,
      exerciseName: event.exerciseName,
      metricLabel: personalBestMetricLabel(event.metric),
      valueLabel: personalBestValueLabel(event),
      completedAtLabel: formatHistoryDate(event.completedAt),
      previousBestLabel: previousBestLabel(event),
      standingLabel: event.stillStanding ? STILL_YOUR_BEST_LABEL : SINCE_SURPASSED_LABEL,
      stillStanding: event.stillStanding,
      sessionHref: `/history/sessions/${event.sessionId}`,
    })),
    capNote: count > shown ? personalBestsCapNote(shown) : null,
    emptyState:
      count === 0 ? { title: PERSONAL_BESTS_EMPTY_TITLE, body: PERSONAL_BESTS_EMPTY_BODY } : null,
    unresolvedNote: count > 0 && shown === 0 ? PERSONAL_BESTS_UNRESOLVED_NOTE : null,
    summaryFragment: personalBestsSummaryFragment(count),
  };
}

/**
 * Builds the timeline state for one authenticated user at one request clock.
 * Independent of the activity read: a failure here never touches the charts,
 * and it never fabricates a count.
 */
export async function buildProgressRecordTimeline(
  userId: string,
  now: Date,
): Promise<ProgressRecordTimelineState> {
  try {
    const result = await getTrainingProgressRecordEventsUseCase.execute({ userId, now });
    return result.ok
      ? { status: 'loaded', data: toProgressRecordTimelineView(result.data) }
      : { status: 'unavailable' };
  } catch (error: unknown) {
    console.error(`Unexpected failure reading personal bests for user ${userId}`, error);
    return { status: 'unavailable' };
  }
}
