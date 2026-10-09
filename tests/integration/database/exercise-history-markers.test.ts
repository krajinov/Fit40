/**
 * M18 Slice 7 — exercise-history personal-record markers over real PostgreSQL
 * (`docs/training-progress.md` §8.6).
 *
 * Proves the composed read, not just the orchestration: the displayed window's
 * logged sets become M12 candidates, ONE batched `findBestValuesBefore`
 * evaluates them against COMPLETE user-global history (detached sessions
 * included), and only resolved `max-load` events mark their occurrence.
 *
 * The expected markers come from the established Domain oracle —
 * `foldPersonalRecords` over the user's complete history — restricted to the
 * occurrences the screen can mark. That also demonstrates the memo's split:
 * an event OUTSIDE the displayed window is still resolved (detection is
 * user-global) but has no point to mark (presentation is bounded).
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { ExerciseHistoryTrendPointDto } from '@/application/dto/exercise-history';
import { EXERCISE_HISTORY_OCCURRENCE_LIMIT } from '@/application/dto/exercise-history';
import { GetExerciseHistoryUseCase } from '@/application/use-cases/get-exercise-history';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import { foldPersonalRecords } from '@/domain/services/personal-records';
import * as schema from '@/infrastructure/database/schema';
import { DrizzleExerciseRepository } from '@/infrastructure/database/repositories/drizzle-exercise-repository';
import { DrizzlePersonalRecordRepository } from '@/infrastructure/database/repositories/drizzle-personal-record-repository';
import { DrizzleTrainingHistoryRepository } from '@/infrastructure/database/repositories/drizzle-training-history-repository';

import {
  prSession,
  savePrSessions,
  seedEnrollment,
  seedUser,
  userId,
} from './personal-record-fixtures';
import {
  closeDatabase,
  exerciseRepository,
  personalRecordRepository,
  resetAndSeed,
  trainingHistoryRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'user-markers';
const ENROLLMENT = 'enrollment-markers';

const EX_GOBLET = 'ex-002';
const EX_ROMANIAN_DEADLIFT = 'ex-004';
const EX_PUSH_UP = 'ex-007';

/** The out-of-window history: an attached 40 kg and a DETACHED 44 kg. */
const EARLY_ATTACHED_KG = 40;
const EARLY_DETACHED_KG = 44;

/** The displayed window's decisive values. */
const BELOW_KG = 30;
const BELOW_SESSION_COUNT = 46;
const NEW_BEST_KG = 45;
const HEAVIEST_KG = 47.5;

const WINDOW_SESSION_COUNT = 50;
const WINDOW_START_MS = Date.parse('2025-02-02T10:00:00.000Z');
const MS_PER_WEEK = 7 * 86_400_000;

const useCase = new GetExerciseHistoryUseCase(
  trainingHistoryRepository,
  exerciseRepository,
  personalRecordRepository,
);

function windowId(index: number): string {
  return `w${String(index).padStart(2, '0')}`;
}

/**
 * The displayed window, oldest → newest: 46 low sessions, then the equal-to-
 * prior 44 kg, then the 45 kg that beats it (its own equal repeat included),
 * then the multi-set session whose second set is the new heaviest, and finally
 * a session repeating that heaviest value.
 */
function windowSessions(): ReadonlyArray<WorkoutSession> {
  const lows = Array.from({ length: BELOW_SESSION_COUNT }, (_unused, index) =>
    windowSession(index + 1, [BELOW_KG]),
  );
  return [
    ...lows,
    windowSession(47, [EARLY_DETACHED_KG]),
    windowSession(48, [NEW_BEST_KG]),
    windowSession(49, [NEW_BEST_KG, HEAVIEST_KG]),
    windowSession(50, [HEAVIEST_KG]),
  ];
}

function windowSession(index: number, weights: ReadonlyArray<number>): WorkoutSession {
  return session({
    id: windowId(index),
    exerciseId: EX_GOBLET,
    completedAt: new Date(WINDOW_START_MS + (index - 1) * MS_PER_WEEK),
    weights,
  });
}

/** One completed session of one exercise, optionally attached to a program. */
function session(input: {
  readonly id: string;
  readonly exerciseId: string;
  readonly completedAt: Date;
  readonly weights: ReadonlyArray<number | null>;
  readonly enrollmentId?: string;
}): WorkoutSession {
  return prSession({
    id: input.id,
    userId: OWNER,
    ...(input.enrollmentId === undefined ? {} : { enrollmentId: input.enrollmentId }),
    startedAt: new Date(input.completedAt.getTime() - 3_600_000).toISOString(),
    completedAt: input.completedAt.toISOString(),
    logs: [
      {
        exerciseId: input.exerciseId,
        type: 'reps',
        sets: input.weights.map((weightKg) => ({ reps: 8, weightKg })),
      },
    ],
  });
}


/** Seeds the whole scenario: the early pair plus the 50-session window. */
async function seedMarkerHistory(): Promise<void> {
  await savePrSessions(
    session({
      id: 'early-attached',
      exerciseId: EX_GOBLET,
      completedAt: new Date('2025-01-05T10:00:00.000Z'),
      weights: [EARLY_ATTACHED_KG],
      enrollmentId: ENROLLMENT,
    }),
    // Detached history (no enrollment): it is the user's training past and it
    // gates every later comparison exactly like attached history.
    session({
      id: 'early-detached',
      exerciseId: EX_GOBLET,
      completedAt: new Date('2025-01-12T10:00:00.000Z'),
      weights: [EARLY_DETACHED_KG],
    }),
    ...windowSessions(),
  );
}

/** Every completed session, hydrated through the real history read port. */
async function hydrateCompletedHistory(): Promise<ReadonlyArray<WorkoutSession>> {
  return trainingHistoryRepository.listCompletedSessionsSince(userId(OWNER), new Date(0));
}

/**
 * The M12 oracle: the fold's `max-load` events keyed by occurrence identity,
 * carrying the heaviest event of each occurrence.
 */
async function oracleMaxLoadEvents(): Promise<ReadonlyMap<string, number>> {
  const folded = foldPersonalRecords(await hydrateCompletedHistory());
  if (!folded.ok) throw new Error(folded.error.message);

  const byOccurrence = new Map<string, number>();
  for (const event of folded.data.events) {
    if (event.metric !== 'max-load') continue;
    const key = `${event.position.sessionId}#${event.position.exerciseOrder}`;
    const current = byOccurrence.get(key);
    if (current === undefined || event.value > current) {
      byOccurrence.set(key, event.value);
    }
  }
  return byOccurrence;
}

/** The markers the screen renders, keyed the same way as the oracle. */
function renderedMarkers(
  trend: ReadonlyArray<ExerciseHistoryTrendPointDto>,
): ReadonlyMap<string, number> {
  const byOccurrence = new Map<string, number>();
  for (const point of trend) {
    if (point.recordKg === null) continue;
    byOccurrence.set(`${point.sessionId}#${point.exerciseOrder}`, point.recordKg);
  }
  return byOccurrence;
}

/** An isolated pool whose driver reports every statement the read executes. */
function createCountingUseCase() {
  const queries: string[] = [];
  const client = postgres(getTestDatabaseUrl(), {
    max: 1,
    // Simple protocol: one driver callback per executed statement.
    prepare: false,
    debug: (_connection, query) => {
      queries.push(query);
    },
  });

  return {
    useCase: new GetExerciseHistoryUseCase(
      new DrizzleTrainingHistoryRepository(drizzle(client, { schema })),
      new DrizzleExerciseRepository(drizzle(client, { schema })),
      new DrizzlePersonalRecordRepository(drizzle(client, { schema })),
    ),
    queries,
    close: async () => {
      await client.end();
    },
  };
}

beforeEach(async () => {
  await resetAndSeed();
  await seedUser(OWNER);
  await seedEnrollment(ENROLLMENT, OWNER, 'prog-beginner-strength');
  await seedMarkerHistory();
});

afterAll(async () => {
  await closeDatabase();
});

describe('exercise history markers — the displayed window over real history', () => {
  it('agrees with the M12 fold oracle and marks only the resolved events', async () => {
    const result = await useCase.execute({ userId: OWNER, slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const markers = renderedMarkers(result.data.trend);
    const oracle = await oracleMaxLoadEvents();

    // Exactly the two events the ladder produces inside the window: the 45 kg
    // that beats the 44 kg prior, and the multi-set session whose 47.5 kg set
    // follows its own equal 45 kg.
    expect([...markers.entries()]).toEqual([
      ['w48#1', NEW_BEST_KG],
      ['w49#1', HEAVIEST_KG],
    ]);
    // The displayed markers ARE the oracle's events restricted to the window:
    // no fabricated marker, no missing one.
    expect([...markers.entries()].sort()).toEqual(
      [...oracle.entries()].filter(([key]) => key.startsWith('w')).sort(),
    );
  });

  it('never marks an equal value: the 44 kg prior and a repeated best stay unmarked', async () => {
    const result = await useCase.execute({ userId: OWNER, slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const pointAt = (sessionId: string) =>
      result.data.trend.find((point) => point.sessionId === sessionId);
    // w47 logs exactly the prior's 44 kg; w50 repeats the 47.5 kg that already
    // stands — equal is not strictly greater (M12 earliest-equal ownership).
    expect(pointAt('w47')?.workingLoadKg).toBe(EARLY_DETACHED_KG);
    expect(pointAt('w47')?.recordKg).toBeNull();
    expect(pointAt('w50')?.workingLoadKg).toBe(HEAVIEST_KG);
    expect(pointAt('w50')?.recordKg).toBeNull();
    // The multi-set session carries ONE marker: the heaviest event it holds.
    expect(pointAt('w49')?.workingLoadKg).toBe(NEW_BEST_KG);
    expect(pointAt('w49')?.recordKg).toBe(HEAVIEST_KG);
    expect(result.data.trend).toHaveLength(WINDOW_SESSION_COUNT);
  });

  it('keeps the 50-occurrence display bound while detecting over complete history', async () => {
    const result = await useCase.execute({ userId: OWNER, slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.entries).toHaveLength(EXERCISE_HISTORY_OCCURRENCE_LIMIT);
    expect(result.data.isLimited).toBe(true);
    // The two earliest occurrences are outside the displayed window …
    const displayedIds = new Set(result.data.entries.map((entry) => entry.sessionId));
    expect(displayedIds.has('early-attached')).toBe(false);
    expect(displayedIds.has('early-detached')).toBe(false);

    // … yet their events are resolved, because detection is user-global: the
    // oracle holds them, and they are precisely why later points stay unmarked.
    const oracle = await oracleMaxLoadEvents();
    expect(oracle.get('early-detached#1')).toBe(EARLY_DETACHED_KG);
    expect(oracle.get('early-attached#1')).toBe(EARLY_ATTACHED_KG);
  });
});



describe('exercise history markers — first exposure, unloaded history, bounded reads', () => {
  it('lets DETACHED history gate a displayed point instead of marking it', async () => {
    const result = await useCase.execute({ userId: OWNER, slug: 'goblet-squat' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // w47 logs exactly the detached prior's 44 kg: equal is not strictly
    // greater, so the detached 44 kg keeps the record and no marker appears.
    const equalPoint = result.data.trend.find((point) => point.sessionId === 'w47');
    expect(equalPoint?.workingLoadKg).toBe(EARLY_DETACHED_KG);
    expect(equalPoint?.recordKg).toBeNull();
    // The detached session's OWN event still exists in the complete history —
    // it is the prior, not a display row.
    expect((await oracleMaxLoadEvents()).get('early-detached#1')).toBe(EARLY_DETACHED_KG);
  });

  it('marks a first-ever eligible max-load occurrence for an exercise with no prior history', async () => {
    await savePrSessions(
      session({
        id: 'rdl-first',
        exerciseId: EX_ROMANIAN_DEADLIFT,
        completedAt: new Date('2025-03-01T10:00:00.000Z'),
        weights: [20],
      }),
    );

    const result = await useCase.execute({
      userId: OWNER,
      slug: 'dumbbell-romanian-deadlift',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.trend).toHaveLength(1);
    expect(result.data.trend[0]?.recordKg).toBe(20);
    expect(result.data.isLimited).toBe(false);
  });

  it('never marks bodyweight occurrences, which carry no trend point at all', async () => {
    await savePrSessions(
      session({
        id: 'push-up-a',
        exerciseId: EX_PUSH_UP,
        completedAt: new Date('2025-03-01T10:00:00.000Z'),
        weights: [null],
      }),
      session({
        id: 'push-up-b',
        exerciseId: EX_PUSH_UP,
        completedAt: new Date('2025-03-08T10:00:00.000Z'),
        weights: [null],
      }),
    );

    const result = await useCase.execute({ userId: OWNER, slug: 'push-up' });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // Both occurrences are real (they hold logged sets) and their own
    // bodyweight-rep events exist — but the trend plots only externally loaded
    // occurrences, so there is nothing to mark.
    expect(result.data.entries).toHaveLength(2);
    expect(result.data.trend).toEqual([]);
    expect(renderedMarkers(result.data.trend).size).toBe(0);
  });
});

describe('exercise history markers — bounded statements', () => {
  it('answers a loaded window and an empty one with a constant statement count', async () => {
    const counting = createCountingUseCase();
    try {
      // Warm up: the driver's first statement is its own type discovery.
      await counting.useCase.execute({ userId: OWNER, slug: 'goblet-squat' });

      const beforeLoaded = counting.queries.length;
      await counting.useCase.execute({ userId: OWNER, slug: 'goblet-squat' });
      const loaded = counting.queries.length - beforeLoaded;

      const beforeEmpty = counting.queries.length;
      await counting.useCase.execute({ userId: OWNER, slug: 'glute-bridge' });
      const empty = counting.queries.length - beforeEmpty;

      // Loaded: the slug lookup + occurrences + their sets + current records +
      // the ONE batched prior-best read — never one statement per occurrence.
      expect(loaded).toBe(5);
      // No occurrences: the slug lookup, the occurrence read and the records
      // read only (the prior-best read is skipped rather than issued empty).
      expect(empty).toBe(3);
    } finally {
      await counting.close();
    }
  });
});
