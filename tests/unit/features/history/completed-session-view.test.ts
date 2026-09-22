import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { CompletedSessionDto } from '@/application/dto/completed-session';

const { detailExecute } = vi.hoisted(() => ({
  detailExecute: vi.fn(),
}));

vi.mock('@/features/history/services', () => ({
  getCompletedSessionUseCase: { execute: detailExecute },
}));

import { toCompletedSessionView } from '@/features/history/completed-session-view';
import { ADDED_DURING_WORKOUT_LABEL } from '@/features/sessions/session-provenance-views';

beforeEach(() => {
  vi.clearAllMocks();
});

function sessionDto(overrides?: {
  readonly startedAt?: string;
  readonly completedAt?: string;
  readonly entries?: CompletedSessionDto['entries'];
  readonly metrics?: CompletedSessionDto['metrics'];
}): CompletedSessionDto {
  return {
    sessionId: 'session-1',
    workoutName: 'Full Body A',
    programName: 'Fit40 Beginner Strength',
    startedAt: overrides?.startedAt ?? '2026-01-01T10:00:00.000Z',
    completedAt: overrides?.completedAt ?? '2026-01-01T10:45:00.000Z',
    entries:
      overrides?.entries ??
      [
        {
          authoredExerciseId: 'ex-001',
          source: 'template',
          performedExerciseId: 'ex-001',
          isSubstituted: false,
          isSkipped: false,
          exerciseOrder: 1,
          exerciseName: 'Goblet Squat',
          authoredExerciseName: 'Goblet Squat',
          exerciseSlug: 'goblet-squat',
          equipment: 'kettlebell',
          restSeconds: 90,
          prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
          sets: [
            { type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: 7 },
            { type: 'reps', setNumber: 2, reps: 10, weightKg: null, rpe: null },
          ],
        },
      ],
    metrics:
      overrides?.metrics ?? { totalSets: 2, totalReps: 20, totalDurationSeconds: 0, volume: 500 },
  };
}

describe('toCompletedSessionView', () => {
  it('formats set lines truthfully and preserves entry/set order', () => {
    const view = toCompletedSessionView(sessionDto());
    expect(view.entries).toHaveLength(1);
    expect(view.entries[0]?.sets[0]?.valueLabel).toBe('50 kg × 10 @ RPE 7');
    expect(view.entries[0]?.sets[1]?.valueLabel).toBe('10 reps');
    expect(view.entries[0]?.sets.map((set) => set.setNumber)).toEqual([1, 2]);
  });

  it('renders header labels and the joined metrics line', () => {
    const view = toCompletedSessionView(sessionDto());
    expect(view.heading).toBe('Full Body A');
    expect(view.contextLabel).toBe('Fit40 Beginner Strength');
    expect(view.completedAtLabel).toBe('Jan 1, 2026');
    expect(view.elapsedLabel).toBe('45 min');
    expect(view.metricsLineLabel).toBe('2 sets · 20 reps · 500 kg');
  });

  it('omits elapsed time when the completedAt gap is not positive', () => {
    const view = toCompletedSessionView(
      sessionDto({ startedAt: '2026-01-01T10:45:00.000Z', completedAt: '2026-01-01T10:45:00.000Z' }),
    );
    expect(view.elapsedLabel).toBeNull();
  });

  it('renders sub-minute elapsed time truthfully instead of flooring to 0 min', () => {
    const oneSecond = toCompletedSessionView(
      sessionDto({ startedAt: '2026-01-01T10:45:00.000Z', completedAt: '2026-01-01T10:45:01.000Z' }),
    );
    const fiftyNineSeconds = toCompletedSessionView(
      sessionDto({ startedAt: '2026-01-01T10:45:00.000Z', completedAt: '2026-01-01T10:45:59.000Z' }),
    );
    expect(oneSecond.elapsedLabel).toBe('<1 min');
    expect(fiftyNineSeconds.elapsedLabel).toBe('<1 min');
  });

  it('formats a 60-second session as one minute', () => {
    const view = toCompletedSessionView(
      sessionDto({ startedAt: '2026-01-01T10:45:00.000Z', completedAt: '2026-01-01T10:46:00.000Z' }),
    );
    expect(view.elapsedLabel).toBe('1 min');
  });

  it('falls back to positional names and omits unresolved equipment', () => {
    const entries: CompletedSessionDto['entries'] = [
      {
        authoredExerciseId: 'ex-404',
        source: 'template',
        performedExerciseId: 'ex-404',
        isSubstituted: false,
        isSkipped: false,
        exerciseOrder: 3,
        exerciseName: null,
        authoredExerciseName: null,
        exerciseSlug: null,
        equipment: null,
        restSeconds: 0,
        prescription: { type: 'reps', sets: 2, minReps: 8, maxReps: 10 },
        sets: [],
      },
    ];
    const view = toCompletedSessionView(sessionDto({ entries }));
    expect(view.entries[0]?.name).toBe('Exercise 3');
    expect(view.entries[0]?.equipmentLabel).toBeNull();
    expect(view.entries[0]?.restLabel).toBeNull();
    expect(view.entries[0]?.sets).toEqual([]);
  });

  it('omits zero-value reps and volume from the metrics line', () => {
    const entries: CompletedSessionDto['entries'] = [
      {
        authoredExerciseId: 'ex-015',
        source: 'template',
        performedExerciseId: 'ex-015',
        isSubstituted: false,
        isSkipped: false,
        exerciseOrder: 1,
        exerciseName: 'Plank',
        authoredExerciseName: 'Plank',
        exerciseSlug: 'dead-bug',
        equipment: 'bodyweight',
        restSeconds: 60,
        prescription: { type: 'duration', sets: 3, seconds: 45 },
        sets: [{ type: 'duration', setNumber: 1, durationSeconds: 45, weightKg: null, rpe: null }],
      },
    ];
    const view = toCompletedSessionView(
      sessionDto({ entries, metrics: { totalSets: 1, totalReps: 0, totalDurationSeconds: 45, volume: 0 } }),
    );
    expect(view.metricsLineLabel).toBe('1 set');
  });

  it('links a resolved catalog slug to the exercise history page', () => {
    const view = toCompletedSessionView(sessionDto());
    expect(view.entries[0]?.historyHref).toBe('/history/exercises/goblet-squat');
  });

  it('renders no history link when the slug is missing or malformed', () => {
    const badSlug: CompletedSessionDto['entries'] = [
      {
        authoredExerciseId: 'ex-099',
        source: 'template',
        performedExerciseId: 'ex-099',
        isSubstituted: false,
        isSkipped: false,
        exerciseOrder: 1,
        exerciseName: 'Odd Exercise',
        authoredExerciseName: 'Odd Exercise',
        exerciseSlug: 'Not_A_Valid_Slug',
        equipment: null,
        restSeconds: 60,
        prescription: { type: 'reps', sets: 2, minReps: 8, maxReps: 10 },
        sets: [],
      },
    ];
    const noSlugView = toCompletedSessionView(
      sessionDto({ entries: badSlug }),
    );
    expect(noSlugView.entries[0]?.historyHref).toBeNull();

    const unresolved = sessionDto({
      entries: [
        {
          authoredExerciseId: 'ex-404',
          source: 'template',
          performedExerciseId: 'ex-404',
          isSubstituted: false,
          isSkipped: false,
          exerciseOrder: 2,
          exerciseName: null,
          authoredExerciseName: null,
          exerciseSlug: null,
          equipment: null,
          restSeconds: 60,
          prescription: { type: 'reps', sets: 2, minReps: 8, maxReps: 10 },
          sets: [],
        },
      ],
    });
    const unresolvedView = toCompletedSessionView(unresolved);
    expect(unresolvedView.entries[0]?.historyHref).toBeNull();
  });

  // ─── Skipped occurrences (M10 Slice 7) ────────────────────────────────────
  //
  // The persisted isSkipped flag is authoritative; zero logged sets never
  // implies skipped. Skipped occurrences keep their persisted identity, lose
  // the performance-history link, and (when substituted) keep the
  // "Originally: …" authored context without implying performance.

  function skippedEntry(overrides?: {
    readonly performedExerciseId?: string;
    readonly exerciseName?: string | null;
    readonly authoredExerciseName?: string | null;
    readonly isSubstituted?: boolean;
    readonly exerciseSlug?: string | null;
    readonly exerciseOrder?: number;
  }): CompletedSessionDto['entries'][number] {
    return {
      authoredExerciseId: 'ex-002',
      source: 'template',
      performedExerciseId: overrides?.performedExerciseId ?? 'ex-008',
      isSubstituted: overrides?.isSubstituted ?? true,
      isSkipped: true,
      exerciseOrder: overrides?.exerciseOrder ?? 2,
      exerciseName:
        overrides?.exerciseName === undefined ? 'Dumbbell Bench Press' : overrides.exerciseName,
      authoredExerciseName:
        overrides?.authoredExerciseName === undefined
          ? 'Bench Press'
          : overrides.authoredExerciseName,
      exerciseSlug:
        overrides?.exerciseSlug === undefined ? 'dumbbell-bench-press' : overrides.exerciseSlug,
      equipment: 'dumbbell',
      restSeconds: 90,
      prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
      sets: [],
    };
  }

  it('keeps a substituted+skipped occurrence truthful: original context, no performance, no link', () => {
    const view = toCompletedSessionView(sessionDto({ entries: [skippedEntry()] }));
    const entry = view.entries[0];
    expect(entry?.isSkipped).toBe(true);
    // Occurrence identity: the currently selected exercise stays primary.
    expect(entry?.name).toBe('Dumbbell Bench Press');
    // Substituted: the authored identity remains available as context.
    expect(entry?.originallyName).toBe('Bench Press');
    // No performance: zero sets, no history-link affordance.
    expect(entry?.sets).toEqual([]);
    expect(entry?.historyHref).toBeNull();
  });

  it('renders a plain skipped occurrence without a redundant original label', () => {
    const view = toCompletedSessionView(
      sessionDto({
        entries: [
          skippedEntry({
            performedExerciseId: 'ex-002',
            exerciseName: 'Bench Press',
            authoredExerciseName: 'Bench Press',
            isSubstituted: false,
            exerciseSlug: 'bench-press',
          }),
        ],
      }),
    );
    const entry = view.entries[0];
    expect(entry?.isSkipped).toBe(true);
    expect(entry?.name).toBe('Bench Press');
    // Not substituted → no "Originally: …" line, per existing conventions.
    expect(entry?.originallyName).toBeNull();
    expect(entry?.historyHref).toBeNull();
    expect(entry?.sets).toEqual([]);
  });

  it('never infers skipped from zero logged sets (defensive empty occurrence)', () => {
    const zeroSet = skippedEntry({
      performedExerciseId: 'ex-002',
      exerciseName: 'Bench Press',
      authoredExerciseName: 'Bench Press',
      isSubstituted: false,
    });
    const notSkipped: CompletedSessionDto['entries'][number] = { ...zeroSet, isSkipped: false };
    const view = toCompletedSessionView(sessionDto({ entries: [notSkipped] }));
    const entry = view.entries[0];
    // Explicit skip state stays distinct from absence of logged work.
    expect(entry?.isSkipped).toBe(false);
    // A genuine (non-skipped) completed performance keeps its history link
    // even with zero sets — the skip gate is the flag, not the set count.
    expect(entry?.historyHref).toBe('/history/exercises/dumbbell-bench-press');
    expect(entry?.sets).toEqual([]);
  });

  it('suppresses the history link for a skipped occurrence even with a valid slug', () => {
    const view = toCompletedSessionView(sessionDto({ entries: [skippedEntry()] }));
    // Slug is valid — the skip gate, not slug resolution, removed the link.
    expect(view.entries[0]?.historyHref).toBeNull();
  });

  it('renders a reordered session in DTO array order without sorting', () => {
    // Final persisted order after "move B up": B(1), A(2), C(3). The view
    // model must pass the canonical array through untouched.
    const entries: CompletedSessionDto['entries'] = [
      { ...skippedEntry({ exerciseName: 'Dumbbell Bench Press' }), exerciseOrder: 1 },
      {
        authoredExerciseId: 'ex-001',
        source: 'template',
        performedExerciseId: 'ex-001',
        isSubstituted: false,
        isSkipped: false,
        exerciseOrder: 2,
        exerciseName: 'Goblet Squat',
        authoredExerciseName: 'Goblet Squat',
        exerciseSlug: 'goblet-squat',
        equipment: 'kettlebell',
        restSeconds: 90,
        prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
        sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: 7 }],
      },
      {
        authoredExerciseId: 'ex-015',
        source: 'template',
        performedExerciseId: 'ex-015',
        isSubstituted: false,
        isSkipped: false,
        exerciseOrder: 3,
        exerciseName: 'Plank',
        authoredExerciseName: 'Plank',
        exerciseSlug: 'dead-bug',
        equipment: 'bodyweight',
        restSeconds: 60,
        prescription: { type: 'duration', sets: 3, seconds: 45 },
        sets: [{ type: 'duration', setNumber: 1, durationSeconds: 45, weightKg: null, rpe: null }],
      },
    ];
    const view = toCompletedSessionView(sessionDto({ entries }));
    expect(view.entries.map((entry) => entry.name)).toEqual([
      'Dumbbell Bench Press',
      'Goblet Squat',
      'Plank',
    ]);
    // The array passed through untouched — persisted orders 1..3 in position.
    expect(view.entries.map((entry) => entry.exerciseOrder)).toEqual([1, 2, 3]);
    // The skipped occurrence keeps its neutral state at its new position.
    expect(view.entries[0]?.isSkipped).toBe(true);
    expect(view.entries[0]?.historyHref).toBeNull();
  });

  // ─── Substitution display (M9) ────────────────────────────────────────────

  describe('substitution context (M9)', () => {
    function substitutedEntry(overrides?: {
      readonly isSubstituted?: boolean;
      readonly performedExerciseId?: string;
      readonly exerciseName?: string | null;
      readonly authoredExerciseName?: string | null;
      readonly exerciseOrder?: number;
    }): CompletedSessionDto['entries'][number] {
      return {
        authoredExerciseId: 'ex-002',
        source: 'template',
        performedExerciseId: overrides?.performedExerciseId ?? 'ex-008',
        isSubstituted: overrides?.isSubstituted ?? true,
        isSkipped: false,
        exerciseOrder: overrides?.exerciseOrder ?? 1,
        exerciseName: overrides?.exerciseName === undefined ? 'Dumbbell Bench Press' : overrides.exerciseName,
        authoredExerciseName:
          overrides?.authoredExerciseName === undefined
            ? 'Goblet Squat'
            : overrides.authoredExerciseName,
        exerciseSlug: 'dumbbell-bench-press',
        equipment: 'dumbbell',
        restSeconds: 90,
        prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
        sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 30, rpe: null }],
      };
    }

    it('shows the performed name as the primary identity with the authored name as context', () => {
      const view = toCompletedSessionView(sessionDto({ entries: [substitutedEntry()] }));
      expect(view.entries[0]?.name).toBe('Dumbbell Bench Press');
      expect(view.entries[0]?.originallyName).toBe('Goblet Squat');
    });

    it('omits the "Originally" line for a non-substituted occurrence', () => {
      // Even when both names are available, only a substituted occurrence
      // carries the context line.
      const view = toCompletedSessionView(
        sessionDto({
          entries: [
            substitutedEntry({
              isSubstituted: false,
              performedExerciseId: 'ex-002',
              exerciseName: 'Goblet Squat',
              authoredExerciseName: 'Goblet Squat',
            }),
          ],
        }),
      );
      expect(view.entries[0]?.originallyName).toBeNull();
    });

    it('omits the "Originally" line when the authored metadata is unavailable', () => {
      // The authored exercise no longer resolves in the catalog: the line is
      // omitted — no fallback name is ever fabricated.
      const view = toCompletedSessionView(
        sessionDto({ entries: [substitutedEntry({ authoredExerciseName: null })] }),
      );
      expect(view.entries[0]?.originallyName).toBeNull();
      // The performed identity still renders (with its positional fallback
      // when even the performed name is unresolvable).
      const orphan = toCompletedSessionView(
        sessionDto({
          entries: [
            substitutedEntry({ exerciseName: null, authoredExerciseName: null, exerciseOrder: 3 }),
          ],
        }),
      );
      expect(orphan.entries[0]?.name).toBe('Exercise 3');
      expect(orphan.entries[0]?.originallyName).toBeNull();
    });

    it('names the FIRST authored exercise after a chained substitution', () => {
      // Goblet Squat (authored) → Dumbbell Bench Press → Push-up (performed):
      // authoredExerciseId is never rewritten, so the context line stays the
      // original authored exercise even after chained swaps.
      const view = toCompletedSessionView(
        sessionDto({
          entries: [
            substitutedEntry({
              exerciseName: 'Push-up',
              authoredExerciseName: 'Goblet Squat',
            }),
          ],
        }),
      );
      expect(view.entries[0]?.name).toBe('Push-up');
      expect(view.entries[0]?.originallyName).toBe('Goblet Squat');
    });
  });
});

// ─── M11 occurrence provenance in completed history ──────────────────────────

/**
 * A completed-session entry the user added during the workout. Defaults to a
 * performed-as-authored, non-skipped, logged occurrence; every field is
 * overridable so provenance can be exercised against substitution, skip and
 * zero-set states.
 */
function userAddedEntry(
  overrides: Partial<CompletedSessionDto['entries'][number]> = {},
): CompletedSessionDto['entries'][number] {
  return {
    authoredExerciseId: 'ex-100',
    performedExerciseId: 'ex-100',
    isSubstituted: false,
    isSkipped: false,
    source: 'user_added',
    exerciseOrder: 2,
    exerciseName: 'Face Pull',
    authoredExerciseName: 'Face Pull',
    exerciseSlug: 'face-pull',
    equipment: 'resistance-band',
    restSeconds: 0,
    prescription: { type: 'reps', sets: 3, minReps: 12, maxReps: 12 },
    sets: [{ type: 'reps', setNumber: 1, reps: 12, weightKg: 20, rpe: null }],
    ...overrides,
  };
}

describe('toCompletedSessionView — occurrence provenance (M11)', () => {
  it('labels only a persisted user-added occurrence', () => {
    const view = toCompletedSessionView(
      sessionDto({
        entries: [
          // Default fixture entry: template-authored.
          {
            authoredExerciseId: 'ex-001',
            performedExerciseId: 'ex-001',
            isSubstituted: false,
            isSkipped: false,
            source: 'template',
            exerciseOrder: 1,
            exerciseName: 'Goblet Squat',
            authoredExerciseName: 'Goblet Squat',
            exerciseSlug: 'goblet-squat',
            equipment: 'kettlebell',
            restSeconds: 90,
            prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
            sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: null }],
          },
          userAddedEntry(),
        ],
      }),
    );

    expect(view.entries.map((entry) => entry.provenanceLabel)).toEqual([
      null,
      ADDED_DURING_WORKOUT_LABEL,
    ]);
  });

  it('never infers provenance from order, identity or substitution state', () => {
    const view = toCompletedSessionView(
      sessionDto({
        entries: [
          // A SUBSTITUTED template occurrence: performed != authored, but the
          // persisted source still says template.
          {
            authoredExerciseId: 'ex-001',
            performedExerciseId: 'ex-008',
            isSubstituted: true,
            isSkipped: false,
            source: 'template',
            exerciseOrder: 1,
            exerciseName: 'Dumbbell Bench Press',
            authoredExerciseName: 'Goblet Squat',
            exerciseSlug: 'dumbbell-bench-press',
            equipment: 'dumbbell',
            restSeconds: 90,
            prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
            sets: [],
          },
          // A user-added occurrence at order 1 with identical identities.
          userAddedEntry({ exerciseOrder: 1 }),
        ],
      }),
    );

    expect(view.entries[0]?.provenanceLabel).toBeNull();
    expect(view.entries[0]?.originallyName).toBe('Goblet Squat');
    expect(view.entries[1]?.provenanceLabel).toBe(ADDED_DURING_WORKOUT_LABEL);
  });

  it('keeps the label on a SUBSTITUTED user-added occurrence, with truthful identities', () => {
    const view = toCompletedSessionView(
      sessionDto({
        entries: [
          userAddedEntry({
            performedExerciseId: 'ex-008',
            isSubstituted: true,
            exerciseName: 'Dumbbell Bench Press',
            authoredExerciseName: 'Face Pull',
            exerciseSlug: 'dumbbell-bench-press',
            equipment: 'dumbbell',
          }),
        ],
      }),
    );

    const entry = view.entries[0];
    // The replacement stays the primary identity; the originally added
    // exercise stays the context line; provenance survives both.
    expect(entry?.name).toBe('Dumbbell Bench Press');
    expect(entry?.originallyName).toBe('Face Pull');
    expect(entry?.provenanceLabel).toBe(ADDED_DURING_WORKOUT_LABEL);
  });

  it('keeps a SKIPPED user-added occurrence visible with the label and no performance link', () => {
    const view = toCompletedSessionView(
      sessionDto({
        entries: [userAddedEntry({ isSkipped: true, sets: [] })],
      }),
    );

    const entry = view.entries[0];
    expect(entry?.provenanceLabel).toBe(ADDED_DURING_WORKOUT_LABEL);
    expect(entry?.isSkipped).toBe(true);
    // Skipped: no performance-history link and no fabricated set output.
    expect(entry?.historyHref).toBeNull();
    expect(entry?.sets).toEqual([]);
  });

  it('keeps a zero-set NON-skipped user-added occurrence distinct from a skipped one', () => {
    const view = toCompletedSessionView(
      sessionDto({ entries: [userAddedEntry({ isSkipped: false, sets: [] })] }),
    );

    const entry = view.entries[0];
    expect(entry?.provenanceLabel).toBe(ADDED_DURING_WORKOUT_LABEL);
    // Zero sets never imply skipped: the durable link survives.
    expect(entry?.isSkipped).toBe(false);
    expect(entry?.historyHref).toBe('/history/exercises/face-pull');
  });
});
