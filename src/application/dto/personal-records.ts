/**
 * Serializable DTOs for the M12 Personal Records read model.
 *
 * Self-contained wire contract for records, mirroring the other boundary DTO
 * modules: the domain's `PersonalBest` is flattened into plain, serializable
 * fields (branded ids → strings, `Date` → ISO 8601) for Server Components.
 *
 * Records are derived from COMPLETED history only, so `completedAt` is a
 * non-null ISO string here — the repository narrows the position's `Date` at
 * its own boundary and this module keeps that guarantee.
 *
 * The DTO carries no formatted strings and no unit field: `metric` already
 * determines the unit (kilograms, reps, seconds), and mapping metric → label
 * and value → text belongs to presentation.
 */

import type { PersonalBest } from '@/domain/services/personal-records';

/**
 * The closed M12 record taxonomy as it crosses the boundary. Structurally the
 * domain's `RecordMetric` union — spelled out here so the wire contract is
 * readable (and stable) without domain vocabulary leaking to consumers.
 */
export type PersonalRecordMetricDto = 'max-load' | 'max-bodyweight-reps' | 'max-duration';

/**
 * One current all-time personal best, carrying the exact owning performance.
 *
 * `sessionId`/`exerciseOrder`/`setNumber` locate the winning logged set, so
 * presentation can link to the session that actually holds the record — never
 * to a later session that merely repeated the value.
 */
export interface PersonalBestDto {
  readonly exerciseId: string;
  readonly metric: PersonalRecordMetricDto;
  /** The winning value in the metric's own unit: kilograms, reps or seconds. */
  readonly value: number;
  readonly sessionId: string;
  readonly exerciseOrder: number;
  readonly setNumber: number;
  /** ISO 8601 — non-null: records come from completed sessions only. */
  readonly completedAt: string;
}

/**
 * Maps the domain's record to its serializable DTO. The value crosses
 * unchanged — a logged `0 kg` stays `0` — and nothing is re-ranked or
 * re-selected: the position is the repository's winner.
 */
export function toPersonalBestDto(best: PersonalBest): PersonalBestDto {
  return {
    exerciseId: best.exerciseId,
    metric: best.metric,
    value: best.value,
    sessionId: best.position.sessionId,
    exerciseOrder: best.position.exerciseOrder,
    setNumber: best.position.setNumber,
    completedAt: best.position.completedAt.toISOString(),
  };
}
