/**
 * M18 Slice 5 — the Progress PR-event read model over real PostgreSQL.
 *
 * Proves the pipeline end to end, not just the orchestration: candidate origin
 * is the 13-week horizon while prior-best answers stay user-global (history
 * older than the horizon AND detached history both count), the exact event
 * count is computed before the newest-N display selection, still-stands is
 * resolved by current-PB ownership, substitutions credit the performed
 * exercise, and the whole read stays within a bounded number of statements
 * regardless of how much history the user holds.
 *
 * The expected events come from the established Domain oracle:
 * `foldPersonalRecords` over the user's COMPLETE eligible history, filtered to
 * the horizon's sessions. There is no second PR implementation in this file and
 * no M18-specific PR SQL.
 *
 * A catalog-UNRESOLVED persisted identity is not representable here — the
 * exercise_id column is an FK into `exercises` — so the unit suite pins that
 * omission rule with a stubbed catalog instead.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import { PROGRESS_RECORD_EVENT_LIMIT } from '@/application/dto/training-progress';
import { GetTrainingProgressRecordEventsUseCase } from '@/application/use-cases/get-training-progress-record-events';
import type { WorkoutSession } from '@/domain/entities/workout-session';
import { comparePerformancePositions } from '@/domain/services/personal-record-metrics';
import { foldPersonalRecords } from '@/domain/services/personal-records';
import { listRecentTrainingWeekWindows } from '@/domain/services/training-week';
import * as schema from '@/infrastructure/database/schema';
import { DrizzleExerciseRepository } from '@/infrastructure/database/repositories/drizzle-exercise-repository';
import { DrizzlePersonalRecordRepository } from '@/infrastructure/database/repositories/drizzle-personal-record-repository';
import { DrizzleTrainingHistoryRepository } from '@/infrastructure/database/repositories/drizzle-training-history-repository';

import { prSession, seedEnrollment, seedUser, userId } from './personal-record-fixtures';
import { insertSession } from './session-fixtures';
import {
  closeDatabase,
  exerciseRepository,
  personalRecordRepository,
  resetAndSeed,
  trainingHistoryRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';

const OWNER = 'user-progress-rec';
const ENROLLMENT = 'enrollment-progress-rec';

/** A Thursday: the current UTC week starts 2026-09-21. */
const NOW = new Date('2026-09-24T10:00:00.000Z');
const HORIZON = listRecentTrainingWeekWindows(NOW, 13);

function item<T>(items: ReadonlyArray<T>, index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`missing item at index ${index}`);
  return value;
}

/** The inclusive candidate-origin bound: the oldest window's Monday 00:00. */
const SINCE = item(HORIZON, 0).weekStart;

const useCase = new GetTrainingProgressRecordEventsUseCase(
  trainingHistoryRepository,
  personalRecordRepository,
  exerciseRepository,
);

/** The M12 fold oracle, unwrapped (a fold failure is a test-fixture bug). */
function oracleOf(sessions: ReadonlyArray<WorkoutSession>) {
  const folded = foldPersonalRecords(sessions);
  if (!folded.ok) throw new Error(folded.error.message);
  return folded.data;
}

async function saveAll(...sessions: WorkoutSession[]): Promise<void> {
  for (const session of sessions) {
    await insertSession(session);
  }
}

/** `${exerciseId}/${metric}/${value}<-${previousBest}` — one event's identity. */
function eventLine(event: {
  readonly exerciseId: string;
  readonly metric: string;
  readonly value: number;
  readonly previousBest: number | null;
}): string {
  return `${event.exerciseId}/${event.metric}/${event.value}<-${event.previousBest ?? 'none'}`;
}

/**
 * An isolated pool whose driver reports every statement it executes, with the
 * PRODUCTION use case over counting copies of all three repositories, so the
 * whole read's statement count is observable (the M14/M16 counter idiom).
 */
async function withCountingUseCase<T>(
  run: (countingUseCase: GetTrainingProgressRecordEventsUseCase, queries: string[]) => Promise<T>,
): Promise<T> {
  const queries: string[] = [];
  const countingClient = postgres(getTestDatabaseUrl(), {
    max: 1,
    // Simple protocol: one driver callback per executed statement.
    prepare: false,
    debug: (_connection, query) => {
      queries.push(query);
    },
  });

  try {
    const countingDb = drizzle(countingClient, { schema });
    const countingUseCase = new GetTrainingProgressRecordEventsUseCase(
      new DrizzleTrainingHistoryRepository(countingDb),
      new DrizzlePersonalRecordRepository(countingDb),
      new DrizzleExerciseRepository(countingDb),
    );
    return await run(countingUseCase, queries);
  } finally {
    await countingClient.end();
  }
}

beforeEach(async () => {
  await resetAndSeed();
  await seedUser(OWNER);
  await seedEnrollment(ENROLLMENT, OWNER, 'prog-beginner-strength');
});

const EX_GOBLET = 'ex-002';
const EX_SPLIT = 'ex-003';
const EX_PUSH_UP = 'ex-007';

/**
 * The horizon fixture: dataset D (20 → 22.5 → equal 22.5 → 25), a detached
 * session with its own exercise (K), and a substituted occurrence whose
 * performed exercise is the goblet squat. The 20 kg prior sits OUTSIDE the
 * horizon, so it can only reach the horizon through the user-global read.
 */
async function seedHorizonHistory(): Promise<ReadonlyArray<WorkoutSession>> {
  const sessions: WorkoutSession[] = [
    prSession({
      id: 'rec-outside',
      userId: OWNER,
      startedAt: '2026-05-01T08:00:00.000Z',
      completedAt: '2026-05-01T09:00:00.000Z',
      logs: [{ exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
    }),
    prSession({
      id: 'rec-w6',
      userId: OWNER,
      enrollmentId: ENROLLMENT,
      occurrence: 0,
      startedAt: '2026-08-05T08:00:00.000Z',
      completedAt: '2026-08-05T09:00:00.000Z',
      logs: [{ exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 8, weightKg: 22.5 }] }],
    }),
    prSession({
      // DETACHED: left program, still counted, and it still owns a best.
      id: 'rec-detached',
      userId: OWNER,
      startedAt: '2026-08-12T08:00:00.000Z',
      completedAt: '2026-08-12T09:00:00.000Z',
      logs: [{ exerciseId: EX_SPLIT, type: 'reps', sets: [{ reps: 8, weightKg: 40 }] }],
    }),
    prSession({
      // The EQUAL 22.5: strictly-greater only, so never a second event.
      id: 'rec-w8',
      userId: OWNER,
      enrollmentId: ENROLLMENT,
      occurrence: 1,
      startedAt: '2026-08-19T08:00:00.000Z',
      completedAt: '2026-08-19T09:00:00.000Z',
      logs: [{ exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 8, weightKg: 22.5 }] }],
    }),
    prSession({
      id: 'rec-w9',
      userId: OWNER,
      enrollmentId: ENROLLMENT,
      occurrence: 2,
      startedAt: '2026-08-26T08:00:00.000Z',
      completedAt: '2026-08-26T09:00:00.000Z',
      logs: [{ exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 8, weightKg: 25 }] }],
    }),
    prSession({
      // SUBSTITUTED: authored split squat, performed goblet squat.
      id: 'rec-sub',
      userId: OWNER,
      enrollmentId: ENROLLMENT,
      occurrence: 3,
      startedAt: '2026-09-02T08:00:00.000Z',
      completedAt: '2026-09-02T09:00:00.000Z',
      logs: [
        {
          exerciseId: EX_SPLIT,
          performedExerciseId: EX_GOBLET,
          type: 'reps',
          sets: [{ reps: 8, weightKg: 27.5 }],
        },
      ],
    }),
  ];
  await saveAll(...sessions);
  return sessions;
}

describe('progress record events (M18 Slice 5) — PostgreSQL pipeline + M12 oracle', () => {
  it('resolves the horizon’s events with user-global priors and current-PB ownership', async () => {
    const sessions = await seedHorizonHistory();

    const result = await useCase.execute({ userId: OWNER, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recordEventCount).toBe(4);
    // Ascending by the M12 ladder; the equal 22.5 is absent, and the
    // out-of-horizon 20 kg appears only as context.
    expect(result.data.events.map(eventLine)).toEqual([
      'ex-002/max-load/22.5<-20',
      'ex-003/max-load/40<-none',
      'ex-002/max-load/25<-22.5',
      'ex-002/max-load/27.5<-25',
    ]);
    expect(result.data.events.map((event) => event.sessionId)).toEqual([
      'rec-w6',
      'rec-detached',
      'rec-w9',
      'rec-sub',
    ]);
    // Ownership: surpassed, standing (detached!), surpassed, standing.
    expect(result.data.events.map((event) => event.stillStanding)).toEqual([
      false,
      true,
      false,
      true,
    ]);
    expect(result.data.events[0]?.exerciseName).toBe('Goblet Squat');
    expect(result.data.events[0]?.exerciseSlug).toBe('goblet-squat');
    expect(result.data.events[0]?.completedAt).toBe('2026-08-05T09:00:00.000Z');

    // Oracle: `foldPersonalRecords` over COMPLETE history (the out-of-horizon
    // 20 kg prior included), filtered to the horizon's sessions.
    const horizonIds = new Set(
      sessions.filter((session) => session.id !== 'rec-outside').map((session) => String(session.id)),
    );
    const oracle = oracleOf(sessions);
    const oracleEvents = oracle.events
      .filter((event) => horizonIds.has(String(event.position.sessionId)))
      .slice()
      .sort((a, b) => comparePerformancePositions(a.position, b.position));
    expect(oracleEvents.map(eventLine)).toEqual(result.data.events.map(eventLine));

    // Cross-check still-stands against the fold's own current bests.
    for (const event of result.data.events) {
      const currentBest = oracle.currentBests.find(
        (best) => String(best.exerciseId) === event.exerciseId && best.metric === event.metric,
      );
      expect(event.stillStanding).toBe(
        currentBest !== undefined &&
          currentBest.value === event.value &&
          String(currentBest.position.sessionId) === event.sessionId,
      );
    }
  });
});

describe('progress record events (M18 Slice 5) — horizon edges and empty windows', () => {
  it('includes a session completed exactly at the horizon edge and excludes earlier ones', async () => {
    await saveAll(
      prSession({
        id: 'rec-at-since',
        userId: OWNER,
        startedAt: '2026-06-28T22:00:00.000Z',
        completedAt: SINCE.toISOString(),
        logs: [{ exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 8, weightKg: 15 }] }],
      }),
      prSession({
        id: 'rec-before-since',
        userId: OWNER,
        startedAt: '2026-06-28T08:00:00.000Z',
        completedAt: '2026-06-28T23:59:59.999Z',
        logs: [{ exerciseId: EX_PUSH_UP, type: 'reps', sets: [{ reps: 20, weightKg: 5 }] }],
      }),
    );

    const rows = await trainingHistoryRepository.listCompletedSessionsSince(userId(OWNER), SINCE, new Date('2026-09-28T00:00:00.000Z'));
    expect(rows.map((row) => String(row.id))).toEqual(['rec-at-since']);

    const result = await useCase.execute({ userId: OWNER, now: NOW });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    // Only the in-range session is a candidate, and its 15 kg is a first
    // exposure: the excluded session contributes nothing to the period.
    expect(result.data.recordEventCount).toBe(1);
    expect(result.data.events[0]?.sessionId).toBe('rec-at-since');
    expect(result.data.events[0]?.previousBest).toBeNull();
  });

  it('answers an empty window without inventing events', async () => {
    const result = await useCase.execute({ userId: OWNER, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data).toEqual({ recordEventCount: 0, events: [] });
  });
});

describe('progress record events (M18 Slice 5) — exact count beyond the display limit', () => {
  it('counts every event and displays only the newest ten', async () => {
    const loads = [20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];
    const sessions = loads.map((load, index) => {
      const day = String(index + 1).padStart(2, '0');
      // Detached sessions may reuse one occurrence template: the
      // (enrollment, occurrence) uniqueness treats NULL enrollments as
      // distinct, so twelve instants need no extra template identity.
      return prSession({
        id: `rec-cap-${index}`,
        userId: OWNER,
        startedAt: `2026-07-${day}T08:00:00.000Z`,
        completedAt: `2026-07-${day}T09:00:00.000Z`,
        logs: [{ exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 8, weightKg: load }] }],
      });
    });
    await saveAll(...sessions);

    const result = await useCase.execute({ userId: OWNER, now: NOW });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.recordEventCount).toBe(12);
    expect(result.data.events).toHaveLength(PROGRESS_RECORD_EVENT_LIMIT);
    // The newest ten, ascending: the two oldest events drop out of the list.
    expect(result.data.events[0]?.value).toBe(22);
    expect(result.data.events.at(-1)?.value).toBe(31);
    expect(result.data.events.at(-1)?.stillStanding).toBe(true);
    expect(result.data.events.slice(0, -1).every((event) => !event.stillStanding)).toBe(true);

    // The oracle agrees: the exact count is a property of history, not a cap.
    expect(oracleOf(sessions).events).toHaveLength(12);
  });
});

describe('progress record events (M18 Slice 5) — bounded statements', () => {
  it('answers any window size with the same bounded number of statements', async () => {
    await saveAll(
      prSession({
        id: 'rec-count-1',
        userId: OWNER,
        startedAt: '2026-08-05T08:00:00.000Z',
        completedAt: '2026-08-05T09:00:00.000Z',
        logs: [{ exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 8, weightKg: 20 }] }],
      }),
    );

    await withCountingUseCase(async (countingUseCase, queries) => {
      // Warm-up (connection setup statements never count towards the read).
      await countingUseCase.execute({ userId: OWNER, now: NOW });

      // An empty window is answered by the candidate read alone.
      const beforeEmpty = queries.length;
      await countingUseCase.execute({ userId: 'user-progress-rec-empty', now: NOW });
      expect(queries.length - beforeEmpty).toBe(1);

      const beforeOne = queries.length;
      await countingUseCase.execute({ userId: OWNER, now: NOW });
      const oneSession = queries.length - beforeOne;

      await saveAll(
        prSession({
          id: 'rec-count-2',
          userId: OWNER,
          startedAt: '2026-08-07T08:00:00.000Z',
          completedAt: '2026-08-07T09:00:00.000Z',
          logs: [{ exerciseId: EX_GOBLET, type: 'reps', sets: [{ reps: 8, weightKg: 22 }] }],
        }),
        prSession({
          id: 'rec-count-3',
          userId: OWNER,
          startedAt: '2026-08-09T08:00:00.000Z',
          completedAt: '2026-08-09T09:00:00.000Z',
          logs: [{ exerciseId: EX_SPLIT, type: 'reps', sets: [{ reps: 8, weightKg: 30 }] }],
        }),
      );

      const beforeThree = queries.length;
      await countingUseCase.execute({ userId: OWNER, now: NOW });
      const threeSessions = queries.length - beforeThree;

      // Constant and bounded: candidate hydration (3 batched statements) +
      // prior bests (1) + current bests (1) + catalog names (1) — never one
      // statement per session or per event.
      expect(oneSession).toBe(6);
      expect(threeSessions).toBe(oneSession);

      // ... and the read really did return three sessions' worth of candidates.
      const wide = await countingUseCase.execute({ userId: OWNER, now: NOW });
      expect(wide.ok).toBe(true);
      if (!wide.ok) return;
      expect(wide.data.recordEventCount).toBe(3);
    });
  });
});

afterAll(async () => {
  await closeDatabase();
});
