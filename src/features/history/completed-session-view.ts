/**
 * Server-side view assembly for the completed-session detail screen.
 *
 * `toCompletedSessionView` is the pure DTO → view-model mapping; labels are
 * formatted here so the components stay presentational.
 * `buildCompletedSessionView` runs the read use case through the feature
 * composition root.
 *
 * Historical-truth rendering rules (locked):
 * - Set lines render the persisted snapshot ("50 kg × 10"); a logged 0 kg is
 *   a real load and renders as "0 kg × 10"; no external load renders as
 *   "10 reps" — the two are never conflated.
 * - RPE appears only on sets that captured one.
 * - Elapsed time is the wall-clock startedAt → completedAt gap, or omitted
 *   when the timestamps make it non-positive (honest-or-omit).
 * - Entries keep the persisted exercise order; duplicate exercises never
 *   collapse (identity is (sessionId, exerciseOrder), not exercise id).
 * - Current catalog names are display-only; an unresolved exercise falls
 *   back to a positional label instead of hiding the work.
 * - Logged timed work (`totalDurationSeconds`) is never labeled as the
 *   workout's duration.
 */

import type { CompletedSessionDto } from '@/application/dto/completed-session';
import { err, ok, type Result } from '@/domain/types/result';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';
import {
  formatHistoryCount,
  formatHistoryDate,
  formatHistoryElapsed,
  formatHistoryVolume,
  formatSessionSetLine,
} from '@/features/history/history-labels';
import { getCompletedSessionUseCase } from '@/features/history/services';
import { formatPrescription } from '@/features/programs/program-labels';

export interface CompletedSessionSetView {
  readonly setNumber: number;
  readonly valueLabel: string;
}

export interface CompletedSessionEntryView {
  readonly exerciseOrder: number;
  readonly name: string;
  /** `/history/exercises/<slug>` when a valid slug resolved, else null. */
  readonly historyHref: string | null;
  readonly equipmentLabel: string | null;
  readonly prescriptionLabel: string;
  readonly restLabel: string | null;
  readonly sets: ReadonlyArray<CompletedSessionSetView>;
}

export interface CompletedSessionView {
  readonly heading: string;
  readonly contextLabel: string;
  readonly completedAtLabel: string;
  readonly elapsedLabel: string | null;
  /** Joined non-zero metric segments, e.g. "14 sets · 106 reps · 3,510 kg". */
  readonly metricsLineLabel: string;
  readonly entries: ReadonlyArray<CompletedSessionEntryView>;
}

export interface CompletedSessionViewError {
  readonly code: 'INVALID_INPUT' | 'SESSION_NOT_FOUND';
  readonly message: string;
}

/** Route pattern a catalog slug must satisfy before it becomes a link. */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

function toEntryView(
  entry: CompletedSessionDto['entries'][number],
): CompletedSessionEntryView {
  return {
    exerciseOrder: entry.exerciseOrder,
    name: entry.exerciseName ?? `Exercise ${entry.exerciseOrder}`,
    // The slug is current catalog data, not the persisted record — only a
    // structurally valid slug links out; anything else renders as plain
    // text instead of a broken URL.
    historyHref:
      entry.exerciseSlug !== null && SLUG_PATTERN.test(entry.exerciseSlug)
        ? `/history/exercises/${entry.exerciseSlug}`
        : null,
    equipmentLabel: entry.equipment === null ? null : EQUIPMENT_LABELS[entry.equipment],
    prescriptionLabel: formatPrescription(entry.prescription),
    restLabel: entry.restSeconds > 0 ? `${entry.restSeconds}s rest` : null,
    sets: entry.sets.map((set) => ({
      setNumber: set.setNumber,
      valueLabel: formatSessionSetLine(set),
    })),
  };
}

/** Pure DTO → view-model mapping; entry and set order preserved as persisted. */
export function toCompletedSessionView(session: CompletedSessionDto): CompletedSessionView {
  const elapsedSeconds = Math.floor(
    (Date.parse(session.completedAt) - Date.parse(session.startedAt)) / 1000,
  );
  const metrics = session.metrics;
  const metricSegments = [
    `${formatHistoryCount(metrics.totalSets)} ${metrics.totalSets === 1 ? 'set' : 'sets'}`,
    metrics.totalReps > 0 ? `${formatHistoryCount(metrics.totalReps)} reps` : null,
    metrics.volume > 0 ? formatHistoryVolume(metrics.volume) : null,
  ].filter((segment): segment is string => segment !== null);

  return {
    heading: session.workoutName,
    contextLabel: session.programName,
    completedAtLabel: formatHistoryDate(session.completedAt),
    elapsedLabel: elapsedSeconds > 0 ? formatHistoryElapsed(elapsedSeconds) : null,
    metricsLineLabel: metricSegments.join(' · '),
    entries: session.entries.map(toEntryView),
  };
}

/**
 * Builds the detail view for one authenticated user's completed session.
 * SESSION_NOT_FOUND covers a missing, foreign, or in-progress session —
 * the route renders 404 without revealing which.
 */
export async function buildCompletedSessionView(
  userId: string,
  sessionId: string,
): Promise<Result<CompletedSessionView, CompletedSessionViewError>> {
  const result = await getCompletedSessionUseCase.execute({ userId, sessionId });
  if (!result.ok) {
    return err({ code: result.error.code, message: result.error.message });
  }
  return ok(toCompletedSessionView(result.data));
}
