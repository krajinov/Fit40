/**
 * The ONE user-visible "Add exercise" draft of the Active Workout screen (M11).
 *
 * Owned by `AddSessionExercisePanel`: the catalog selection AND the explicit
 * prescription live in a single state object, and both children
 * (`AddExerciseCatalogOptions`, `AddExercisePrescriptionFields`) are
 * presentational views over it.
 *
 * Why the draft is owned here (PR #14 review finding): the catalog radios used
 * to be uncontrolled while the prescription inputs kept their own local state.
 * React 19 resets a form's DOM after its action resolves — INCLUDING error
 * resolutions — so an expected failure cleared only the exercise selection
 * while the prescription survived, and a successful Add cleared only the
 * selection while leaving the previous prescription behind for accidental
 * reuse. One owner cannot split the draft: failures preserve it as a whole and
 * success clears it as a whole.
 *
 * A fresh draft has NO pre-selected exercise and NO default prescription
 * (never a "3x10"): the user must state both explicitly.
 */

/** The two explicit prescription schemes a session-added occurrence supports. */
export type AddExerciseScheme = 'reps' | 'duration';

/** Everything the user explicitly states for one Add submission. */
export interface AddExerciseDraft {
  /** The selected catalog exercise id, or `null` while none is selected. */
  readonly exerciseId: string | null;
  /** The chosen prescription scheme, or `null` before the user chooses one. */
  readonly scheme: AddExerciseScheme | null;
  /** Sets as raw input text (`''` = not entered; the server validates it). */
  readonly sets: string;
  /** Target reps for the `reps` scheme (`''` = not entered). */
  readonly targetReps: string;
  /** Seconds for the `duration` scheme (`''` = not entered). */
  readonly durationSeconds: string;
}

/** The empty draft an Add starts from and returns to after a successful Add. */
export const EMPTY_ADD_EXERCISE_DRAFT: AddExerciseDraft = {
  exerciseId: null,
  scheme: null,
  sets: '',
  targetReps: '',
  durationSeconds: '',
};
