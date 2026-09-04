/**
 * Discriminated recommendation for an exercise's next workout load.
 *
 * The `basis` tag states WHAT to do; every variant also carries a
 * machine-readable `reason` — a `ProgressionReason` code stating WHY the
 * decision was made. Reason codes are stable domain identifiers, never UI
 * copy. Produced by the progression engine's rep load decision (see
 * `rep-load-decision.ts`) or by one of the engine's early gates (no
 * history, scheme change, duration).
 */
import type { HoldProgressionReason } from '@/domain/services/progression-reason';

export type NextExerciseTarget =
  /** No history: the exercise has not been performed under any scheme yet. */
  | { readonly basis: 'first-exposure'; readonly reason: 'no-history' }
  /** The prescription changed: history earned under the old scheme cannot drive load. */
  | { readonly basis: 'scheme-change'; readonly reason: 'scheme-changed' }
  /** Duration-based prescription: timed work progresses via the scheme, not load. */
  | { readonly basis: 'duration'; readonly reason: 'duration-scheme' }
  /** A considered set was logged without load: no external load to progress. */
  | { readonly basis: 'bodyweight'; readonly reason: 'unloaded-set' }
  /**
   * Every considered set reached maxReps on one uniform load: add the
   * equipment increment.
   */
  | {
      readonly basis: 'increase';
      readonly reason: 'all-sets-at-top-of-range';
      readonly previousLoadKg: number;
      readonly nextLoadKg: number;
      readonly incrementKg: number;
    }
  /**
   * Keep the working load: mixed or incomplete performance, a single
   * below-minimum occurrence, mixed loads, or reps between minReps and
   * maxReps — `reason` says which path held it.
   */
  | {
      readonly basis: 'hold';
      readonly reason: HoldProgressionReason;
      readonly previousLoadKg: number;
      readonly nextLoadKg: number;
    }
  /**
   * The two newest eligible occurrences both fell below minReps: remove the
   * equipment increment. `nextLoadKg` is null when the reduction floors at
   * or below zero — perform the exercise without added load.
   */
  | {
      readonly basis: 'regress';
      readonly reason: 'two-consecutive-sessions-below-minimum';
      readonly previousLoadKg: number;
      readonly nextLoadKg: number | null;
      readonly incrementKg: number;
    };
