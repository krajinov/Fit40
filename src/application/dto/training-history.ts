/**
 * Data transfer objects and boundary helpers for the user's training history.
 *
 * The history DTOs are plain, serializable shapes for Server Components:
 * branded IDs are stripped to plain strings, Date objects to ISO 8601
 * strings. Because history is completed-only by definition, `completedAt` is
 * a non-null ISO string here — the aggregate's `Date | null` is narrowed at
 * the repository boundary, not propagated.
 *
 * This module also owns the pagination boundary helpers:
 * - the opaque, versioned cursor codec (encode/decode), and
 * - page-size normalization (default 20, clamped to 1–50).
 * Both are pure functions so they stay unit-testable without a repository.
 */

import type {
  WorkoutSessionExerciseDto,
  WorkoutSessionMetricsDto,
} from '@/application/dto/workout-session';
import { serializeSetLog } from '@/application/dto/workout-session';
import type {
  TrainingHistoryCursor,
  TrainingHistoryEntry,
} from '@/application/ports/training-history-repository';
import { calculateSessionMetrics } from '@/domain/services/session-metrics';
import { createWorkoutSessionId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';

// ─── Page size ───────────────────────────────────────────────────────────────

export const DEFAULT_TRAINING_HISTORY_PAGE_SIZE = 20;
export const MIN_TRAINING_HISTORY_PAGE_SIZE = 1;
export const MAX_TRAINING_HISTORY_PAGE_SIZE = 50;

/** Why a requested page size was rejected (surfaced as INVALID_INPUT upstream). */
export interface TrainingHistoryLimitError {
  readonly message: string;
  readonly field: 'limit';
}

/**
 * Normalizes a requested page size: `undefined` becomes the default, integer
 * values outside 1–50 are clamped into range, and non-integers (NaN,
 * Infinity, fractions) are rejected — silently flooring or clamping a
 * non-number would produce broken pages.
 */
export function resolveTrainingHistoryLimit(
  limit: number | undefined,
): Result<number, TrainingHistoryLimitError> {
  if (limit === undefined) {
    return ok(DEFAULT_TRAINING_HISTORY_PAGE_SIZE);
  }
  if (!Number.isInteger(limit)) {
    return err({
      field: 'limit',
      message: `Page size must be an integer between ${MIN_TRAINING_HISTORY_PAGE_SIZE} and ${MAX_TRAINING_HISTORY_PAGE_SIZE}`,
    });
  }
  return ok(
    Math.min(
      MAX_TRAINING_HISTORY_PAGE_SIZE,
      Math.max(MIN_TRAINING_HISTORY_PAGE_SIZE, limit),
    ),
  );
}

// ─── Cursor codec ────────────────────────────────────────────────────────────

/**
 * Cursor format version. Bumping it lets the payload evolve without turning
 * existing tokens into hard failures mid-deploy (old versions can be
 * rejected cleanly as stale instead of misparsed).
 */
const TRAINING_HISTORY_CURSOR_VERSION = 1;

/** Wire shape of a v1 cursor payload: dates as ISO strings, ids as strings. */
interface TrainingHistoryCursorPayload {
  readonly v: number;
  readonly c: string;
  readonly s: string;
  readonly i: string;
}

/** Why a cursor token failed to decode (surfaced as INVALID_INPUT upstream). */
export interface TrainingHistoryCursorError {
  readonly message: string;
}

/**
 * Encodes a keyset position into the opaque base64url token handed to
 * clients. The token is versioned and structured (not a positional pipe
 * token), so future payload changes stay decidable, and clients must treat
 * it as opaque.
 */
export function encodeTrainingHistoryCursor(cursor: TrainingHistoryCursor): string {
  const payload: TrainingHistoryCursorPayload = {
    v: TRAINING_HISTORY_CURSOR_VERSION,
    c: cursor.completedAt.toISOString(),
    s: cursor.startedAt.toISOString(),
    i: cursor.sessionId,
  };
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decodes a cursor token back into its keyset position. Any tampered,
 * truncated, or foreign token fails with typed error data — never an
 * exception and never a silently misparsed position.
 */
export function decodeTrainingHistoryCursor(
  token: string,
): Result<TrainingHistoryCursor, TrainingHistoryCursorError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(token, 'base64url').toString('utf8'));
  } catch {
    return err({ message: 'Training history cursor is not valid base64url-encoded JSON' });
  }

  const payload = asCursorPayload(parsed);
  if (payload === null) {
    return err({
      message: 'Training history cursor payload has an unsupported or invalid structure',
    });
  }

  const completedAt = parseCursorTimestamp(payload.c, 'completedAt');
  if (!completedAt.ok) {
    return completedAt;
  }
  const startedAt = parseCursorTimestamp(payload.s, 'startedAt');
  if (!startedAt.ok) {
    return startedAt;
  }
  const sessionId = createWorkoutSessionId(payload.i);
  if (!sessionId.ok) {
    return err({ message: 'Training history cursor session id must be a non-empty string' });
  }

  return ok({
    completedAt: completedAt.data,
    startedAt: startedAt.data,
    sessionId: sessionId.data,
  });
}

/**
 * Narrows a parsed JSON value to a known-version cursor payload, or null.
 *
 * The one cast below is necessary to destructure the unknown JSON object; a
 * fresh, fully validated object is returned, so no unvalidated value escapes
 * this function. Unknown versions are rejected cleanly (stale tokens after
 * a format change), never misparsed.
 */
function asCursorPayload(value: unknown): TrainingHistoryCursorPayload | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const { v: version, c: completedAt, s: startedAt, i: sessionId } = value as Record<
    string,
    unknown
  >;
  if (typeof version !== 'number' || version !== TRAINING_HISTORY_CURSOR_VERSION) {
    return null;
  }
  if (
    typeof completedAt !== 'string' ||
    completedAt.length === 0 ||
    typeof startedAt !== 'string' ||
    startedAt.length === 0 ||
    typeof sessionId !== 'string' ||
    sessionId.length === 0
  ) {
    return null;
  }
  return { v: version, c: completedAt, s: startedAt, i: sessionId };
}

function parseCursorTimestamp(
  iso: string,
  field: string,
): Result<Date, TrainingHistoryCursorError> {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return err({
      message: `Training history cursor field "${field}" is not a valid timestamp`,
    });
  }
  return ok(date);
}

// ─── DTOs ────────────────────────────────────────────────────────────────────

/** One completed session in the history list. */
export interface TrainingHistorySessionDto {
  readonly sessionId: string;
  readonly scheduledWorkoutId: string;
  readonly workoutId: string;
  readonly workoutName: string;
  readonly programName: string;
  readonly startedAt: string;
  /** ISO 8601 — non-null: history contains only completed sessions. */
  readonly completedAt: string;
  readonly exerciseLogs: ReadonlyArray<WorkoutSessionExerciseDto>;
  readonly metrics: WorkoutSessionMetricsDto;
}

/** One page of history plus the opaque cursor resuming after it, if any. */
export interface TrainingHistoryPageDto {
  readonly sessions: ReadonlyArray<TrainingHistorySessionDto>;
  readonly nextCursor: string | null;
}

/** Lifetime training totals of the user. */
export interface TrainingTotalsDto {
  readonly completedSessions: number;
  readonly loggedSets: number;
}

/**
 * Maps a history entry to its serializable DTO. Metrics are computed here in
 * the application layer via the domain service — never in SQL.
 */
export function toTrainingHistorySessionDto(
  entry: TrainingHistoryEntry,
): TrainingHistorySessionDto {
  return {
    sessionId: entry.session.id,
    scheduledWorkoutId: entry.session.scheduledWorkoutId,
    workoutId: entry.session.workoutId,
    workoutName: entry.workoutName,
    programName: entry.programName,
    startedAt: entry.session.startedAt.toISOString(),
    completedAt: entry.session.completedAt.toISOString(),
    exerciseLogs: entry.session.exerciseLogs.map((log) => ({
      exerciseId: log.exerciseId,
      order: log.order,
      prescription: log.prescription,
      sets: log.sets.map(serializeSetLog),
    })),
    metrics: calculateSessionMetrics(entry.session),
  };
}

