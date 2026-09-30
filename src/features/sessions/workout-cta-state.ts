/**
 * CTA state for the scheduled-workout detail band (M17 Slice 11).
 *
 * Pure and presentational: the state is chosen from facts the application
 * already resolved — enrollment, the user-scoped not-performed record (M17
 * Slice 8) and the session lifecycle — never from an inference about logged
 * sets or from "there is no session, so Start is safe".
 */

export type WorkoutCtaState =
  | 'anonymous'
  | 'not-enrolled'
  | 'start'
  | 'resume'
  | 'completed'
  /** The occurrence is settled as recorded-not-performed. */
  | 'not-performed';

/**
 * Resolves the CTA band's state. Pure: no repository, no session inspection,
 * no settlement decision.
 *
 * Order matters — enrollment first (the fact is meaningless for a visitor
 * without a run), then the recorded settlement (an occurrence recorded as not
 * performed is settled, so it is never offered a Start or Resume), then the
 * session lifecycle exactly as before. Whether recording an in-progress
 * workout would succeed is NOT evaluated here: the use case owns that.
 */
export function resolveWorkoutCtaState(facts: {
  readonly enrolled: boolean;
  readonly notPerformedRecorded: boolean;
  readonly sessionStatus: 'none' | 'in-progress' | 'completed';
}): WorkoutCtaState {
  if (!facts.enrolled) {
    return 'not-enrolled';
  }
  if (facts.notPerformedRecorded) {
    return 'not-performed';
  }
  if (facts.sessionStatus === 'none') {
    return 'start';
  }
  return facts.sessionStatus === 'completed' ? 'completed' : 'resume';
}
