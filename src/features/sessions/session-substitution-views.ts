/**
 * PURE presentation mapping for the Active Workout's exercise substitution
 * affordance (M9): which controls one occurrence exposes, the candidate
 * option labels, and the honest blocked/empty copy.
 *
 * Business mutability arrives as the domain-derived eligibility projection
 * (`WorkoutSessionExerciseDto.substitutionEligibility` from
 * `resolveOccurrenceSubstitutionEligibility`) — this module only formats
 * the state it is handed and can structurally never re-derive whether sets
 * block a swap or whether restore is available. What stays purely visual:
 * candidate presence (candidates vs. empty copy) and which copy/component
 * renders. The domain remains the enforcement boundary; this module never
 * re-implements substitution rules, ranking, or candidate selection.
 *
 * Affordance states (locked M9 semantics):
 * - `replace`              in progress · not substituted · mutable ·
 *                          candidates available
 * - `restore-available`    in progress · substituted · mutable
 *                          (candidates may be empty — the swap control then
 *                          shows the honest empty state, and a chained swap
 *                          stays possible whenever candidates exist)
 * - `blocked-logged-sets`  ≥1 logged set · no controls, muted truthful copy
 * - `no-candidates`        in progress · not substituted · mutable ·
 *                          no matching candidates (honest empty state, never
 *                          unrelated exercises)
 * - `hidden`               completed/read-only session · no mutation controls
 *
 * M10 note: a domain block of `'skipped'` also maps to `hidden` — a skipped
 * occurrence exposes no swap controls until the user unskips it (F4). The
 * dedicated skip affordance arrives with the M10 skip UI; this mapping only
 * guarantees the substitution controls never contradict the domain block.
 */

import type {
  ExerciseSubstitutionCandidatesDto,
  SubstitutionCandidateDto,
} from '@/application/dto/substitution-candidates';
import type { OccurrenceSubstitutionEligibilityDto } from '@/application/dto/workout-session';
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
  /** True only when the domain says restore is currently possible. */
  readonly canRestore: boolean;
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
 * Derives one occurrence's substitution affordance from the domain-derived
 * eligibility projection plus the resolved candidate DTOs. The blocking
 * states map 1:1 from `blockedBy`; the purely visual candidate-presence
 * distinction (replace vs. no-candidates) is the only decision made here.
 * A null `candidates` entry (the performed exercise no longer resolves in
 * the catalog) degrades to the honest no-candidates outcome — never
 * fabricated names or unrelated suggestions.
 */
export function buildSessionSubstitutionView(input: {
  readonly eligibility: OccurrenceSubstitutionEligibilityDto;
  readonly candidates: ExerciseSubstitutionCandidatesDto | null;
}): SessionSubstitutionView {
  // Completed sessions are read-only: no mutation controls render at all.
  if (input.eligibility.blockedBy === 'session-completed') {
    return {
      state: 'hidden',
      canRestore: false,
      candidates: [],
      candidatesLimited: false,
      blockedLabel: null,
    };
  }

  // A skipped occurrence exposes no swap controls either (M10 F4): the
  // domain blocks substitution and restore until the user unskips it, and
  // the affordance must never contradict that block.
  if (input.eligibility.blockedBy === 'skipped') {
    return {
      state: 'hidden',
      canRestore: false,
      candidates: [],
      candidatesLimited: false,
      blockedLabel: null,
    };
  }

  // Logged sets block both substitution and restore, with truthful muted copy.
  if (input.eligibility.blockedBy === 'logged-sets') {
    return {
      state: 'blocked-logged-sets',
      canRestore: false,
      candidates: [],
      candidatesLimited: false,
      blockedLabel: SUBSTITUTION_BLOCKED_LABEL,
    };
  }

  const candidates =
    input.candidates === null
      ? []
      : input.candidates.candidates.map(buildCandidateView);

  // A mutable, substituted occurrence can always restore.
  if (input.eligibility.canRestore) {
    return {
      state: 'restore-available',
      canRestore: true,
      candidates,
      candidatesLimited: input.candidates?.isLimited ?? false,
      blockedLabel: null,
    };
  }

  // Visual-only distinction: mutable occurrence, no matching candidates.
  if (candidates.length === 0) {
    return {
      state: 'no-candidates',
      canRestore: false,
      candidates: [],
      candidatesLimited: false,
      blockedLabel: null,
    };
  }

  return {
    state: 'replace',
    canRestore: false,
    candidates,
    candidatesLimited: input.candidates?.isLimited ?? false,
    blockedLabel: null,
  };
}