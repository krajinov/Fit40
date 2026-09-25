/**
 * Serializable DTOs for the M14 program completion summary read model.
 *
 * One truthful summary of the user's CURRENT completed program run: program
 * identity, the run's workout tally, the run's completion instant, how many
 * distinct exercises were actually trained, and the run's HISTORICAL
 * personal-record events (M12 semantics: what was a record at that point in
 * history, not what still stands today).
 *
 * Deliberately absent — locked M14 non-goals: elapsed/training time, calories,
 * e1RM, readiness/recovery, adherence percentages, streaks/XP, AI analysis,
 * and any "current still-standing PB" count presented as historical events.
 *
 * `recordEventCount` is EXACT (every resolved event of the run) while
 * `recordEvents` is a display list capped at
 * {@link PROGRAM_COMPLETION_RECORD_EVENT_LIMIT} newest events — the cap never
 * rewrites the count. An event whose catalog identity cannot be resolved is
 * omitted from the list (never placeholder-named) and does not change the
 * count.
 */

import type { ExerciseSummaryDto } from '@/application/dto/exercise';
import type { PersonalRecordMetricDto } from '@/application/dto/personal-records';
import { comparePerformancePositions } from '@/domain/services/personal-record-metrics';
import type { RecordEvent } from '@/domain/services/personal-records';

/** How many newest events the display list carries (the exact count is unaffected). */
export const PROGRAM_COMPLETION_RECORD_EVENT_LIMIT = 5;

/** One historical record event of the run, with the catalog identity to name it. */
export interface ProgramCompletionRecordEventDto {
  readonly exerciseId: string;
  readonly exerciseName: string;
  readonly exerciseSlug: string;
  readonly metric: PersonalRecordMetricDto;
  /** The record value in the metric's own unit: kilograms, reps or seconds. */
  readonly value: number;
  /** The best eligible value strictly before the event, or null for a first exposure. */
  readonly previousBest: number | null;
  /** The completed session holding the event's logged set. */
  readonly sessionId: string;
  /** ISO 8601 — non-null: events come from completed sessions only. */
  readonly completedAt: string;
}

/** The current enrollment exists, but its program run is not complete yet. */
export interface ProgramCompletionIncompleteDto {
  readonly status: 'incomplete';
  readonly completedWorkouts: number;
  readonly totalWorkouts: number;
}

/** The current enrollment's program run is authoritatively complete. */
export interface ProgramCompletionCompletedDto {
  readonly status: 'completed';
  readonly programName: string;
  readonly programSlug: string;
  readonly completedWorkouts: number;
  readonly totalWorkouts: number;
  /** ISO 8601 — the run's latest completion among its own completed sessions. */
  readonly completedAt: string;
  /**
   * Distinct exercises actually trained in this run: performed exercise ids of
   * occurrences with at least one logged set (M12's "no logged sets, no
   * contribution" rule), so a substituted replacement counts as performed,
   * user-added occurrences participate, and skipped/set-less occurrences do
   * not.
   */
  readonly distinctExercises: number;
  /** EXACT number of historical PR events in this run — never capped. */
  readonly recordEventCount: number;
  /** At most {@link PROGRAM_COMPLETION_RECORD_EVENT_LIMIT} newest events, newest first. */
  readonly recordEvents: ReadonlyArray<ProgramCompletionRecordEventDto>;
}

/** Discriminated summary: incomplete run, or the authoritative completed run. */
export type ProgramCompletionSummaryDto =
  | ProgramCompletionIncompleteDto
  | ProgramCompletionCompletedDto;

/**
 * The newest events by the M12 `PerformancePosition` ladder — reverse
 * chronological (`completedAt`, `startedAt`, `sessionId`, `exerciseOrder`,
 * `setNumber`) — never array insertion order and never a date-only sort. The
 * exact event set is untouched: the display cap applies only after it is known.
 */
export function selectNewestRecordEvents(
  events: ReadonlyArray<RecordEvent>,
): ReadonlyArray<RecordEvent> {
  return [...events]
    .sort((a, b) => comparePerformancePositions(b.position, a.position))
    .slice(0, PROGRAM_COMPLETION_RECORD_EVENT_LIMIT);
}

/** Everything the completed-summary mapper needs; every fact already read. */
export interface ProgramCompletionCompletedInput {
  readonly programName: string;
  readonly programSlug: string;
  readonly completedWorkouts: number;
  readonly totalWorkouts: number;
  readonly completedAt: Date;
  readonly distinctExercises: number;
  /** Every resolved historical event of the run (exact, uncapped). */
  readonly recordEvents: ReadonlyArray<RecordEvent>;
  /** Catalog summaries for the display candidates; unresolved ids are absent. */
  readonly exercises: ReadonlyArray<ExerciseSummaryDto>;
}

/**
 * Maps the completed run's facts onto the wire DTO. Pure: no repository, no
 * clock, no re-ranking — the exact count comes from the full event set and the
 * display list from {@link selectNewestRecordEvents}.
 */
export function toProgramCompletionCompletedDto(
  input: ProgramCompletionCompletedInput,
): ProgramCompletionCompletedDto {
  const exercisesById = new Map(input.exercises.map((exercise) => [exercise.id, exercise]));

  const recordEvents: ProgramCompletionRecordEventDto[] = [];
  for (const event of selectNewestRecordEvents(input.recordEvents)) {
    const exercise = exercisesById.get(event.exerciseId);
    // Missing catalog metadata never rewrites historical truth: the row is
    // omitted from the display list, and the exact count below is unaffected.
    if (exercise === undefined) continue;
    recordEvents.push({
      exerciseId: event.exerciseId,
      exerciseName: exercise.name,
      exerciseSlug: exercise.slug,
      metric: event.metric,
      value: event.value,
      previousBest: event.previousBest,
      sessionId: event.position.sessionId,
      completedAt: event.position.completedAt.toISOString(),
    });
  }

  return {
    status: 'completed',
    programName: input.programName,
    programSlug: input.programSlug,
    completedWorkouts: input.completedWorkouts,
    totalWorkouts: input.totalWorkouts,
    completedAt: input.completedAt.toISOString(),
    distinctExercises: input.distinctExercises,
    recordEventCount: input.recordEvents.length,
    recordEvents,
  };
}
