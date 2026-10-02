/**
 * M17 closure-facts projection — the read-only RunClosureFactsRepository port
 * on real PostgreSQL.
 *
 * Port contract: ONE statement returns BOTH execution-fact sets of one run —
 * the completed authored occurrences and the recorded not-performed facts —
 * from a single coherent snapshot, enrollment-scoped (detached history and
 * other runs are excluded structurally), each set ordered deterministically
 * by `scheduled_workout_id`. The concurrency guarantee itself is proven by
 * `run-closure-snapshot.test.ts`; this suite pins the factual contract.
 */

import { sql } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { ScheduledWorkout } from '@/domain/entities/training-program';
import { insertWorkoutSessionRows } from '@/infrastructure/database/repositories/workout-session-writes';

import {
  completedOccurrenceSession,
  insertFactRaw,
  seedCompletedOccurrenceSession,
} from './not-performed-race-fixtures';
import {
  enrollmentIdValue,
  listOccurrences,
  scheduledWorkoutIdValue,
  seedEnrolledRun,
} from './planned-workout-fixtures';
import { closeDatabase, db, resetAndSeed, runClosureFactsRepository } from './setup';

const OWNER = 'm17-closure-facts-owner';
const OTHER_OWNER = 'm17-closure-facts-other-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-closure-facts-a';
const OTHER_RUN_ID = 'enr-m17-closure-facts-b';
const RUN = enrollmentIdValue(RUN_ID);

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** The authored occurrence's template workout id, or a loud failure. */
function workoutIdOf(occurrence: ScheduledWorkout | undefined) {
  if (occurrence === undefined) throw new Error('expected the authored occurrence');
  return occurrence.workoutId;
}

/** Completes one authored occurrence with a real session row and children. */
async function completeOccurrence(
  enrollmentId: string,
  owner: string,
  occurrence: ScheduledWorkout | undefined,
): Promise<void> {
  if (occurrence === undefined) throw new Error('expected the authored occurrence');
  await seedCompletedOccurrenceSession({
    id: `${enrollmentId}-completed-${occurrence.id}`,
    owner,
    enrollmentId: enrollmentIdValue(enrollmentId),
    scheduledWorkoutId: occurrence.id,
    workoutId: occurrence.workoutId,
  });
}

/** Records one fact through the same statement shape the settlement writes. */
async function recordFact(enrollmentId: string, occurrenceId: string): Promise<void> {
  await db.transaction((tx) =>
    insertFactRaw(tx, {
      enrollmentId: enrollmentIdValue(enrollmentId),
      scheduledWorkoutId: occurrenceId,
    }),
  );
}

describe('DrizzleRunClosureFactsRepository — the closure-facts projection', () => {
  it('projects both fact sets of the run, each ordered by occurrence id', async () => {
    const run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
    const [first, second, third] = run.occurrenceIds;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('expected at least three authored occurrences');
    }
    const occurrences = listOccurrences(run.program);

    // Seeded out of order on purpose: the order comes from the projection,
    // never from write order.
    await completeOccurrence(RUN_ID, OWNER, occurrences[2]);
    await completeOccurrence(RUN_ID, OWNER, occurrences[0]);
    await recordFact(RUN_ID, second);

    const facts = await runClosureFactsRepository.listClosureFactsByEnrollment(RUN);

    expect(facts).toEqual({
      completedIds: [scheduledWorkoutIdValue(first), scheduledWorkoutIdValue(third)],
      notPerformedIds: [scheduledWorkoutIdValue(second)],
    });
  });

  it('excludes another run\u2019s truth and detached history structurally', async () => {
    const run = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
    const otherRun = await seedEnrolledRun({
      owner: OTHER_OWNER,
      programSlug: PROGRAM_SLUG,
      enrollmentId: OTHER_RUN_ID,
    });
    const [first, second, third] = run.occurrenceIds;
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error('expected at least three authored occurrences');
    }
    const occurrences = listOccurrences(run.program);

    await completeOccurrence(RUN_ID, OWNER, occurrences[0]);
    await recordFact(RUN_ID, second);

    // Another run's truth for the same authored occurrences…
    await completeOccurrence(OTHER_RUN_ID, OTHER_OWNER, occurrences[0]);
    await recordFact(OTHER_RUN_ID, second);

    // …and this run's DETACHED history (a completed session whose enrollment
    // was nulled by a leave/restart) must both stay invisible.
    const detached = completedOccurrenceSession({
      id: `${RUN_ID}-detached`,
      owner: OWNER,
      enrollmentId: RUN,
      scheduledWorkoutId: scheduledWorkoutIdValue(third),
      workoutId: workoutIdOf(occurrences[2]),
    });
    await db.transaction((tx) => insertWorkoutSessionRows(tx, detached));
    await db.execute(
      // The detach shape a leave/restart produces: enrollment identity gone.
      sql`UPDATE workout_sessions SET enrollment_id = NULL WHERE id = ${detached.id}`,
    );

    const facts = await runClosureFactsRepository.listClosureFactsByEnrollment(RUN);

    expect(facts).toEqual({
      completedIds: [scheduledWorkoutIdValue(first)],
      notPerformedIds: [scheduledWorkoutIdValue(second)],
    });
  });

  it('returns two empty sets for a run with no execution truth', async () => {
    await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });

    const facts = await runClosureFactsRepository.listClosureFactsByEnrollment(RUN);

    expect(facts).toEqual({ completedIds: [], notPerformedIds: [] });
  });
});
