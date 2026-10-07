/**
 * One-settlement-per-occurrence invariant (M17 I1).
 *
 * M17 adds an explicit "not performed" execution fact per authored occurrence.
 * A completed session and that record are BOTH authoritative settlements of the
 * same occurrence, so holding both is contradictory: no precedence rule can be
 * honest here — whichever fact "won", the reported state would match neither
 * source. The violation therefore fails loudly (the `follow-through-week.ts` /
 * `'… contract violated: …'` convention) instead of being silently normalized.
 *
 * It is enforced at the read boundary because valid writes cannot produce it:
 * recording a day requires the absence of a completed session, and completing
 * an occurrence that is recorded as not performed is refused. Observing both
 * facts therefore means corrupted data, a repository bug or a query regression.
 *
 * One sentence for both taxonomies on purpose: M15's calendar status and M16's
 * follow-through outcome must reject the same impossible input with the same
 * words, so the two features cannot drift apart on how they treat it.
 *
 * The live-session case is deliberately NOT rejected: `in-progress` /
 * `started` outranks the record, so a fact never relabels work that is
 * happening now. That combination is unreachable in a healthy run as well
 * (recording deletes a zero-set abandoned session, and a session with logged
 * work refuses recording), which is why it is a locked precedence rather than a
 * contradiction.
 */

import type { ScheduledWorkoutId } from '@/domain/types/ids';

/** The three facts a single occurrence's settlement is read from. */
export interface OccurrenceSettlementFacts {
  readonly scheduledWorkoutId: ScheduledWorkoutId;
  readonly hasCompletedSession: boolean;
  readonly hasNotPerformedRecord: boolean;
}

/**
 * Throws when one occurrence is settled both by a completed session and by a
 * not-performed record (M17 I1). A no-op for every valid combination.
 */
export function assertOccurrenceSettlementIsConsistent(
  facts: OccurrenceSettlementFacts,
): void {
  if (facts.hasCompletedSession && facts.hasNotPerformedRecord) {
    throw new Error(
      `Occurrence settlement contract violated: occurrence "${facts.scheduledWorkoutId}" is both completed and recorded as not performed`,
    );
  }
}
