/**
 * M18 Slice 5 correction — the UNCAPPED candidate collection over real
 * PostgreSQL.
 *
 * `findBestValuesBefore` must answer every candidate the caller supplies in ONE
 * batched statement. The M12 `VALUES` transport bound eight SQL parameters per
 * candidate, and the wire protocol caps a statement at 65,534 parameters, so
 * the uncapped M18 read failed at 8,192 candidates with
 * `MAX_PARAMETERS_EXCEEDED` (reproduced against PostgreSQL, postgres.js 3.4.9:
 * 8,192 × 8 = 65,536 > 65,534) instead of returning the exact answer.
 *
 * This regression therefore runs with MORE candidates than that ceiling, on a
 * fixture whose expected priors are exact and independently checkable, and it
 * pins the two properties that make the fix real: one statement, and a
 * parameter count that does not grow with the collection.
 *
 * Expectations come from the established Domain oracle where a full answer is
 * needed: `foldPersonalRecords` over the user's complete history. The fixture's
 * own data is a strictly increasing per-exercise ladder with ONE repeated final
 * set, so the expected prior of a candidate is the ladder value immediately
 * before it, and the earliest-equal ownership rule has a real tie to resolve at
 * scale.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import type { WorkoutSession } from '@/domain/entities/workout-session';
import {
  comparePerformancePositions,
  RecordMetric,
} from '@/domain/services/personal-record-metrics';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import { foldPersonalRecords, resolveRecordEvents } from '@/domain/services/personal-records';
import type { ExerciseId } from '@/domain/types/ids';

import {
  createQueryCountingRepository,
  exerciseId,
  prCandidate,
  prSession,
  savePrSessions,
  seedUser,
  userId,
} from './personal-record-fixtures';
import {
  closeDatabase,
  db,
  personalRecordRepository,
  resetAndSeed,
  trainingHistoryRepository,
} from './setup';

const OWNER = 'user-pr-capacity';
const AT = '2026-01-01T10:00:00.000Z';

/** Eight seeded catalog exercises — enough breadth for the ladder to be real. */
const BULK_EXERCISES = [
  'ex-001',
  'ex-002',
  'ex-003',
  'ex-004',
  'ex-005',
  'ex-006',
  'ex-007',
  'ex-008',
] as const;

const SETS_PER_OCCURRENCE = 8;
const SESSION_COUNT = 130;
const CANDIDATES_PER_SESSION = BULK_EXERCISES.length * SETS_PER_OCCURRENCE;
const VALUES_PER_EXERCISE = SESSION_COUNT * SETS_PER_OCCURRENCE;
const CANDIDATE_COUNT = BULK_EXERCISES.length * VALUES_PER_EXERCISE;
/** The reproduced failure threshold: 8 parameters per candidate is exactly 8,192. */
const PARAMETER_CEILING_CANDIDATES = 8191;

function at<T>(items: ReadonlyArray<T>, index: number): T {
  const value = items[index];
  if (value === undefined) throw new Error(`missing item at index ${index}`);
  return value;
}

/**
 * One exercise's whole history: 10 kg → 1,048 kg strictly increasing, then ONE
 * repeat of the maximum. The repeat is the earliest-equal tie (it establishes
 * no event) and gives the ladder a non-strict step at its end.
 */
const LADDER: ReadonlyArray<number> = buildLadder();

function buildLadder(): ReadonlyArray<number> {
  const values: number[] = [];
  for (let index = 0; index < VALUES_PER_EXERCISE - 1; index += 1) {
    values.push(10 + index);
  }
  values.push(at(values, values.length - 1));
  return values;
}

const TOP_VALUE = at(LADDER, VALUES_PER_EXERCISE - 2);
const LAST_SESSION_ID = sessionIdOf(SESSION_COUNT - 1);
/** Eight repeated final sets: the ladder's only non-events. */
const EXPECTED_EVENT_COUNT = CANDIDATE_COUNT - BULK_EXERCISES.length;

function sessionIdOf(sessionIndex: number): string {
  return `bulk-${String(sessionIndex).padStart(3, '0')}`;
}

function instantOf(sessionIndex: number, offsetMs = 0): Date {
  return new Date(Date.parse(AT) + sessionIndex * 60_000 + offsetMs);
}

/** 130 detached sessions: 8 occurrences × 8 sets each, on identical ladders. */
function bulkSessions(): ReadonlyArray<WorkoutSession> {
  return Array.from({ length: SESSION_COUNT }, (_unused, sessionIndex) =>
    prSession({
      id: sessionIdOf(sessionIndex),
      userId: OWNER,
      startedAt: instantOf(sessionIndex, -30 * 60_000).toISOString(),
      completedAt: instantOf(sessionIndex).toISOString(),
      logs: BULK_EXERCISES.map((exercise) => ({
        exerciseId: exercise,
        type: 'reps' as const,
        sets: Array.from({ length: SETS_PER_OCCURRENCE }, (_ignored, setIndex) => ({
          reps: 8,
          weightKg: at(LADDER, sessionIndex * SETS_PER_OCCURRENCE + setIndex),
        })),
      })),
    }),
  );
}

/** The same 8,320 candidates, in the Domain's own chronological ladder order. */
function bulkCandidates(): ReadonlyArray<RecordCandidate> {
  const candidates: RecordCandidate[] = [];
  for (let sessionIndex = 0; sessionIndex < SESSION_COUNT; sessionIndex += 1) {
    for (const [exerciseIndex, exercise] of BULK_EXERCISES.entries()) {
      for (let setIndex = 0; setIndex < SETS_PER_OCCURRENCE; setIndex += 1) {
        candidates.push(
          prCandidate({
            exerciseId: exercise,
            metric: RecordMetric.MaxLoad,
            value: at(LADDER, sessionIndex * SETS_PER_OCCURRENCE + setIndex),
            completedAt: instantOf(sessionIndex).toISOString(),
            startedAt: instantOf(sessionIndex, -30 * 60_000).toISOString(),
            sessionId: sessionIdOf(sessionIndex),
            exerciseOrder: exerciseIndex + 1,
            setNumber: setIndex + 1,
          }),
        );
      }
    }
  }
  return candidates;
}

/** The ladder index of the candidate at `index` (all exercises share a ladder). */
function ladderIndexOf(index: number): number {
  const sessionIndex = Math.floor(index / CANDIDATES_PER_SESSION);
  return sessionIndex * SETS_PER_OCCURRENCE + (index % SETS_PER_OCCURRENCE);
}

function owner() {
  return userId(OWNER);
}


describe('personal record repository — uncapped candidate collection', () => {
  beforeAll(async () => {
    await resetAndSeed();
    await seedUser(OWNER);
    await savePrSessions(...bulkSessions());
    // Statistics for the rows this fixture just bulk-inserted: the plan for the
    // regression must not depend on when background autovacuum happens to run.
    await db.execute(sql`analyze workout_sessions, exercise_logs, set_logs`);
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('answers every candidate above the reproduced ceiling in one statement', async () => {
    const candidates = bulkCandidates();
    expect(candidates).toHaveLength(CANDIDATE_COUNT);
    expect(CANDIDATE_COUNT).toBeGreaterThan(PARAMETER_CEILING_CANDIDATES);

    const counting = createQueryCountingRepository();
    try {
      // Warm up: the driver's first statement is its own type discovery.
      await counting.repository.findBestValuesBefore(owner(), candidates.slice(0, 3));
      const warmUpParameters = at(counting.parameterCounts, counting.parameterCounts.length - 1);

      const before = counting.queries.length;
      const prior = await counting.repository.findBestValuesBefore(owner(), candidates);
      const statements = counting.queries.length - before;
      const parameters = at(counting.parameterCounts, counting.parameterCounts.length - 1);

      // No MAX_PARAMETERS_EXCEEDED (the call resolved at all), one statement,
      // and every candidate inside it: the payload parameter plus the user id.
      expect(statements).toBe(1);
      expect(parameters).toBe(2);
      expect(parameters).toBe(warmUpParameters);
      expect(prior).toHaveLength(CANDIDATE_COUNT);
    } finally {
      await counting.close();
    }
  });

  it('returns exact priors, ladder ordering and earliest-equal ownership at scale', async () => {
    const candidates = bulkCandidates();
    const prior = await personalRecordRepository.findBestValuesBefore(owner(), candidates);

    // All candidates returned, positionally aligned with the input, each paired
    // with the very object that was passed in.
    expect(prior).toHaveLength(CANDIDATE_COUNT);
    for (const index of [0, 1, 1039, 1040, CANDIDATE_COUNT - 2, CANDIDATE_COUNT - 1]) {
      expect(at(prior, index).candidate).toBe(at(candidates, index));
    }

    // Exact prior values for EVERY candidate: the ladder is non-decreasing per
    // exercise, so the value immediately before a candidate is its maximum.
    expect(prior.map((entry) => entry.bestBefore)).toEqual(
      candidates.map((_candidate, index) => {
        const ladderIndex = ladderIndexOf(index);
        return ladderIndex === 0 ? null : at(LADDER, ladderIndex - 1);
      }),
    );

    // Ordering: the input IS the complete position ladder (a date-only or
    // insertion-order sort would break this) and the `ord asc` output stayed
    // aligned with it.
    expect(
      candidates.filter(
        (candidate, index) =>
          index > 0 &&
          comparePerformancePositions(at(candidates, index - 1).position, candidate.position) >= 0,
      ),
    ).toEqual([]);

    // Event resolution at scale: every candidate is a first exposure or
    // strictly greater than its prior except the eight repeated final sets.
    const events = resolveRecordEvents(prior);
    expect(events).toHaveLength(EXPECTED_EVENT_COUNT);

    const sessions = await trainingHistoryRepository.listCompletedSessionsSince(
      owner(),
      new Date(0), new Date('9999-01-01T00:00:00.000Z'));
    const folded = foldPersonalRecords(sessions);
    if (!folded.ok) throw new Error(folded.error.message);
    expect(sessions).toHaveLength(SESSION_COUNT);
    expect(events).toEqual(folded.data.events);

    // Ownership through the optimized current-best query, against the oracle:
    // the maximum is set twice per exercise, and the EARLIER position owns it.
    const requested: ReadonlyArray<ExerciseId> = BULK_EXERCISES.map(exerciseId);
    const sqlBests = await personalRecordRepository.findCurrentPersonalBests(owner(), requested);
    expect(sqlBests).toEqual(folded.data.currentBests);
    expect(sqlBests).toHaveLength(BULK_EXERCISES.length);
    for (const best of sqlBests) {
      expect(best.value).toBe(TOP_VALUE);
      expect(best.position.sessionId).toBe(LAST_SESSION_ID);
      expect(best.position.setNumber).toBe(SETS_PER_OCCURRENCE - 1);
    }
  });
});
