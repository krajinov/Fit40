/**
 * Machine-readable reason codes for progression decisions.
 *
 * A code states WHY the domain engine decided a target — it is a stable
 * identifier, never UI copy. Presentation layers may map codes to human
 * language; they must never interpret a code as display text.
 *
 * Const-object + union, matching `src/domain/types/exercise.ts`: no
 * TypeScript `enum`, lower-kebab values.
 */

/**
 * The decision behind a `NextExerciseTarget`. One code per decision path.
 */
export const ProgressionReason = {
  /** No usable history: the exercise was never performed, or (defensively) the newest occurrence has no considered sets. */
  NoHistory: 'no-history',
  /** The newest history was earned under a different prescription; it cannot drive today's target. */
  SchemeChanged: 'scheme-changed',
  /** Every prescribed set of the newest occurrence reached the top of the rep range; a load increase additionally requires one uniform working load. */
  AllSetsAtTopOfRange: 'all-sets-at-top-of-range',
  /** Bodyweight: every prescribed set was logged, but at least one fell short of the top of the authored range. */
  RepsBelowTopOfRange: 'reps-below-top-of-range',
  /** Duration: every prescribed set reached the scheme's target seconds — the exact boundary counts. */
  AllSetsAtTargetDuration: 'all-sets-at-target-duration',
  /** Duration: every prescribed set was logged, but at least one fell short of the scheme's target seconds. */
  SetsBelowTargetDuration: 'sets-below-target-duration',
  /** The considered sets used mixed loads; one number cannot progress them. */
  NonUniformLoad: 'non-uniform-load',
  /** Reps landed inside the range (or mixed): neither the increase nor the regress criterion was met. */
  MixedPerformanceInRange: 'mixed-performance-in-range',
  /** Fewer sets were logged than prescribed; incomplete performance never changes the recommendation. */
  IncompleteSets: 'incomplete-sets',
  /** One below-minimum occurrence: a single poor session holds the load, never regresses it. */
  SingleSessionBelowMinimum: 'single-session-below-minimum',
  /** The two newest eligible occurrences both fell below minReps. */
  TwoConsecutiveSessionsBelowMinimum: 'two-consecutive-sessions-below-minimum',
} as const;

export type ProgressionReason = (typeof ProgressionReason)[keyof typeof ProgressionReason];

/**
 * Every reason that keeps the working load unchanged — the reasons that can
 * produce a `hold` target.
 */
export type HoldProgressionReason =
  | (typeof ProgressionReason)['IncompleteSets']
  | (typeof ProgressionReason)['SingleSessionBelowMinimum']
  | (typeof ProgressionReason)['MixedPerformanceInRange']
  | (typeof ProgressionReason)['NonUniformLoad'];

/**
 * Every reason that can produce a `bodyweight-hold` target — the bodyweight
 * counterpart of the hold reasons.
 */
export type BodyweightHoldProgressionReason =
  | (typeof ProgressionReason)['IncompleteSets']
  | (typeof ProgressionReason)['RepsBelowTopOfRange'];

/**
 * Every reason that can produce a `duration-hold` target — the timed-work
 * counterpart of the hold reasons.
 */
export type DurationHoldProgressionReason =
  | (typeof ProgressionReason)['IncompleteSets']
  | (typeof ProgressionReason)['SetsBelowTargetDuration'];
