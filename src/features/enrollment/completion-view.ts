/**
 * Presentation mapping for the M14 program completion screen (Slice 6).
 *
 * Pure presentation: every field comes from the completed-run DTO that
 * GetProgramCompletionSummaryUseCase already resolved. This module formats
 * dates, counts and record values and builds the page's hrefs — it never
 * decides whether a program is complete, never re-derives record events or
 * the exact event count, never compares record values, and carries no
 * restart policy.
 *
 * Wording is historical on purpose: "Personal records during this program"
 * are the M12 events that occurred while this run was in progress, NOT the
 * user's current personal bests (M13 language never appears here). When the
 * DTO's display list is capped, the view says so truthfully instead of
 * implying the unlisted events do not exist.
 */

import type { ProgramCompletionCompletedDto } from '@/application/dto/program-completion';
import { formatHistoryCount, formatHistoryDate } from '@/features/history/history-labels';
import {
  personalBestMetricLabel,
  personalBestValueLabel,
} from '@/features/history/personal-best-view';

/** One PR event of the run, formatted for a single row. */
export interface CompletionRecordEventView {
  /** Stable row identity for the rendered list (capped, static ordering). */
  readonly key: string;
  readonly exerciseName: string;
  /** What the record measures, e.g. "Heaviest load". */
  readonly metricLabel: string;
  /** The record value in its metric's unit, e.g. "82.5 kg". */
  readonly valueLabel: string;
  readonly completedAtLabel: string;
  /** The completed session that holds the event's logged set. */
  readonly sessionHref: string;
}

/** Everything the completion screen renders, derived from one completed DTO. */
export interface ProgramCompletionView {
  readonly programSlug: string;
  readonly programName: string;
  readonly programHref: string;
  readonly catalogHref: string;
  /** The run's workout tally, e.g. "12 of 12". */
  readonly workoutTallyLabel: string;
  /** The run's completion date, e.g. "Feb 15, 2026" (UTC, deterministic). */
  readonly completionDateLabel: string;
  readonly distinctExercises: number;
  /** EXACT event count from the DTO — never the display list's length. */
  readonly recordEventCount: number;
  readonly recordEvents: ReadonlyArray<CompletionRecordEventView>;
  /** "Showing the 5 most recent." when the DTO capped the list, else null. */
  readonly recordEventsNote: string | null;
  /** Exact-count caption for the records section. */
  readonly recordCountCaption: string;
}

/** Maps the authoritative completed-run DTO onto the screen's view model. */
export function buildProgramCompletionView(
  summary: ProgramCompletionCompletedDto,
): ProgramCompletionView {
  const shown = summary.recordEvents.length;

  return {
    programSlug: summary.programSlug,
    programName: summary.programName,
    programHref: `/programs/${summary.programSlug}`,
    catalogHref: '/programs',
    workoutTallyLabel: `${formatHistoryCount(summary.completedWorkouts)} of ${formatHistoryCount(summary.totalWorkouts)}`,
    completionDateLabel: formatHistoryDate(summary.completedAt),
    distinctExercises: summary.distinctExercises,
    recordEventCount: summary.recordEventCount,
    recordEvents: summary.recordEvents.map((event, index) => ({
      key: `${index}-${event.sessionId}-${event.exerciseId}-${event.metric}`,
      exerciseName: event.exerciseName,
      metricLabel: personalBestMetricLabel(event.metric),
      valueLabel: personalBestValueLabel(event),
      completedAtLabel: formatHistoryDate(event.completedAt),
      sessionHref: `/history/sessions/${event.sessionId}`,
    })),
    recordEventsNote:
      summary.recordEventCount > shown
        ? `Showing the ${formatHistoryCount(shown)} most recent.`
        : null,
    recordCountCaption:
      summary.recordEventCount > 0
        ? `${formatHistoryCount(summary.recordEventCount)} during this run — historical records, not current personal bests.`
        : 'No records during this run.',
  };
}