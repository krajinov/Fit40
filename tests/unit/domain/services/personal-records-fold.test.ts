/**
 * M12 chronological fold: historical events, deterministic position order,
 * current personal bests, the completed-only boundary, and independence from
 * the M8 progression engine.
 */

import { describe, expect, it } from 'vitest';

import type { Exercise } from '@/domain/entities/exercise';
import type { SetLog, WorkoutSession } from '@/domain/entities/workout-session';
import { calculateNextExerciseTarget } from '@/domain/services/exercise-progression';
import { foldPersonalRecords } from '@/domain/services/personal-records';
import { Difficulty, EquipmentType, MovementPattern, MuscleGroup } from '@/domain/types/exercise';
import {
  bestLines,
  completedSession,
  eid,
  eventLines,
  fold,
  inProgressSession,
  loadSession,
  reps,
} from './personal-records.fixtures';

// ─── Completed-only boundary ─────────────────────────────────────────────────

describe('foldPersonalRecords — completed-only boundary', () => {
  it('rejects the fold when any session is still in progress', () => {
    const completed = completedSession({
      id: 's-done',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 60 }] }],
    });
    const inProgress = inProgressSession({
      id: 's-ongoing',
      startedAt: '2025-01-02T09:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 90 }] }],
    });

    const result = foldPersonalRecords([completed, inProgress]);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the fold to reject an in-progress session');
    expect(result.error.code).toBe('SESSION_NOT_COMPLETED');
  });

  it('folds an empty history into no events and no bests', () => {
    expect(fold([])).toEqual({ events: [], currentBests: [] });
  });
});

// ─── Chronological fold: historical events ───────────────────────────────────

describe('foldPersonalRecords — historical events', () => {
  it('emits the first exposure as the first event', () => {
    const session = loadSession('s-1', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 60);

    expect(eventLines(fold([session]).events)).toEqual(['ex-a/max-load/60/prev:none@s-1.1.1']);
  });

  it('emits every strictly increasing performance, in chronological order', () => {
    const first = loadSession('s-1', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 60);
    const second = loadSession('s-2', '2025-01-03T09:00:00Z', '2025-01-03T10:00:00Z', 70);
    const lower = loadSession('s-3', '2025-01-05T09:00:00Z', '2025-01-05T10:00:00Z', 65);
    const third = loadSession('s-4', '2025-01-07T09:00:00Z', '2025-01-07T10:00:00Z', 75);

    // Input order is deliberately not chronological.
    expect(eventLines(fold([third, second, first, lower]).events)).toEqual([
      'ex-a/max-load/60/prev:none@s-1.1.1',
      'ex-a/max-load/70/prev:60@s-2.1.1',
      'ex-a/max-load/75/prev:70@s-4.1.1',
    ]);
  });

  it('emits no event for a value equal to the best before it', () => {
    const first = loadSession('s-1', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 60);
    const equal = loadSession('s-2', '2025-01-02T09:00:00Z', '2025-01-02T10:00:00Z', 60);

    expect(eventLines(fold([first, equal]).events)).toEqual(['ex-a/max-load/60/prev:none@s-1.1.1']);
  });

  it('emits no event for a value lower than the best before it', () => {
    const best = loadSession('s-1', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 80);
    const lower = loadSession('s-2', '2025-01-02T09:00:00Z', '2025-01-02T10:00:00Z', 70);

    expect(eventLines(fold([best, lower]).events)).toEqual(['ex-a/max-load/80/prev:none@s-1.1.1']);
  });

  it('emits events for increases inside one occurrence, in set order', () => {
    const session = completedSession({
      id: 's-sets',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-a',
          sets: [
            { type: 'reps', reps: 8, weightKg: 60 },
            { type: 'reps', reps: 8, weightKg: 70 },
            { type: 'reps', reps: 8, weightKg: 65 },
          ],
        },
      ],
    });

    expect(eventLines(fold([session]).events)).toEqual([
      'ex-a/max-load/60/prev:none@s-sets.1.1',
      'ex-a/max-load/70/prev:60@s-sets.1.2',
    ]);
  });

  it('keeps duplicate occurrences of one exercise as separate performances', () => {
    const repeated = completedSession({
      id: 's-repeat',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 80 }] },
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 80 }] },
      ],
    });

    // The second occurrence repeats the weight: no event, and the first
    // occurrence keeps ownership.
    expect(eventLines(fold([repeated]).events)).toEqual([
      'ex-a/max-load/80/prev:none@s-repeat.1.1',
    ]);
    expect(bestLines(fold([repeated]))).toEqual(['ex-a/max-load/80@s-repeat.1.1']);
  });

  it('lets a heavier later occurrence of the same session beat the earlier one', () => {
    const repeated = completedSession({
      id: 's-repeat',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 80 }] },
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 85 }] },
      ],
    });

    expect(eventLines(fold([repeated]).events)).toEqual([
      'ex-a/max-load/80/prev:none@s-repeat.1.1',
      'ex-a/max-load/85/prev:80@s-repeat.2.1',
    ]);
  });

  it('ignores zero-set and skipped occurrences while folding other sessions', () => {
    const withInactive = completedSession({
      id: 's-inactive',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 60 }] },
        { authored: 'ex-zero-set' },
        { authored: 'ex-skipped', isSkipped: true },
      ],
    });
    const performed = completedSession({
      id: 's-performed',
      startedAt: '2025-01-02T09:00:00Z',
      completedAt: '2025-01-02T10:00:00Z',
      logs: [{ authored: 'ex-zero-set', sets: [{ type: 'reps', reps: 8, weightKg: 30 }] }],
    });

    expect(eventLines(fold([withInactive, performed]).events)).toEqual([
      'ex-a/max-load/60/prev:none@s-inactive.1.1',
      'ex-zero-set/max-load/30/prev:none@s-performed.1.1',
    ]);
  });
});

// ─── Chronological fold: deterministic order ─────────────────────────────────

describe('foldPersonalRecords — deterministic position order', () => {
  it('orders sessions by completedAt regardless of input order', () => {
    const later = loadSession('s-later', '2025-01-04T09:00:00Z', '2025-01-05T10:00:00Z', 100);
    const earlier = loadSession('s-earlier', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 90);

    expect(eventLines(fold([later, earlier]).events)).toEqual([
      'ex-a/max-load/90/prev:none@s-earlier.1.1',
      'ex-a/max-load/100/prev:90@s-later.1.1',
    ]);
  });

  it('breaks equal completedAt by startedAt', () => {
    const startedFirst = loadSession('s-z', '2025-01-01T08:00:00Z', '2025-01-01T10:00:00Z', 100);
    const startedSecond = loadSession('s-a', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 100);

    expect(eventLines(fold([startedSecond, startedFirst]).events)).toEqual([
      'ex-a/max-load/100/prev:none@s-z.1.1',
    ]);
    expect(bestLines(fold([startedSecond, startedFirst]))).toEqual(['ex-a/max-load/100@s-z.1.1']);
  });

  it('breaks identical timestamps by session id', () => {
    const sessionB = loadSession('s-b', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 100);
    const sessionA = loadSession('s-a', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 100);

    expect(eventLines(fold([sessionB, sessionA]).events)).toEqual([
      'ex-a/max-load/100/prev:none@s-a.1.1',
    ]);
    expect(bestLines(fold([sessionB, sessionA]))).toEqual(['ex-a/max-load/100@s-a.1.1']);
  });

  it('breaks within-session ties by exercise order, then set number', () => {
    const session = completedSession({
      id: 's-tie',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 80 }] },
        {
          authored: 'ex-a',
          sets: [
            { type: 'reps', reps: 8, weightKg: 80 },
            { type: 'reps', reps: 8, weightKg: 80 },
          ],
        },
      ],
    });

    expect(eventLines(fold([session]).events)).toEqual([
      'ex-a/max-load/80/prev:none@s-tie.1.1',
    ]);
    expect(bestLines(fold([session]))).toEqual(['ex-a/max-load/80@s-tie.1.1']);
  });
});

// ─── Chronological fold: current personal bests ──────────────────────────────

describe('foldPersonalRecords — current personal bests', () => {
  it('makes the first eligible performance the best', () => {
    const only = loadSession('s-1', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 60);

    expect(bestLines(fold([only]))).toEqual(['ex-a/max-load/60@s-1.1.1']);
  });

  it('replaces the best only when a later performance is strictly greater', () => {
    const first = loadSession('s-1', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 60);
    const higher = loadSession('s-2', '2025-01-02T09:00:00Z', '2025-01-02T10:00:00Z', 70);
    const lower = loadSession('s-3', '2025-01-03T09:00:00Z', '2025-01-03T10:00:00Z', 65);

    expect(bestLines(fold([first, higher, lower]))).toEqual(['ex-a/max-load/70@s-2.1.1']);
  });

  it('keeps the earliest owner of an equal all-time maximum', () => {
    const owner = loadSession('s-first', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 80);
    const tie = loadSession('s-later', '2025-01-05T09:00:00Z', '2025-01-05T10:00:00Z', 80);

    expect(bestLines(fold([tie, owner]))).toEqual(['ex-a/max-load/80@s-first.1.1']);
  });

  it('keeps a 0 kg best instead of treating it as a missing value', () => {
    const zero = completedSession({
      id: 's-zero',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 12, weightKg: 0 }] }],
    });
    const zeroAgain = completedSession({
      id: 's-zero-again',
      startedAt: '2025-01-02T09:00:00Z',
      completedAt: '2025-01-02T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 20, weightKg: 0 }] }],
    });

    expect(bestLines(fold([zero, zeroAgain]))).toEqual(['ex-a/max-load/0@s-zero.1.1']);
    expect(eventLines(fold([zero, zeroAgain]).events)).toEqual([
      'ex-a/max-load/0/prev:none@s-zero.1.1',
    ]);
  });

  it('tracks the metrics of one exercise independently', () => {
    const early = completedSession({
      id: 's-1',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-a',
          sets: [
            { type: 'reps', reps: 10, weightKg: 60 },
            { type: 'reps', reps: 14, weightKg: null },
          ],
        },
      ],
    });
    const later = completedSession({
      id: 's-2',
      startedAt: '2025-01-02T09:00:00Z',
      completedAt: '2025-01-02T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 16, weightKg: 65 }] }],
    });

    // The heavier loaded set advances max-load only; the unloaded best stands.
    expect(bestLines(fold([early, later]))).toEqual([
      'ex-a/max-bodyweight-reps/14@s-1.1.2',
      'ex-a/max-load/65@s-2.1.1',
    ]);
  });

  it('tracks exercises independently and in canonical order', () => {
    const session = completedSession({
      id: 's-1',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        { authored: 'ex-z', sets: [{ type: 'reps', reps: 5, weightKg: 100 }] },
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 5, weightKg: null }] },
      ],
    });

    expect(bestLines(fold([session]))).toEqual([
      'ex-a/max-bodyweight-reps/5@s-1.2.1',
      'ex-z/max-load/100@s-1.1.1',
    ]);
  });

  it('agrees with the last event of every (exercise, metric) pair', () => {
    const first = completedSession({
      id: 's-1',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-a',
          sets: [
            { type: 'reps', reps: 10, weightKg: 60 },
            { type: 'reps', reps: 12, weightKg: null },
          ],
        },
        {
          authored: 'ex-carry',
          prescription: 'duration',
          sets: [{ type: 'duration', durationSeconds: 30 }],
        },
      ],
    });
    const second = completedSession({
      id: 's-2',
      startedAt: '2025-01-02T09:00:00Z',
      completedAt: '2025-01-02T10:00:00Z',
      logs: [
        { authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg: 70 }] },
        {
          authored: 'ex-carry',
          prescription: 'duration',
          sets: [{ type: 'duration', durationSeconds: 45 }],
        },
      ],
    });
    const third = completedSession({
      id: 's-3',
      startedAt: '2025-01-03T09:00:00Z',
      completedAt: '2025-01-03T10:00:00Z',
      logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 20, weightKg: null }] }],
    });

    const history = fold([third, second, first]);

    const lastEventPerKey = new Map<string, string>();
    for (const event of history.events) {
      const key = `${event.exerciseId}/${event.metric}`;
      lastEventPerKey.set(
        key,
        `${key}/${event.value}@${event.position.sessionId}.${event.position.exerciseOrder}.${event.position.setNumber}`,
      );
    }

    expect(bestLines(history).slice().sort()).toEqual([...lastEventPerKey.values()].sort());
    expect(history.events).toHaveLength(6);
    expect(history.currentBests).toHaveLength(3);
  });
});

// ─── Purity and M8 progression independence ──────────────────────────────────

describe('personal records — purity and progression independence', () => {
  it('does not mutate or reorder the sessions it folds', () => {
    const later = loadSession('s-later', '2025-01-02T09:00:00Z', '2025-01-02T10:00:00Z', 80);
    const earlier = loadSession('s-earlier', '2025-01-01T09:00:00Z', '2025-01-01T10:00:00Z', 70);
    const input: ReadonlyArray<WorkoutSession> = [later, earlier];
    const snapshot = input.map((session) => structuredClone(session));

    fold(input);

    expect(input).toEqual(snapshot);
  });

  it('leaves the M8 progression decision untouched by record semantics', () => {
    function exercise(): Exercise {
      return {
        id: eid('ex-engine'),
        name: 'Engine Squat',
        slug: 'engine-squat',
        description: 'Guard exercise for progression independence.',
        primaryMuscle: MuscleGroup.Quadriceps,
        secondaryMuscles: [],
        equipment: EquipmentType.Dumbbell,
        difficulty: Difficulty.Beginner,
        movementPattern: MovementPattern.Squat,
        considerations: [],
      };
    }

    function repSet(setNumber: number, weightKg: number | null, repsCount = 10): SetLog {
      return { type: 'reps', setNumber, reps: repsCount, weightKg, rpe: null };
    }

    const session = completedSession({
      id: 's-engine',
      startedAt: '2025-01-01T09:00:00Z',
      completedAt: '2025-01-01T10:00:00Z',
      logs: [
        {
          authored: 'ex-engine',
          sets: [
            { type: 'reps', reps: 10, weightKg: 50 },
            { type: 'reps', reps: 10, weightKg: 50 },
            { type: 'reps', reps: 10, weightKg: 50 },
          ],
        },
      ],
    });

    // The performance is a record-worthy first exposure...
    expect(eventLines(fold([session]).events)).toEqual([
      'ex-engine/max-load/50/prev:none@s-engine.1.1',
    ]);

    // ...and the engine still decides exactly as it did before M12: all sets
    // at the top of the range on a uniform load increase by the 2 kg step.
    expect(
      calculateNextExerciseTarget(exercise(), reps(), [
        {
          prescription: reps(),
          sets: [repSet(1, 50), repSet(2, 50), repSet(3, 50)],
        },
      ]),
    ).toEqual({
      basis: 'increase',
      reason: 'all-sets-at-top-of-range',
      previousLoadKg: 50,
      nextLoadKg: 52,
      incrementKg: 2,
    });

    // Unloaded sets still route to the bodyweight decision, never to a record.
    expect(
      calculateNextExerciseTarget(exercise(), reps(), [
        { prescription: reps(), sets: [repSet(1, null)] },
      ]).basis,
    ).toBe('bodyweight-hold');
  });
});


