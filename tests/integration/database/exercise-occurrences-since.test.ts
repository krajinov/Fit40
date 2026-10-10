/**
 * M18 Slice 8 — the period-scoped occurrence read behind the first-vs-latest
 * working-load comparison (`docs/training-progress.md` §7).
 *
 * The subject is the split the memo locks: the comparison is scoped to the fixed
 * 13-week UTC horizon and evaluated over UNCAPPED history, while the screen's
 * occurrences stay bounded to the newest 50. These tests therefore seed periods
 * that are larger than the display window, span the horizon's inclusive Monday
 * boundary, and mix attached, detached, bodyweight and timed occurrences.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { GetExerciseHistoryUseCase } from '@/application/use-cases/get-exercise-history';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import * as schema from '@/infrastructure/database/schema';
import { DrizzleExerciseRepository } from '@/infrastructure/database/repositories/drizzle-exercise-repository';
import { DrizzlePersonalRecordRepository } from '@/infrastructure/database/repositories/drizzle-personal-record-repository';
import { DrizzleTrainingHistoryRepository } from '@/infrastructure/database/repositories/drizzle-training-history-repository';

import {
  exerciseId,
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

const OWNER = 'user-since';
const ENROLLMENT = 'enrollment-since';
const EX_GOBLET = 'ex-002';
const SLUG = 'goblet-squat';

/** A Thursday: the fixed 13-week horizon starts Monday 2026-06-29T00:00Z. */
const HISTORY_NOW = new Date('2026-09-24T10:00:00.000Z');
const HORIZON_START = new Date('2026-06-29T00:00:00.000Z');

const useCase = new GetExerciseHistoryUseCase(
  trainingHistoryRepository,
  exerciseRepository,
  personalRecordRepository,
);

/** One completed occurrence of the goblet squat with explicit set weights. */
function occurrence(input: {
  readonly id: string;
  readonly completedAt: string;
  readonly weights: ReadonlyArray<number | null>;
  readonly enrollmentId?: string;
  readonly exerciseOrder?: number;
}): WorkoutSession {
  const startedAt = new Date(Date.parse(input.completedAt) - 3_600_000).toISOString();
  const log = {
    exerciseId: EX_GOBLET,
    type: 'reps' as const,
    sets: input.weights.map((weightKg) => ({ reps: 8, weightKg })),
  };
  return prSession({
    id: input.id,
    userId: OWNER,
    ...(input.enrollmentId === undefined ? {} : { enrollmentId: input.enrollmentId }),
    startedAt,
    completedAt: input.completedAt,
    logs: [log],
  });
}

/**
 * The period fixture: one occurrence BEFORE the horizon, the boundary
 * occurrence exactly at its Monday 00:00, a same-session duplicate pair, a
 * detached late occurrence, and unloaded occurrences that must not participate.
 */
async function seedPeriodHistory(): Promise<void> {
  await savePrSessions(
    occurrence({ id: 'before-horizon', completedAt: '2026-06-28T23:59:59.000Z', weights: [10] }),
    occurrence({
      id: 'at-horizon',
      completedAt: '2026-06-29T00:00:00.000Z',
      weights: [20],
      enrollmentId: ENROLLMENT,
    }),
    occurrence({ id: 'dup-session-a', completedAt: '2026-08-10T10:00:00.000Z', weights: [18] }),
    occurrence({ id: 'dup-session-b', completedAt: '2026-08-10T10:00:00.000Z', weights: [19] }),
    occurrence({ id: 'bodyweight-only', completedAt: '2026-09-01T10:00:00.000Z', weights: [null] }),
    // Detached: its late 22.5 kg must be the comparison's latest.
    occurrence({ id: 'detached-late', completedAt: '2026-09-20T10:00:00.000Z', weights: [22.5] }),
  );
}

beforeEach(async () => {
  await resetAndSeed();
  await seedUser(OWNER);
  await seedEnrollment(ENROLLMENT, OWNER, 'prog-beginner-strength');
  await seedPeriodHistory();
});

afterAll(async () => {
  await closeDatabase();
});


describe('listCompletedExerciseOccurrencesSince — the period read', () => {
  it('includes the inclusive Monday boundary and orders by the comparison ladder', async () => {
    const rows = await trainingHistoryRepository.listCompletedExerciseOccurrencesSince(
      userId(OWNER),
      exerciseId('ex-002'),
      HORIZON_START, new Date('2026-09-28T00:00:00.000Z'));

    // `before-horizon` completed one second before the period: excluded.
    // Everything else is in, ordered ascending by completedAt, startedAt,
    // sessionId, exerciseOrder — never by load.
    expect(rows.map((row) => `${row.sessionId}#${row.exerciseOrder}`)).toEqual([
      'at-horizon#1',
      'dup-session-a#1',
      'dup-session-b#1',
      'bodyweight-only#1',
      'detached-late#1',
    ]);
    // The unloaded and the detached occurrences ARE occurrences of the period:
    // eligibility is the Domain's decision, not this read's.
    expect(rows.find((row) => row.sessionId === 'detached-late')?.sets[0]?.weightKg).toBe(22.5);
    expect(rows.find((row) => row.sessionId === 'bodyweight-only')?.sets[0]?.weightKg).toBeNull();
  });

  it('returns an empty period without querying sets', async () => {
    const rows = await trainingHistoryRepository.listCompletedExerciseOccurrencesSince(
      userId('user-with-no-history'),
      exerciseId('ex-002'),
      HORIZON_START, new Date('2026-09-28T00:00:00.000Z'));

    expect(rows).toEqual([]);
  });
});

describe('exercise history — the period comparison over real rows', () => {
  it('compares first and latest inside the horizon while the window keeps the older row', async () => {
    const result = await useCase.execute({ userId: OWNER, slug: SLUG, now: HISTORY_NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The display window is all-time: it still carries the pre-horizon row …
    expect(result.data.entries.map((entry) => entry.sessionId)).toContain('before-horizon');
    // … which the period comparison excludes (its first is the 20 kg boundary
    // occurrence, not the older 10 kg one).
    expect(result.data.comparison).toEqual({
      status: 'compared',
      first: { loadKg: 20, completedAt: '2026-06-29T00:00:00.000Z' },
      // The detached 22.5 kg occurrence counts as the period's latest.
      latest: { loadKg: 22.5, completedAt: '2026-09-20T10:00:00.000Z' },
      direction: 'increased',
    });
  });

  it('ignores bodyweight occurrences inside the period', async () => {
    // Only the unloaded occurrence is in the period: no comparison is possible,
    // and the honest reason is the "no external load" one (§7.6).
    await resetAndSeed();
    await seedUser(OWNER);
    await seedEnrollment(ENROLLMENT, OWNER, 'prog-beginner-strength');
    await savePrSessions(
      occurrence({
        id: 'bodyweight-only',
        completedAt: '2026-09-01T10:00:00.000Z',
        weights: [null],
      }),
    );

    const result = await useCase.execute({ userId: OWNER, slug: SLUG, now: HISTORY_NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.data.comparison).toEqual({
      status: 'insufficient',
      reason: 'no_external_load',
    });
    // The occurrence itself is still a real, displayed occurrence.
    expect(result.data.entries.map((entry) => entry.sessionId)).toEqual(['bodyweight-only']);
  });
});


describe('exercise history — the comparison is independent of the display bound', () => {
  it('uses the full horizon when more than 50 occurrences are period-eligible', async () => {
    await resetAndSeed();
    await seedUser(OWNER);
    await seedEnrollment(ENROLLMENT, OWNER, 'prog-beginner-strength');

    // 60 daily occurrences, all inside the 13-week horizon, loads rising by
    // 0.5 kg from 10 kg — more than the newest-50 display window.
    const baseMs = Date.parse('2026-07-01T10:00:00.000Z');
    const sessions = Array.from({ length: 60 }, (_unused, index) =>
      occurrence({
        id: `day-${String(index + 1).padStart(2, '0')}`,
        completedAt: new Date(baseMs + index * 86_400_000).toISOString(),
        weights: [10 + index * 0.5],
      }),
    );
    await savePrSessions(...sessions);

    const result = await useCase.execute({ userId: OWNER, slug: SLUG, now: HISTORY_NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    // The screen stays bounded …
    expect(result.data.entries).toHaveLength(50);
    expect(result.data.isLimited).toBe(true);
    // … and its oldest displayed row is day-11, so day-01 is not on screen.
    expect(result.data.entries.map((entry) => entry.sessionId)).not.toContain('day-01');
    // The comparison nevertheless uses the full period: first = day-01 (10 kg),
    // latest = day-60 (39.5 kg). A display-derived comparison could not.
    expect(result.data.comparison).toEqual({
      status: 'compared',
      first: { loadKg: 10, completedAt: '2026-07-01T10:00:00.000Z' },
      latest: {
        loadKg: 39.5,
        completedAt: new Date(baseMs + 59 * 86_400_000).toISOString(),
      },
      direction: 'increased',
    });
  });
});

describe('exercise history — bounded statements', () => {
  it('answers a small and a sprawling period with the same statement count', async () => {
    const counting = createCountingUseCase();
    try {
      // Warm up: the driver's first statement is its own type discovery.
      await counting.useCase.execute({ userId: OWNER, slug: SLUG, now: HISTORY_NOW });

      const beforeSmall = counting.queries.length;
      await counting.useCase.execute({ userId: OWNER, slug: SLUG, now: HISTORY_NOW });
      const small = counting.queries.length - beforeSmall;

      // A period far larger than the display window.
      await savePrSessions(
        ...Array.from({ length: 40 }, (_unused, index) =>
          occurrence({
            id: `extra-${String(index).padStart(2, '0')}`,
            completedAt: new Date(
              Date.parse('2026-08-01T10:00:00.000Z') + index * 3_600_000,
            ).toISOString(),
            weights: [30 + index],
          }),
        ),
      );
      const beforeLarge = counting.queries.length;
      await counting.useCase.execute({ userId: OWNER, slug: SLUG, now: HISTORY_NOW });
      const large = counting.queries.length - beforeLarge;

      // Slug + window rows + window sets + records + period rows + period sets +
      // the one batched prior-best read. Growth adds data, never statements.
      expect(small).toBe(7);
      expect(large).toBe(7);
    } finally {
      await counting.close();
    }
  });
});

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
