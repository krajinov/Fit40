/**
 * Personal-record metric vocabulary and the primitives every M12 record
 * computation is built from.
 *
 * M12 derives Personal Records from COMPLETED exercise performance history.
 * The taxonomy is closed and deliberately small — three metrics — and each
 * metric is defined on individual LOGGED SETS:
 *
 * - `max-load`            — a rep set with `weightKg !== null`. `0 kg` is a
 *                           real external load and IS eligible; `null` means
 *                           bodyweight work and is NOT.
 * - `max-bodyweight-reps` — a rep set with `weightKg === null`. Externally
 *                           loaded sets never compete in this metric.
 * - `max-duration`        — a duration set; its value is the logged seconds.
 *                           A duration set's load is irrelevant to records
 *                           and never creates a load record.
 *
 * Every logged set is therefore eligible for exactly one metric: a mutually
 * exclusive, total mapping with no "ineligible set" case. Consequences that
 * are locked product semantics, not accidents:
 *
 * - a `0` kg load record is a truthful first exposure to added load, never a
 *   missing value (never treated as absent/falsy);
 * - skipped and zero-set occurrences contribute nothing because they contain
 *   no logged sets at all — no "record denied" state is invented;
 * - attribution always uses the occurrence's PERFORMED exercise id, so
 *   substitution, user-added provenance and reordering never change which
 *   exercise a record belongs to.
 *
 * The session-level extraction and the chronological fold (`personal-records.ts`)
 * both consume these primitives, so metric eligibility, value extraction and
 * the strict comparison rule cannot drift into two implementations. This
 * module contains no persistence vocabulary, no formatting and no UI concerns.
 */

import type { SetLog } from '@/domain/entities/workout-session';
import type { ExerciseId, WorkoutSessionId } from '@/domain/types/ids';

// ─── Metric taxonomy ─────────────────────────────────────────────────────────

/**
 * The closed M12 record taxonomy. A const object with a derived union — the
 * repository's enum convention (`OccurrenceSource`), not TypeScript `enum`.
 */
export const RecordMetric = {
  /** Heaviest single externally loaded rep set (kilograms). */
  MaxLoad: 'max-load',
  /** Most reps in a single unloaded (bodyweight) rep set. */
  MaxBodyweightReps: 'max-bodyweight-reps',
  /** Longest single duration set (seconds). */
  MaxDuration: 'max-duration',
} as const;

export type RecordMetric = (typeof RecordMetric)[keyof typeof RecordMetric];

export const RECORD_METRIC_VALUES = Object.values(RecordMetric) as ReadonlyArray<RecordMetric>;

// ─── Positions & candidates ──────────────────────────────────────────────────

/**
 * The deterministic chronological position of one logged performance.
 *
 * The five fields are the approved total-order ladder — `completedAt`,
 * `startedAt`, `sessionId`, `exerciseOrder`, `setNumber`. The last two keep
 * two occurrences of the same exercise inside one session distinguishable,
 * and the whole ladder makes the order total even when timestamps tie.
 */
export interface PerformancePosition {
  readonly completedAt: Date;
  readonly startedAt: Date;
  readonly sessionId: WorkoutSessionId;
  readonly exerciseOrder: number;
  readonly setNumber: number;
}

/**
 * One eligible (exercise, metric, value) fact extracted from a logged set.
 * `value` is in the metric's own unit — kilograms, reps or seconds — and is
 * never formatted here.
 */
export interface RecordCandidate {
  /** The PERFORMED exercise id (`ExerciseLog.performedExerciseId`). */
  readonly exerciseId: ExerciseId;
  readonly metric: RecordMetric;
  readonly value: number;
  readonly position: PerformancePosition;
}

// ─── Primitives ──────────────────────────────────────────────────────────────

/**
 * Maps one logged set to its single eligible record candidate. Deliberately
 * total: every set shape is eligible for exactly one metric, so eligibility
 * lives in one place and no caller re-derives it.
 */
export function toRecordCandidate(
  exerciseId: ExerciseId,
  set: SetLog,
  position: PerformancePosition,
): RecordCandidate {
  if (set.type === 'duration') {
    return { exerciseId, metric: RecordMetric.MaxDuration, value: set.durationSeconds, position };
  }

  return set.weightKg === null
    ? { exerciseId, metric: RecordMetric.MaxBodyweightReps, value: set.reps, position }
    : { exerciseId, metric: RecordMetric.MaxLoad, value: set.weightKg, position };
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * Total ordering of two positions by the approved ladder, oldest first.
 * Dates are compared numerically (`getTime()`), never lexically.
 */
export function comparePerformancePositions(
  a: PerformancePosition,
  b: PerformancePosition,
): number {
  return (
    a.completedAt.getTime() - b.completedAt.getTime() ||
    a.startedAt.getTime() - b.startedAt.getTime() ||
    compareStrings(a.sessionId, b.sessionId) ||
    a.exerciseOrder - b.exerciseOrder ||
    a.setNumber - b.setNumber
  );
}

/**
 * The single strict-comparison rule of M12: a performance establishes a
 * record only when it STRICTLY exceeds the best value before it. `null` means
 * no eligible performance preceded it, so a first exposure is always a
 * record. Equal values never establish a new record — the earliest
 * performance keeps ownership. Compared exactly, with no epsilon/fuzzy
 * tolerance.
 */
export function establishesPersonalRecord(value: number, bestBefore: number | null): boolean {
  return bestBefore === null || value > bestBefore;
}
