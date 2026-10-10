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
 *
 * M18 Slice 8 adds `resolveWorkingLoadComparison` below: the period-scoped
 * first-vs-latest statement built from exactly these loads.
 */
import type { SetLog } from '@/domain/entities/workout-session';
import type { WorkoutSessionId } from '@/domain/types/ids';
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

// ─── Period comparison: first vs latest eligible working load (M18 Slice 8) ───

/**
 * One eligible observation: the occurrence's single working load and when the
 * workout that produced it completed.
 */
export interface WorkingLoadComparisonPoint {
  /** The metric's own unit — kilograms. Never formatted here. */
  readonly loadKg: number;
  readonly completedAt: Date;
}

/**
 * The factual direction between the two compared loads. It says what the two
 * numbers do relative to each other and nothing more: no percentage, no
 * strength claim, no quality judgement.
 */
export type WorkingLoadDirection = 'increased' | 'unchanged' | 'decreased';

/**
 * The first-vs-latest eligible working-load statement for one set of
 * occurrences (the caller scopes it — this module knows nothing about a
 * horizon).
 *
 * `first` is the ladder-MINIMUM eligible occurrence and `latest` the
 * ladder-MAXIMUM — never the minimum/maximum LOAD: a heavy early workout and a
 * light recent one must read as first 30 → latest 20, not 30 → 30.
 */
export interface WorkingLoadComparison {
  readonly first: WorkingLoadComparisonPoint;
  readonly latest: WorkingLoadComparisonPoint;
  readonly direction: WorkingLoadDirection;
}

/**
 * The occurrence facts the comparison consumes. `CompletedExerciseOccurrence`
 * (the history port's projection) is structurally assignable, so callers pass
 * their read rows unchanged.
 */
export interface WorkingLoadComparisonSource {
  readonly sessionId: WorkoutSessionId;
  /** Position of the exercise log within its session — a ladder rung. */
  readonly exerciseOrder: number;
  readonly startedAt: Date;
  readonly completedAt: Date;
  readonly prescription: RepPrescription;
  readonly sets: ReadonlyArray<SetLog>;
}

function compareStrings(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

/**
 * The approved §7.2 ordering ladder, ascending: `completedAt`, then
 * `startedAt`, then `sessionId`, then `exerciseOrder` — the history recency
 * ladder reversed, and `PerformancePosition` minus `setNumber`. Two
 * occurrences of one exercise inside one session therefore resolve to distinct
 * positions (the later `exerciseOrder` is later), and ties are never ambiguous.
 */
function compareOccurrenceLadder(
  a: WorkingLoadComparisonSource,
  b: WorkingLoadComparisonSource,
): number {
  return (
    a.completedAt.getTime() - b.completedAt.getTime() ||
    a.startedAt.getTime() - b.startedAt.getTime() ||
    compareStrings(a.sessionId, b.sessionId) ||
    a.exerciseOrder - b.exerciseOrder
  );
}

/**
 * Resolves the first-vs-latest working load over the supplied occurrences.
 *
 * Eligibility is exactly the module's own load rule: an occurrence with an
 * `external` single load. Bodyweight and timed work are excluded (no truthful
 * single load exists), a genuine `0 kg` counts, and an occurrence with no
 * logged sets resolves to `unloaded` and is therefore excluded too.
 *
 * Returns null when fewer than two eligible occurrences exist — one point
 * never draws a slope. Pure: no clock, no persistence, no formatting, and no
 * knowledge of any horizon.
 */
export function resolveWorkingLoadComparison(
  occurrences: ReadonlyArray<WorkingLoadComparisonSource>,
): WorkingLoadComparison | null {
  const eligible: { readonly source: WorkingLoadComparisonSource; readonly loadKg: number }[] = [];
  for (const occurrence of occurrences) {
    const load = resolveOccurrenceWorkingLoad(occurrence.prescription, occurrence.sets);
    if (load.kind !== 'external') continue;
    eligible.push({ source: occurrence, loadKg: load.loadKg });
  }

  if (eligible.length < 2) {
    return null;
  }

  eligible.sort((a, b) => compareOccurrenceLadder(a.source, b.source));
  const first = eligible[0];
  const latest = eligible[eligible.length - 1];
  if (first === undefined || latest === undefined) {
    return null;
  }

  return {
    first: { loadKg: first.loadKg, completedAt: first.source.completedAt },
    latest: { loadKg: latest.loadKg, completedAt: latest.source.completedAt },
    direction:
      latest.loadKg > first.loadKg
        ? 'increased'
        : latest.loadKg < first.loadKg
          ? 'decreased'
          : 'unchanged',
  };
}
