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
 * - The PERFORMED exercise is each entry's primary identity; a substituted
 *   occurrence adds the subtle "Originally: …" authored-exercise context,
 *   omitted when the authored metadata is unavailable — never fabricated.
 * - A SKIPPED occurrence renders a neutral "Skipped" state: no
 *   performance-history link, no set rows, no fabricated performance. The
 *   persisted isSkipped flag is authoritative — zero logged sets never
 *   implies skipped. A substituted-then-skipped occurrence keeps "Originally:
 *   …" without implying the replacement was performed.
 * - Current catalog names are display-only; an unresolved exercise falls
 *   back to a positional label instead of hiding the work.
 * - Logged timed work (`totalDurationSeconds`) is never labeled as the
 *   workout's duration.
 * - Historical personal records (M12 Slice 4) are the resolved record events
 *   of THIS session attached to the exact `(exerciseOrder, setNumber)` that
 *   produced them — the exact set gets the indicator, its equal sibling does
 *   not, and duplicate occurrences stay distinct. The state is consumed, never
 *   derived: no value comparisons and no current-PB consultation happen here.
 * - `hasPersonalRecords` reports whether any badge actually renders, so the
 *   screen's legend appears exactly when a badge is on screen — a resolved
 *   event attached to nothing visible (a skipped occurrence) never triggers
 *   it.
 */

import type { CompletedSessionDto } from '@/application/dto/completed-session';
import type { SessionRecordEventDto } from '@/application/dto/personal-records';
import { err, ok, type Result } from '@/domain/types/result';
import { EQUIPMENT_LABELS } from '@/features/exercises/exercise-labels';
import { resolveOccurrenceProvenanceLabel } from '@/features/sessions/session-provenance-views';
import {
  formatHistoryCount,
  formatHistoryDate,
  formatHistoryElapsed,
  formatHistoryVolume,
  formatSessionSetLine,
} from '@/features/history/history-labels';
import {
  getCompletedSessionRecordEventsUseCase,
  getCompletedSessionUseCase,
} from '@/features/history/services';
import { formatPrescription } from '@/features/programs/program-labels';

export interface CompletedSessionSetView {
  readonly setNumber: number;
  readonly valueLabel: string;
  /**
   * True when this exact logged set established a historical personal record
   * (M12 Slice 4): the set's value strictly exceeded the best eligible value
   * before it, or it was the first eligible exposure. The state arrives fully
   * resolved from the application layer — the view never compares values,
   * inspects earlier sessions, or consults today's personal bests.
   */
  readonly isPersonalRecord: boolean;
}

export interface CompletedSessionEntryView {
  readonly exerciseOrder: number;
  readonly name: string;
  /**
   * The AUTHORED exercise's name, rendered as the subtle "Originally: …"
   * context line when the occurrence was substituted; null when not
   * substituted or when the authored exercise no longer resolves in the
   * catalog — never fabricated. The PERFORMED name stays the primary
   * identity, and history stays read-only (no substitution controls).
   */
  readonly originallyName: string | null;
  /**
   * Provenance label for a session-added occurrence ("Added during workout"),
   * or null for a template-authored one (M11). Derived ONLY from the persisted
   * `source` through the shared `session-provenance-views` helper — never from
   * order, identity, substitution state or history position. A user-added
   * occurrence keeps the label after completion, including when it is
   * substituted and/or skipped.
   */
  readonly provenanceLabel: string | null;
  /** `/history/exercises/<slug>` when a valid slug resolved, else null. */
  readonly historyHref: string | null;
  /**
   * The persisted skip decision for this occurrence (M10). Explicit DTO
   * state — never inferred from zero logged sets. A skipped occurrence
   * renders the neutral Skipped state with no history link and no set rows.
   */
  readonly isSkipped: boolean;
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
  /**
   * True when at least one RENDERED set carries the historical record
   * indicator, i.e. when a PR badge is actually on screen. A resolved event
   * that never reaches a rendered set row (a skipped occurrence, or a set the
   * session no longer holds) does not count, so the screen never explains a
   * badge it does not show. Presentational only: it decides the legend, never
   * the badges themselves.
   */
  readonly hasPersonalRecords: boolean;
}

export interface CompletedSessionViewError {
  readonly code: 'INVALID_INPUT' | 'SESSION_NOT_FOUND';
  readonly message: string;
}

/**
 * Route pattern a catalog slug must satisfy before it becomes a link.
 */
const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/;

/**
 * The lookup key of one logged set: `(exerciseOrder, setNumber)`. It is the
 * set-log primary key, so it stays unique within a session even when the same
 * exercise occurs twice (different exercise orders) or when one occurrence
 * logs several sets.
 */
function setKey(exerciseOrder: number, setNumber: number): string {
  return `${exerciseOrder}#${setNumber}`;
}

/** Indexes the resolved events by their exact (exerciseOrder, setNumber) set. */
function recordEventKeys(
  recordEvents: ReadonlyArray<SessionRecordEventDto>,
): ReadonlySet<string> {
  return new Set(
    recordEvents.map((event) => setKey(event.exerciseOrder, event.setNumber)),
  );
}

function toEntryView(
  entry: CompletedSessionDto['entries'][number],
  recordKeys: ReadonlySet<string>,
): CompletedSessionEntryView {
  return {
    exerciseOrder: entry.exerciseOrder,
    name: entry.exerciseName ?? `Exercise ${entry.exerciseOrder}`,
    // Substitution context (M9): the PERFORMED exercise is the primary
    // identity; the authored name is subtle context only when the domain
    // says this occurrence is substituted AND the catalog resolves the
    // authored exercise. A chained substitution still names the ORIGINAL
    // authored exercise — authoredExerciseId is never rewritten.
    originallyName:
      entry.isSubstituted && entry.authoredExerciseName !== null
        ? entry.authoredExerciseName
        : null,
    // Provenance (M11) rides the SAME pure helper Active Workout uses, so the
    // label has exactly one source-to-label mapping. `source` is the only
    // input; template occurrences render nothing.
    provenanceLabel: resolveOccurrenceProvenanceLabel(entry.source),
    // A skipped occurrence (M10) never links into per-exercise performance
    // history: it carries zero set logs and is intentionally excluded there.
    historyHref:
      !entry.isSkipped &&
      entry.exerciseSlug !== null &&
      SLUG_PATTERN.test(entry.exerciseSlug)
        ? `/history/exercises/${entry.exerciseSlug}`
        : null,
    // Explicit persisted skip state — never inferred from zero logged sets.
    isSkipped: entry.isSkipped,
    equipmentLabel: entry.equipment === null ? null : EQUIPMENT_LABELS[entry.equipment],
    prescriptionLabel: formatPrescription(entry.prescription),
    restLabel: entry.restSeconds > 0 ? `${entry.restSeconds}s rest` : null,
    sets: entry.sets.map((set) => ({
      setNumber: set.setNumber,
      valueLabel: formatSessionSetLine(set),
      // The exact set's own event — never the occurrence's, and never a value
      // comparison: the resolved event list is the only authority here.
      isPersonalRecord: recordKeys.has(setKey(entry.exerciseOrder, set.setNumber)),
    })),
  };
}

/**
 * Pure DTO → view-model mapping; entry and set order preserved as persisted.
 *
 * `recordEvents` are the session's already-resolved historical record events
 * (M12 Slice 4): each is attached to the exact `(exerciseOrder, setNumber)` set
 * that produced it, so one PR inside an occurrence badges one row — never the
 * whole occurrence — and an empty list is simply "no records in this session".
 * A skipped occurrence carries no set rows, so it can never receive an
 * indicator.
 */
export function toCompletedSessionView(
  session: CompletedSessionDto,
  recordEvents: ReadonlyArray<SessionRecordEventDto>,
): CompletedSessionView {
  const recordKeys = recordEventKeys(recordEvents);
  const elapsedSeconds = Math.floor(
    (Date.parse(session.completedAt) - Date.parse(session.startedAt)) / 1000,
  );
  const metrics = session.metrics;
  const metricSegments = [
    `${formatHistoryCount(metrics.totalSets)} ${metrics.totalSets === 1 ? 'set' : 'sets'}`,
    metrics.totalReps > 0 ? `${formatHistoryCount(metrics.totalReps)} reps` : null,
    metrics.volume > 0 ? formatHistoryVolume(metrics.volume) : null,
  ].filter((segment): segment is string => segment !== null);
  const entries = session.entries.map((entry) => toEntryView(entry, recordKeys));

  return {
    heading: session.workoutName,
    contextLabel: session.programName,
    completedAtLabel: formatHistoryDate(session.completedAt),
    elapsedLabel: elapsedSeconds > 0 ? formatHistoryElapsed(elapsedSeconds) : null,
    metricsLineLabel: metricSegments.join(' · '),
    entries,
    // Counted from the built entries, so it can only ever describe badges that
    // really render — never the raw event list.
    hasPersonalRecords: entries.some((entry) =>
      entry.sets.some((set) => set.isPersonalRecord),
    ),
  };
}

/**
 * Builds the detail view for one authenticated user's completed session.
 * SESSION_NOT_FOUND covers a missing, foreign, or in-progress session — the
 * route renders 404 without revealing which.
 *
 * The session's core read and its historical record events are independent
 * reads of the same completed session, so they run concurrently and only then
 * merge into one view; both share the single-outcome SESSION_NOT_FOUND
 * contract, so a session that disappears between them is still just a 404.
 * Record semantics never enter the core completed-session read path.
 */
export async function buildCompletedSessionView(
  userId: string,
  sessionId: string,
): Promise<Result<CompletedSessionView, CompletedSessionViewError>> {
  const [sessionResult, recordEventsResult] = await Promise.all([
    getCompletedSessionUseCase.execute({ userId, sessionId }),
    getCompletedSessionRecordEventsUseCase.execute({ userId, sessionId }),
  ]);

  if (!sessionResult.ok) {
    return err({ code: sessionResult.error.code, message: sessionResult.error.message });
  }
  if (!recordEventsResult.ok) {
    return err({
      code: recordEventsResult.error.code,
      message: recordEventsResult.error.message,
    });
  }

  return ok(toCompletedSessionView(sessionResult.data, recordEventsResult.data));
}
