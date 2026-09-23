/**
 * View-model tests for M12 Slice 4: attaching resolved historical record
 * events to the EXACT logged set that produced them.
 *
 * The mapper consumes the application layer's already-resolved events and
 * never compares values, inspects earlier sessions, or consults today's
 * personal bests — these tests lock that contract, including the historical
 * case where a record stands although a later (and higher) performance exists
 * outside this session.
 */

import { describe, expect, it, vi } from 'vitest';

import type { CompletedSessionDto } from '@/application/dto/completed-session';
import type { SessionRecordEventDto } from '@/application/dto/personal-records';

// The view module imports the feature composition root (DB client + env);
// these tests exercise the pure mapper only.
vi.mock('@/features/history/services', () => ({
  getCompletedSessionUseCase: { execute: vi.fn() },
  getCompletedSessionRecordEventsUseCase: { execute: vi.fn() },
}));

import { toCompletedSessionView } from '@/features/history/completed-session-view';

function entry(
  overrides: Partial<CompletedSessionDto['entries'][number]>,
): CompletedSessionDto['entries'][number] {
  return {
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
    prescription: { type: 'reps', sets: 3, minReps: 8, maxReps: 10 },
    sets: [
      { type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: null },
      { type: 'reps', setNumber: 2, reps: 10, weightKg: 50, rpe: null },
      { type: 'reps', setNumber: 3, reps: 10, weightKg: 55, rpe: null },
    ],
    restSeconds: 90,
    ...overrides,
  };
}

function sessionDto(
  entries: ReadonlyArray<CompletedSessionDto['entries'][number]>,
): CompletedSessionDto {
  return {
    sessionId: 'session-1',
    workoutName: 'Full Body A',
    programName: 'Fit40 Beginner Strength',
    startedAt: '2026-01-01T10:00:00.000Z',
    completedAt: '2026-01-01T10:45:00.000Z',
    entries,
    metrics: { totalSets: 3, totalReps: 30, totalDurationSeconds: 0, volume: 1550 },
  };
}

function recordEvent(overrides?: Partial<SessionRecordEventDto>): SessionRecordEventDto {
  return {
    exerciseOrder: 1,
    setNumber: 1,
    metric: 'max-load',
    value: 50,
    previousBest: null,
    ...overrides,
  };
}

/** The per-set indicator flags of the first entry, in rendered order. */
function flags(view: ReturnType<typeof toCompletedSessionView>): ReadonlyArray<boolean> {
  return (view.entries[0]?.sets ?? []).map((set) => set.isPersonalRecord);
}

describe('toCompletedSessionView — historical record events (M12 Slice 4)', () => {
  it('marks exactly the sets that established a record, not their equal siblings', () => {
    const view = toCompletedSessionView(sessionDto([entry({})]), [
      recordEvent({ setNumber: 1 }),
      recordEvent({ setNumber: 3, value: 55, previousBest: 50 }),
    ]);

    // Sets are 50, 50, 55: the first 50 and the 55 are records; the second 50
    // repeats an existing maximum and is not.
    expect(flags(view)).toEqual([true, false, true]);
    // The displayed values are untouched by the indicator.
    expect(view.entries[0]?.sets.map((set) => set.valueLabel)).toEqual([
      '50 kg × 10',
      '50 kg × 10',
      '55 kg × 10',
    ]);
  });

  it('leaves a record-free session exactly as before', () => {
    const view = toCompletedSessionView(sessionDto([entry({})]), []);

    expect(flags(view)).toEqual([false, false, false]);
  });

  it('keeps duplicate occurrences of one exercise distinct', () => {
    const entries = [
      entry({
        exerciseOrder: 1,
        sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 80, rpe: null }],
      }),
      entry({
        exerciseOrder: 2,
        sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 85, rpe: null }],
      }),
    ];

    const view = toCompletedSessionView(sessionDto(entries), [
      recordEvent({ exerciseOrder: 2, setNumber: 1, value: 85, previousBest: 80 }),
    ]);

    expect(view.entries.map((viewEntry) => viewEntry.sets.map((set) => set.isPersonalRecord))).toEqual([
      [false],
      [true],
    ]);
  });

  it('shows an old historical record even though a later, higher performance exists elsewhere', () => {
    // History: 50 -> 55 -> (later session) 60. This session's sets are
    // 50, 55, 52 — the events are what was true THEN.
    const entries = [
      entry({
        sets: [
          { type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: null },
          { type: 'reps', setNumber: 2, reps: 10, weightKg: 55, rpe: null },
          { type: 'reps', setNumber: 3, reps: 10, weightKg: 52, rpe: null },
        ],
      }),
    ];

    const view = toCompletedSessionView(sessionDto(entries), [
      recordEvent({ setNumber: 1, value: 50, previousBest: null }),
      recordEvent({ setNumber: 2, value: 55, previousBest: 50 }),
    ]);

    expect(flags(view)).toEqual([true, true, false]);
  });

  it('ignores an event that matches no logged set (never fabricates an indicator)', () => {
    const view = toCompletedSessionView(sessionDto([entry({})]), [
      recordEvent({ exerciseOrder: 9, setNumber: 1 }),
    ]);

    expect(flags(view)).toEqual([false, false, false]);
  });

  it('renders no indicator for a skipped occurrence, whose sets are absent by contract', () => {
    const view = toCompletedSessionView(sessionDto([entry({ isSkipped: true, sets: [] })]), [
      recordEvent({ setNumber: 1 }),
    ]);

    expect(view.entries[0]?.isSkipped).toBe(true);
    expect(view.entries[0]?.sets).toEqual([]);
  });

  it('keeps a substituted occurrence’s indicators, provenance and order intact', () => {
    const view = toCompletedSessionView(
      sessionDto([
        entry({
          authoredExerciseId: 'ex-001',
          performedExerciseId: 'ex-002',
          authoredExerciseName: 'Goblet Squat',
          exerciseName: 'Split Squat',
          isSubstituted: true,
          exerciseSlug: 'split-squat',
          exerciseOrder: 2,
          sets: [{ type: 'reps', setNumber: 1, reps: 8, weightKg: 30, rpe: null }],
        }),
      ]),
      [recordEvent({ exerciseOrder: 2, setNumber: 1, value: 30, previousBest: null })],
    );

    const viewEntry = view.entries[0];
    expect(viewEntry?.name).toBe('Split Squat');
    expect(viewEntry?.originallyName).toBe('Goblet Squat');
    expect(viewEntry?.sets[0]?.isPersonalRecord).toBe(true);
  });
});

describe('completed-session view — stable (exerciseOrder, setNumber) location', () => {
  it('badges only the matching set when one exercise appears twice in the session', () => {
    const view = toCompletedSessionView(
      sessionDto([
        entry({
          exerciseOrder: 1,
          sets: [{ type: 'reps', setNumber: 1, reps: 10, weightKg: 50, rpe: null }],
        }),
        entry({
          exerciseOrder: 2,
          sets: [{ type: 'reps', setNumber: 1, reps: 8, weightKg: 55, rpe: null }],
        }),
      ]),
      [recordEvent({ exerciseOrder: 2, setNumber: 1, value: 55, previousBest: 50 })],
    );

    // The event targets the second occurrence's exact location — the first
    // occurrence (same exercise, order 1) must stay unbadged.
    expect(view.entries[0]?.sets[0]?.isPersonalRecord ?? false).toBe(false);
    expect(view.entries[1]?.sets[0]?.isPersonalRecord).toBe(true);
  });
});
