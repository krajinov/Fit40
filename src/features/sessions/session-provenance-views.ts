/**
 * PURE presentation mapping for occurrence PROVENANCE (M11): the subtle,
 * neutral label a user-added occurrence carries in Active Workout.
 *
 * Provenance is a persisted domain fact (`WorkoutSessionExerciseDto.source`,
 * from `exercise_logs.source`). This module only formats it: it can
 * structurally never infer provenance from the occurrence's order, its
 * occurrenceKey, the authored/performed identities or substitution state, and
 * template-authored occurrences simply render no label.
 *
 * The label is derived from the DTO field alone and rides the existing card
 * view (`SessionExerciseCardView.provenanceLabel`), matching the
 * `session-adjustment-views.ts` / `session-substitution-views.ts` pattern:
 * presentation consumes the view model, never raw session facts.
 */

import type { OccurrenceSource } from '@/domain/entities/workout-session';

/** Neutral provenance label of a session-added occurrence. */
export const ADDED_DURING_WORKOUT_LABEL = 'Added during workout';

/**
 * The provenance label for one occurrence, or null when it was authored by
 * the workout template (which gets no provenance treatment). A substituted
 * user-added occurrence keeps its label — substitution and provenance are
 * independent facts.
 */
export function resolveOccurrenceProvenanceLabel(source: OccurrenceSource): string | null {
  return source === 'user_added' ? ADDED_DURING_WORKOUT_LABEL : null;
}
