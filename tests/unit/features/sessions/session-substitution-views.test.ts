/**
 * Unit tests for the M9 substitution presentation mapping: affordance
 * states, candidate option labels, blocked/empty copy, and the
 * error-code → user-facing sentence mapping of session-action-labels.
 */

import { describe, expect, it } from 'vitest';

import type { ExerciseSubstitutionCandidatesDto } from '@/application/dto/substitution-candidates';
import {
  buildSessionSubstitutionView,
  SUBSTITUTION_BLOCKED_LABEL,
  SUBSTITUTION_EMPTY_CANDIDATES_LABEL,
} from '@/features/sessions/session-substitution-views';
import { sessionActionErrorLabel } from '@/features/sessions/session-action-labels';

function candidatesDto(
  candidates: ReadonlyArray<{ readonly exerciseId: string; readonly name: string }>,
  isLimited = false,
): ExerciseSubstitutionCandidatesDto {
  return {
    sourceExerciseId: 'ex-source',
    isLimited,
    candidates: candidates.map((candidate) => ({
      exerciseId: candidate.exerciseId,
      name: candidate.name,
      slug: `slug-${candidate.exerciseId}`,
      equipment: 'dumbbell',
      primaryMuscle: 'chest',
      movementPattern: 'push-horizontal',
      difficulty: 'intermediate',
      matchTier: 'same-pattern-same-muscle',
    })),
  };
}

describe('session-substitution-views / buildSessionSubstitutionView', () => {
  const withCandidates = candidatesDto([
    { exerciseId: 'ex-db-bench', name: 'Dumbbell Bench Press' },
  ]);

  it('derives the replace state for a mutable, unsubstituted occurrence with candidates', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: false,
      hasLoggedSets: false,
      candidates: withCandidates,
    });

    expect(view.state).toBe('replace');
    expect(view.isSubstituted).toBe(false);
    expect(view.blockedLabel).toBeNull();
  });

  it('formats candidate labels with equipment and primary muscle', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: false,
      hasLoggedSets: false,
      candidates: withCandidates,
    });

    expect(view.candidates[0]?.name).toBe('Dumbbell Bench Press');
    expect(view.candidates[0]?.metaLabel).toBe('Dumbbell · Chest');
    expect(view.candidates[0]?.exerciseId).toBe('ex-db-bench');
  });

  it('derives restore-available when substituted with no logged sets, even with empty candidates', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: true,
      hasLoggedSets: false,
      candidates: candidatesDto([]),
    });

    expect(view.state).toBe('restore-available');
    expect(view.isSubstituted).toBe(true);
    expect(view.candidates).toEqual([]);
  });

  it('keeps the swap affordance in restore-available when a chained substitute has candidates', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: true,
      hasLoggedSets: false,
      candidates: withCandidates,
    });

    expect(view.state).toBe('restore-available');
    expect(view.candidates.length).toBeGreaterThan(0);
  });

  it('derives blocked-logged-sets with the truthful muted copy once any set exists', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: false,
      hasLoggedSets: true,
      candidates: withCandidates,
    });

    expect(view.state).toBe('blocked-logged-sets');
    expect(view.blockedLabel).toBe(SUBSTITUTION_BLOCKED_LABEL);
    expect(view.blockedLabel).toBe('Delete your logged sets to swap this exercise.');
    expect(view.candidates).toEqual([]);
  });

  it('blocks restore identically once sets are logged', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: true,
      hasLoggedSets: true,
      candidates: withCandidates,
    });

    expect(view.state).toBe('blocked-logged-sets');
  });
});

describe('session-substitution-views / no-candidates and hidden states', () => {
  const withCandidates = candidatesDto([
    { exerciseId: 'ex-db-bench', name: 'Dumbbell Bench Press' },
  ]);

  it('derives no-candidates with the honest empty state for a mutable unsubstituted occurrence', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: false,
      hasLoggedSets: false,
      candidates: candidatesDto([]),
    });

    expect(view.state).toBe('no-candidates');
    expect(view.candidates).toEqual([]);
    expect(view.candidatesLimited).toBe(false);
  });

  it('derives no-candidates when the performed exercise no longer resolves (null entry)', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: false,
      hasLoggedSets: false,
      candidates: null,
    });

    expect(view.state).toBe('no-candidates');
  });

  it('carries the truthful limit metadata through to the view', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'in-progress',
      isSubstituted: false,
      hasLoggedSets: false,
      candidates: candidatesDto([{ exerciseId: 'ex-a', name: 'A' }], true),
    });

    expect(view.state).toBe('replace');
    expect(view.candidatesLimited).toBe(true);
  });

  it('derives hidden for completed sessions regardless of substitution or sets', () => {
    const view = buildSessionSubstitutionView({
      sessionStatus: 'completed',
      isSubstituted: true,
      hasLoggedSets: false,
      candidates: withCandidates,
    });

    expect(view.state).toBe('hidden');
    expect(view.candidates).toEqual([]);
    expect(view.blockedLabel).toBeNull();
  });
});

describe('session-substitution-views / honest copy constants', () => {
  it('never suggests unrelated exercises in the empty state', () => {
    expect(SUBSTITUTION_EMPTY_CANDIDATES_LABEL).toBe('No similar exercises found right now.');
    expect(SUBSTITUTION_EMPTY_CANDIDATES_LABEL).not.toMatch(/bench|squat|row/i);
  });
});

describe('session-action-labels / sessionActionErrorLabel', () => {
  it('maps every expected substitution error to user-facing copy', () => {
    expect(sessionActionErrorLabel('SESSION_NOT_FOUND', 'fallback')).toBe(
      'This session no longer exists. Reloading the latest state…',
    );
    expect(sessionActionErrorLabel('NOT_ENROLLED', 'fallback')).toBe(
      'You are no longer enrolled in this program, so this session can no longer be modified.',
    );
    expect(sessionActionErrorLabel('SESSION_ALREADY_COMPLETED', 'fallback')).toBe(
      'This workout is already completed, so its exercises can no longer be changed.',
    );
    expect(sessionActionErrorLabel('EXERCISE_LOG_NOT_FOUND', 'fallback')).toBe(
      'This exercise could not be found in the session. Reloading the latest state…',
    );
    expect(sessionActionErrorLabel('EXERCISE_HAS_LOGGED_SETS', 'fallback')).toBe(
      'This exercise has logged sets. Delete them first to swap the exercise.',
    );
    expect(sessionActionErrorLabel('SUBSTITUTION_NO_CHANGE', 'fallback')).toBe(
      'That exercise is already selected here. Reloading the latest state…',
    );
    expect(sessionActionErrorLabel('EXERCISE_NOT_FOUND', 'fallback')).toBe(
      'That exercise is no longer available in the exercise catalog.',
    );
    expect(sessionActionErrorLabel('INVALID_INPUT', 'fallback')).toBe(
      'Invalid selection — choose an exercise and try again.',
    );
  });

  it('falls back to the action message for codes without dedicated copy', () => {
    expect(sessionActionErrorLabel('FORBIDDEN', 'You do not have access to this session.')).toBe(
      'You do not have access to this session.',
    );
    expect(sessionActionErrorLabel('VALIDATION_ERROR', 'Invalid substitution input.')).toBe(
      'Invalid substitution input.',
    );
  });
});
