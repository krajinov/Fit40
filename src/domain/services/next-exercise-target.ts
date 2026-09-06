/**
 * Discriminated recommendation for an exercise's next workout target.
 *
 * The `basis` tag states WHAT to do; every variant also carries a
 * machine-readable `reason` — a `ProgressionReason` code stating WHY the
 * decision was made. Reason codes are stable domain identifiers, never UI
 * copy. Produced by one of the progression engine's decisions — the rep
 * load decision (`rep-load-decision.ts`), the bodyweight decision
 * (`bodyweight-rep-decision.ts`), or the duration decision
 * (`duration-target-decision.ts`) — or by its early gates (no history,
 * scheme change).
 */
import type {
  BodyweightHoldProgressionReason,
  DurationHoldProgressionReason,
  HoldProgressionReason,
} from '@/domain/services/progression-reason';

export type NextExerciseTarget =
  /** No history: the exercise has not been performed under any scheme yet. */
  | { readonly basis: 'first-exposure'; readonly reason: 'no-history' }
  /** The prescription changed: history earned under the old scheme cannot drive load. */
  | { readonly basis: 'scheme-change'; readonly reason: 'scheme-changed' }
  /**
   * Bodyweight goal reached: every prescribed set of the newest occurrence
   * hit the top of the authored range — the prescription repeats as
   * written; no load, harder variation, or substitution is ever invented.
   */
  | { readonly basis: 'bodyweight-goal-reached'; readonly reason: 'all-sets-at-top-of-range' }
  /**
   * Bodyweight hold: an incomplete log, or a complete log with a set below
   * the top of the range — the prescription repeats as written; bodyweight
   * work never regresses.
   */
  | { readonly basis: 'bodyweight-hold'; readonly reason: BodyweightHoldProgressionReason }
  /**
   * Duration increase: every prescribed set reached the scheme's seconds
   * (the exact boundary counts) — the scheme extends by the fixed step.
   */
  | {
      readonly basis: 'duration-increase';
      readonly reason: 'all-sets-at-target-duration';
      readonly previousSeconds: number;
      readonly nextSeconds: number;
      readonly incrementSeconds: number;
    }
  /**
   * Duration hold: an incomplete log, or a complete log with a set below
   * the scheme's seconds — the scheme repeats; timed work never regresses.
   */
  | {
      readonly basis: 'duration-hold';
      readonly reason: DurationHoldProgressionReason;
      readonly previousSeconds: number;
      readonly nextSeconds: number;
    }
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
