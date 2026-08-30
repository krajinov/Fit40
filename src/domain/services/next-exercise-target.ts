/**
 * Discriminated recommendation for an exercise's next workout load.
 *
 * The `basis` tag states why the recommendation was made. Produced by the
 * progression engine's rep load decision (see `rep-load-decision.ts`) or by
 * one of the engine's early gates (no history, scheme change, duration).
 */
export type NextExerciseTarget =
  /** No history: the exercise has not been performed under any scheme yet. */
  | { readonly basis: 'first-exposure' }
  /** The prescription changed: history earned under the old scheme cannot drive load. */
  | { readonly basis: 'scheme-change' }
  /** Duration-based prescription: v1 progresses timed work via the scheme, not load. */
  | { readonly basis: 'duration' }
  /** A considered set was logged without load: no external load to progress. */
  | { readonly basis: 'bodyweight' }
  /**
   * Every considered set reached maxReps on one uniform load: add the
   * equipment increment.
   */
  | {
      readonly basis: 'increase';
      readonly previousLoadKg: number;
      readonly nextLoadKg: number;
      readonly incrementKg: number;
    }
  /**
   * Keep the working load: mixed or incomplete performance, or reps between
   * minReps and maxReps.
   */
  | { readonly basis: 'hold'; readonly previousLoadKg: number; readonly nextLoadKg: number }
  /**
   * Every prescribed set fell below minReps: remove the equipment increment.
   * `nextLoadKg` is null when the reduction floors at or below zero —
   * perform the exercise without added load.
   */
  | {
      readonly basis: 'regress';
      readonly previousLoadKg: number;
      readonly nextLoadKg: number | null;
      readonly incrementKg: number;
    };
