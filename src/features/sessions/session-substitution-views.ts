/**
 * PURE presentation mapping for the Active Workout's exercise substitution
 * affordance (M9): which controls one occurrence exposes, the candidate
 * option labels, and the honest blocked/empty copy.
 *
 * Every state derives from facts the domain and application layers already
 * decided — `isSubstituted` is the domain-derived snapshot flag, and the
 * logged-set block mirrors the domain's substitution precondition. The
 * domain remains the enforcement boundary; this module only chooses UI and
 * never re-implements substitution rules, ranking, or candidate selection.
 *
 * Affordance states (locked M9 semantics):
 * - `replace`              in progress · not substituted · no logged sets ·
 *                          candidates available
 * - `restore-available`    in progress · substituted · no logged sets
 *                          (candidates may be empty — the swap control then
 *                          shows the honest empty state, and a chained swap
 *                          stays possible whenever candidates exist)
 * - `blocked-logged-sets`  ≥1 logged set · no controls, muted truthful copy
 * - `no-candidates`        in progress · not substituted · no logged sets ·
 *                          no matching candidates (honest empty state, never
 *                          unrelated exercises)
 * - `hidden`               completed/read-only session · no mutation controls
 */

import type {
  ExerciseSubstitutionCandidatesDto,
  SubstitutionCandidateDto,
} from '@/application/dto/substitution-candidates';
import {
  EQUIPMENT_LABELS,
  MUSCLE_GROUP_LABELS,
} from '@/features/exercises/exercise-labels';

/** Muted truthful copy of the logged-set block (spec wording). */
export const SUBSTITUTION_BLOCKED_LABEL = 'Delete your logged sets to swap this exercise.';

/** Honest empty state — never suggests unrelated exercises. */
export const SUBSTITUTION_EMPTY_CANDIDATES_LABEL = 'No similar exercises found right now.';

/** Truthful hint when the candidate limit truncated further matches. */
export const SUBSTITUTION_LIMITED_LABEL = 'Showing your closest matches.';

export type SessionSubstitutionState =
  | 'replace'
  | 'restore-available'
  | 'blocked-logged-sets'
  | 'no-candidates'
  | 'hidden';

/** One selectable substitute: identity plus its formatted option label. */
export interface SessionSubstitutionCandidateView {
  readonly exerciseId: string;
  readonly name: string;
  /** "Dumbbell · Chest" — equipment and primary muscle, the candidate facts. */
  readonly metaLabel: string;
}

/**
 * The substitution affordance of one occurrence card: its state plus the
 * candidate data the controls render. `matchTier` stays internal — raw tier
 * codes are never surfaced.
 */
export interface SessionSubstitutionView {
  readonly state: SessionSubstitutionState;
  /** The domain-derived snapshot flag, mirrored for the restore control. */
  readonly isSubstituted: boolean;
  readonly candidates: ReadonlyArray<SessionSubstitutionCandidateView>;
  /** Truthful limit metadata from the candidate DTO. */
  readonly candidatesLimited: boolean;
  /** Present only in the `blocked-logged-sets` state; null otherwise. */
  readonly blockedLabel: string | null;
}

function buildCandidateView(
  candidate: SubstitutionCandidateDto,
): SessionSubstitutionCandidateView {
  return {
    exerciseId: candidate.exerciseId,
    name: candidate.name,
    metaLabel: `${EQUIPMENT_LABELS[candidate.equipment]} · ${MUSCLE_GROUP_LABELS[candidate.primaryMuscle]}`,
  };
}

/**
 * Derives one occurrence's substitution affordance from DTO facts. A null
 * `candidates` entry (the performed exercise no longer resolves in the
 * catalog) degrades to the honest no-candidates outcome — never fabricated
 * names or unrelated suggestions.
 */
export function buildSessionSubstitutionView(input: {
  readonly sessionStatus: 'in-progress' | 'completed';
  readonly isSubstituted: boolean;
  readonly hasLoggedSets: boolean;
  readonly candidates: ExerciseSubstitutionCandidatesDto | null;
}): SessionSubstitutionView {
  if (input.sessionStatus === 'completed') {
    return {
      state: 'hidden',
      isSubstituted: input.isSubstituted,
      candidates: [],
      candidatesLimited: false,
      blockedLabel: null,
    };
  }

  if (input.hasLoggedSets) {
    return {
      state: 'blocked-logged-sets',
      isSubstituted: input.isSubstituted,
      candidates: [],
      candidatesLimited: false,
      blockedLabel: SUBSTITUTION_BLOCKED_LABEL,
    };
  }

  const candidates =
    input.candidates === null
      ? []
      : input.candidates.candidates.map(buildCandidateView);

  if (input.isSubstituted) {
    return {
      state: 'restore-available',
      isSubstituted: true,
      candidates,
      candidatesLimited: input.candidates?.isLimited ?? false,
      blockedLabel: null,
    };
  }

  if (candidates.length === 0) {
    return {
      state: 'no-candidates',
      isSubstituted: false,
      candidates: [],
      candidatesLimited: false,
      blockedLabel: null,
    };
  }

  return {
    state: 'replace',
    isSubstituted: false,
    candidates,
    candidatesLimited: input.candidates?.isLimited ?? false,
    blockedLabel: null,
  };
}