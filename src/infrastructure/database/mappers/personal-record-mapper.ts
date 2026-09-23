import type { RecordCandidate, RecordMetric } from '@/domain/services/personal-record-metrics';
import { RECORD_METRIC_VALUES } from '@/domain/services/personal-record-metrics';
import type { CandidatePriorBest, PersonalBest } from '@/domain/services/personal-records';

import { parseExerciseId, parseWorkoutSessionId } from './session-mapper';

/**
 * Row mapping for the Personal Records read model.
 *
 * The SQL side projects exactly two shapes — the winning set of one
 * (exercise, metric) pair, and the ordinal-keyed prior best of one candidate —
 * and this module turns them into the Domain's own `PersonalBest` /
 * `CandidatePriorBest` vocabulary. Value conversion is deliberately explicit:
 * `set_logs.weight_kg` is `numeric(6,2)` (a real external load, so `0` stays
 * `0`) and `set_logs.reps` / `set_logs.duration_seconds` are integers, while
 * the driver may hand back either a number or a decimal string depending on
 * the column type. Nothing here re-derives eligibility, strictness, or
 * ownership — impossible persisted shapes throw, exactly like the other
 * mappers.
 */

/** One row of the ranked current-best query: the winning set of one pair. */
export interface RecordBestRow {
  readonly exerciseId: string;
  /** `RecordMetric` value, validated on mapping (closed vocabulary). */
  readonly metric: string;
  readonly value: unknown;
  /** Nullable in the schema; non-null by the completed-only filter. */
  readonly completedAt: Date | null;
  readonly startedAt: Date;
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly setNumber: number;
}

/** One row of the batched best-before query: a candidate ordinal + its best. */
export interface PriorBestRow {
  /** Position of the candidate in the caller's input array. */
  readonly ord: number;
  /** Null when no eligible performance precedes the candidate. */
  readonly bestBefore: unknown;
}

/**
 * Validates a persisted metric against the closed M12 vocabulary. An unknown
 * value is corrupt data (unreachable through normal writes — the value is
 * projected from `set_logs.type` and `set_logs.weight_kg`).
 */
function parseRecordMetric(value: string, context: string): RecordMetric {
  const metric = RECORD_METRIC_VALUES.find((known) => known === value);
  if (metric === undefined) {
    throw new Error(`Corrupt data in ${context}: unknown record metric "${value}"`);
  }
  return metric;
}

/**
 * Converts a persisted record value to its number, preserving `0` (a truthful
 * external load) and never falling back to a default: the field is non-null
 * for every eligible row, so anything unconvertible is corrupt data.
 */
function toRecordValue(value: unknown, context: string): number {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }
  throw new Error(`Corrupt data in ${context}: expected a numeric record value, got ${String(value)}`);
}

/**
 * Maps the ranked query's winning rows to the Domain's `PersonalBest`,
 * preserving the query's deterministic (exercise id, metric) ordering.
 */
export function mapCurrentPersonalBests(
  rows: ReadonlyArray<RecordBestRow>,
): ReadonlyArray<PersonalBest> {
  return rows.map((row) => {
    const context = `personal record best (exercise_id=${row.exerciseId}, metric=${row.metric})`;
    if (row.completedAt === null) {
      throw new Error(
        `Corrupt data in ${context}: completed_at is null despite the completed-only filter`,
      );
    }
    return {
      exerciseId: parseExerciseId(row.exerciseId, context),
      metric: parseRecordMetric(row.metric, context),
      value: toRecordValue(row.value, context),
      position: {
        completedAt: row.completedAt,
        startedAt: row.startedAt,
        sessionId: parseWorkoutSessionId(row.sessionId, context),
        exerciseOrder: row.exerciseOrder,
        setNumber: row.setNumber,
      },
    };
  });
}

/**
 * Maps the batched best-before rows back onto the caller's candidates.
 *
 * Correspondence travels by the candidate's ordinal, so candidates that share
 * exercise, metric, value and timestamps still receive their own result, and
 * the returned array is positionally aligned with the input. A missing ordinal
 * (the projection emits exactly one row per candidate) is corrupt data.
 */
export function mapBestValuesBefore(
  rows: ReadonlyArray<PriorBestRow>,
  candidates: ReadonlyArray<RecordCandidate>,
): ReadonlyArray<CandidatePriorBest> {
  const byOrdinal = new Map<number, number | null>();
  for (const row of rows) {
    if (!Number.isInteger(row.ord) || row.ord < 0 || row.ord >= candidates.length) {
      throw new Error(
        `Corrupt data in personal record best-before result: candidate ordinal ${String(row.ord)} is out of range`,
      );
    }
    if (byOrdinal.has(row.ord)) {
      throw new Error(
        `Corrupt data in personal record best-before result: duplicate candidate ordinal ${row.ord}`,
      );
    }
    byOrdinal.set(
      row.ord,
      row.bestBefore === null
        ? null
        : toRecordValue(row.bestBefore, `personal record best-before (ordinal ${row.ord})`),
    );
  }

  return candidates.map((candidate, ord) => {
    const bestBefore = byOrdinal.get(ord);
    if (bestBefore === undefined) {
      throw new Error(
        `Corrupt data in personal record best-before result: no result for candidate ordinal ${ord}`,
      );
    }
    return { candidate, bestBefore };
  });
}
