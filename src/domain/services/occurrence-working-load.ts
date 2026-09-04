/**
 * The truthful single working load of one completed exercise occurrence —
 * the display/trend counterpart of the progression engine's load semantics.
 *
 * This module is a deliberate MIRROR of the load rules in
 * `exercise-progression.ts` / `rep-load-decision.ts`, not a shared input to
 * them: the engine's behavior (and its tests) must not change. The mirrored
 * rules:
 *
 * - a duration prescription never yields a load — timed work is not
 *   externally load-trended;
 * - a rep set logged without external load (`weightKg === null`) marks the
 *   occurrence as bodyweight — no single number can describe it;
 * - `0 kg` is a real external load and counts;
 * - otherwise the working load is the MINIMUM load across the performed
 *   sets. One deliberate difference from the engine: progression decisions
 *   consider the FIRST prescribed sets, while history reports what was
 *   actually performed, across every logged set.
 *
 * `sets` is expected non-empty (the history port guarantees at least one
 * logged set per occurrence); empty input degrades to 'unloaded'
 * defensively, never to a fabricated load.
 */
import type { SetLog } from '@/domain/entities/workout-session';
import type { RepPrescription } from '@/domain/value-objects/rep-prescription';

/**
 * The occurrence's single working load: either a real external load, or
 * 'unloaded' when no truthful single load exists (bodyweight or timed work).
 */
export type OccurrenceWorkingLoad =
  | { readonly kind: 'external'; readonly loadKg: number }
  | { readonly kind: 'unloaded' };

/**
 * Resolves the working load of one completed exercise occurrence for
 * display and trend purposes. This is NOT a progression input — the
 * engine's semantics live in `exercise-progression.ts` and are unchanged.
 */
export function resolveOccurrenceWorkingLoad(
  prescription: RepPrescription,
  sets: ReadonlyArray<SetLog>,
): OccurrenceWorkingLoad {
  if (prescription.type === 'duration') {
    return { kind: 'unloaded' };
  }

  const loads: number[] = [];
  for (const set of sets) {
    if (set.weightKg === null) {
      return { kind: 'unloaded' };
    }
    loads.push(set.weightKg);
  }

  if (loads.length === 0) {
    return { kind: 'unloaded' };
  }

  return { kind: 'external', loadKg: Math.min(...loads) };
}
