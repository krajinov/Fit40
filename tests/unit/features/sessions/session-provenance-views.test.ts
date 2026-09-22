/**
 * Presentation tests for the M11 occurrence-provenance mapping: the label is
 * derived ONLY from the persisted `WorkoutSessionExerciseDto.source`, never
 * inferred from order, occurrenceKey, the authored/performed identities or
 * substitution state — and appending an occurrence leaves every existing
 * occurrence's render identity untouched.
 */

import { describe, expect, it } from 'vitest';

import type { WorkoutSessionExerciseDto } from '@/application/dto/workout-session';
import {
  buildSessionExerciseCardViews,
  type SessionExerciseCatalogMeta,
} from '@/features/sessions/active-workout-views';
import {
  ADDED_DURING_WORKOUT_LABEL,
  resolveOccurrenceProvenanceLabel,
} from '@/features/sessions/session-provenance-views';

const catalog = new Map<string, SessionExerciseCatalogMeta>([
  ['ex-a', { name: 'Squat', equipment: 'barbell' }],
  ['ex-b', { name: 'Bench', equipment: 'barbell' }],
  ['ex-c', { name: 'Row', equipment: 'barbell' }],
]);

function log(
  order: number,
  exerciseId: string,
  overrides: Partial<WorkoutSessionExerciseDto> = {},
): WorkoutSessionExerciseDto {
  return {
    authoredExerciseId: exerciseId,
    performedExerciseId: exerciseId,
    isSubstituted: false,
    isSkipped: false,
    occurrenceKey: order,
    source: 'template',
    substitutionEligibility: { blockedBy: null, canRestore: false },
    removalEligibility: { canRemove: false, blockedBy: 'template-authored' },
    adjustmentEligibility: {
      isSkipped: false,
      blockedBy: null,
      canSkip: true,
      canUnskip: false,
      canMoveUp: order > 1,
      canMoveDown: true,
    },
    order,
    prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
    sets: [],
    ...overrides,
  };
}

function cards(logs: ReadonlyArray<WorkoutSessionExerciseDto>) {
  return buildSessionExerciseCardViews({
    logs,
    targets: logs.map(() => null),
    catalogByExerciseId: catalog,
    candidatesByPerformedExerciseId: new Map(),
    sessionStatus: 'in-progress',
  });
}

describe('resolveOccurrenceProvenanceLabel', () => {
  it('labels only user-added occurrences', () => {
    expect(resolveOccurrenceProvenanceLabel('user_added')).toBe(ADDED_DURING_WORKOUT_LABEL);
    expect(resolveOccurrenceProvenanceLabel('template')).toBeNull();
  });
});

describe('buildSessionExerciseCardViews / provenance (M11)', () => {
  it('never infers provenance from any other occurrence fact', () => {
    const cardsForLogs = cards([
      log(1, 'ex-a'),
      // A substituted TEMPLATE occurrence: performed != authored, but the
      // persisted source still says template.
      log(2, 'ex-b', {
        isSubstituted: true,
        authoredExerciseId: 'ex-a',
        performedExerciseId: 'ex-b',
      }),
      // A user-added occurrence whose identities happen to match a template
      // occurrence's shape, at a shifted order/key.
      log(3, 'ex-c', { source: 'user_added', occurrenceKey: 41 }),
    ]);

    expect(cardsForLogs.map((card) => card.provenanceLabel)).toEqual([
      null,
      null,
      ADDED_DURING_WORKOUT_LABEL,
    ]);
    // Substitution semantics are untouched by provenance.
    expect(cardsForLogs[1]?.originallyName).toBe('Squat');
  });

  it('keeps the label on a substituted user-added occurrence', () => {
    const cardsForLogs = cards([
      log(1, 'ex-c', {
        source: 'user_added',
        isSubstituted: true,
        authoredExerciseId: 'ex-b',
        performedExerciseId: 'ex-c',
      }),
    ]);

    expect(cardsForLogs[0]?.provenanceLabel).toBe(ADDED_DURING_WORKOUT_LABEL);
    expect(cardsForLogs[0]?.originallyName).toBe('Bench');
  });

  it('keeps every existing occurrence render identity unchanged when one is appended', () => {
    const before = cards([log(1, 'ex-a'), log(2, 'ex-b')]);
    const after = cards([
      log(1, 'ex-a'),
      log(2, 'ex-b'),
      log(3, 'ex-c', { source: 'user_added' }),
    ]);

    // Existing occurrences keep their occurrenceKey-derived keys (so React
    // never remounts or misassociates them), and the appended occurrence gets
    // a fresh one.
    expect(after.map((card) => card.renderKey)).toEqual([
      before[0]?.renderKey,
      before[1]?.renderKey,
      'occ:3',
    ]);
    expect(new Set(after.map((card) => card.renderKey)).size).toBe(3);
  });

  it('keeps a survivor\u2019s render identity when a preceding occurrence is removed (M11 Slice 4)', () => {
    const before = cards([
      log(1, 'ex-a'),
      log(2, 'ex-b', { source: 'user_added' }),
      log(3, 'ex-c', { source: 'user_added' }),
    ]);

    // Removal renumbers orders only: C moves 3 → 2 and keeps occurrenceKey 3.
    const after = cards([
      log(1, 'ex-a'),
      log(2, 'ex-c', { source: 'user_added', occurrenceKey: 3 }),
    ]);

    expect(after.map((card) => card.renderKey)).toEqual(['occ:1', 'occ:3']);
    // The survivor's subtree identity is literally the same React key it had
    // before the removal, so its local state stays with it.
    expect(after[1]?.renderKey).toBe(before[2]?.renderKey);
    expect(after[1]?.name).toBe('Row');
  });

  it('copies the domain-derived removal eligibility verbatim onto the card view', () => {
    const cardsForLogs = cards([
      log(1, 'ex-a'), // template-authored
      log(2, 'ex-b', {
        source: 'user_added',
        removalEligibility: { canRemove: true, blockedBy: null },
      }),
      log(3, 'ex-c', {
        source: 'user_added',
        removalEligibility: { canRemove: false, blockedBy: 'logged-sets' },
      }),
    ]);

    expect(cardsForLogs.map((card) => card.removalEligibility)).toEqual([
      { canRemove: false, blockedBy: 'template-authored' },
      { canRemove: true, blockedBy: null },
      { canRemove: false, blockedBy: 'logged-sets' },
    ]);
  });
});
