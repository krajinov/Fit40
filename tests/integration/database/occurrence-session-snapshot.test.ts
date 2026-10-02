/**
 * M17 occurrence execution facts — ONE coherent database snapshot, on real
 * PostgreSQL.
 *
 * The P2 finding this suite guards: the workout-session read used to obtain
 * the session aggregate and the not-performed settlement state through TWO
 * independent statements. Under READ COMMITTED each statement takes its own
 * snapshot, so a `recordNotPerformed` transition for an abandoned zero-set
 * session (delete session + insert fact, committed atomically) could hand the
 * DTO the OLD session beside the NEW fact — a pair the persisted state never
 * held. The fix: one projection (`DrizzleOccurrenceExecutionFactsRepository`)
 * reading both halves from one snapshot (a bounded, read-only REPEATABLE READ
 * transaction, because the aggregate spans several rows).
 *
 * Every interleaving here is decided by database state, never by a sleep: the
 * writer is held mid-transaction by a gate; the read's in-flight position is
 * proven through `pg_locks` before the writer is allowed to commit. Raw
 * statements appear ONLY inside gate holders, to reproduce what the peer
 * transition commits — the read itself is always the production one.
 *
 * The negative control drives the retired two-statement composition through
 * the SAME armed gate and DOES produce the forbidden old-session-plus-new-fact
 * pair, proving the gate reproduces the bug and that the fix — not a vacuous
 * interleaving — is what removes it.
 */

import { eq } from 'drizzle-orm';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import type { TrainingProgram } from '@/domain/entities/training-program';
import { DrizzleOccurrenceExecutionFactsRepository } from '@/infrastructure/database/repositories/drizzle-occurrence-execution-facts-repository';
import { workoutSessions } from '@/infrastructure/database/schema';

import {
  createRaceHarness,
  factExists,
  holdEnrollmentLock,
  holdTableWriteGate,
  insertFactRaw,
  seedCompletedOccurrenceSession,
  seedInProgressOccurrenceSession,
  sessionRowFor,
  waitForPendingLock,
  type RaceHarness,
} from './not-performed-race-fixtures';
import { enrollmentIdValue, scheduledWorkoutIdValue, seedEnrolledRun } from './planned-workout-fixtures';
import {
  closeDatabase,
  db,
  occurrenceExecutionFactsRepository,
  resetAndSeed,
} from './setup';

const OWNER = 'm17-occurrence-snapshot-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN_ID = 'enr-m17-occurrence-snapshot';
const RUN = enrollmentIdValue(RUN_ID);

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** The occurrence template's workout id, needed to build a real session. */
function workoutIdFor(program: TrainingProgram, occurrenceId: string) {
  for (const week of program.weeks) {
    for (const scheduled of week.scheduledWorkouts) {
      if (scheduled.id === occurrenceId) {
        const workout = program.workouts.find((candidate) => candidate.id === scheduled.workoutId);
        if (workout === undefined) throw new Error('occurrence references a missing workout');
        return workout.id;
      }
    }
  }
  throw new Error(`occurrence "${occurrenceId}" is not authored by the program`);
}

/** A dedicated pool plus the production projection bound to that pool. */
async function withHarness(run: (harness: RaceHarness) => Promise<void>): Promise<void> {
  // The writer holder, the gate holder, the in-flight reader and the pg_locks
  // observer each need their own real parallel connection.
  const harness = createRaceHarness(6);
  try {
    await run(harness);
  } finally {
    await harness.end();
  }
}

/**
 * Holds the peer `recordNotPerformed` transition for an abandoned zero-set
 * session uncommitted until `release()`: the enrollment lock FIRST (the
 * writer-side serialization the production authority uses), then the session
 * delete (children cascade) and the fact insert. Committed at release, it is
 * exactly one valid transition.
 */
async function holdRecordNotPerformedTransition(
  harness: RaceHarness,
  sessionId: string,
  occurrenceId: string,
): Promise<{ readonly release: () => Promise<void> }> {
  return holdEnrollmentLock({
    db: harness.db,
    enrollmentId: RUN,
    work: async (tx) => {
      await tx.delete(workoutSessions).where(eq(workoutSessions.id, sessionId));
      await insertFactRaw(tx, { enrollmentId: RUN, scheduledWorkoutId: occurrenceId });
    },
  });
}

/** Seeds an enrolled run whose first occurrence carries an abandoned session. */
async function seedAbandonedSessionRun() {
  const run = await seedEnrolledRunForOccurrence();
  const session = await seedInProgressOccurrenceSession({
    id: `${RUN_ID}-abandoned`,
    owner: OWNER,
    enrollmentId: RUN,
    scheduledWorkoutId: run.occurrenceB,
    workoutId: workoutIdFor(run.fixture.program, run.occurrenceB),
  });
  return { ...run, session };
}

async function seedEnrolledRunForOccurrence() {
  const fixture = await seedEnrolledRun({ owner: OWNER, programSlug: PROGRAM_SLUG, enrollmentId: RUN_ID });
  const [occurrenceB] = fixture.occurrenceIds;
  if (occurrenceB === undefined) throw new Error('expected at least one authored occurrence');
  return { fixture, occurrenceB };
}

describe('M17 occurrence execution facts — one coherent snapshot under a concurrent transition', () => {
  it('A. returns exactly one valid occurrence state while the abandoned-session → record transition is in flight', async () => {
    const { occurrenceB, session } = await seedAbandonedSessionRun();

    await withHarness(async (harness) => {
      const projection = new DrizzleOccurrenceExecutionFactsRepository(harness.db);
      const occurrence = scheduledWorkoutIdValue(occurrenceB);
      const writer = await holdRecordNotPerformedTransition(harness, session.id, occurrenceB);

      // 1. While the transition is genuinely uncommitted: the OLD state,
      // whole — the session exists and no record is visible.
      const duringFlight = await projection.findOccurrenceExecutionFacts(RUN, occurrence);
      expect(duringFlight.session?.id).toBe(session.id);
      expect(duringFlight.session?.completedAt).toBeNull();
      expect(duringFlight.notPerformedRecorded).toBe(false);

      // 2. The commit lands strictly INSIDE a read: the gate holds the read's
      // fact statement behind the writer's uncommitted insert (VERIFIED
      // pending), so the read's snapshot is fixed before the commit…
      const gate = holdTableWriteGate(harness.db, 'not_performed_workouts');
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessExclusiveLock');
      const inFlight = projection.findOccurrenceExecutionFacts(RUN, occurrence);
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessShareLock');
      await writer.release();
      await gate.release();

      // …and the result is exactly the OLD coherent state — never the old
      // session beside the new fact, and never neither.
      const straddled = await inFlight;
      expect(straddled.session?.id).toBe(session.id);
      expect(straddled.notPerformedRecorded).toBe(false);

      // 3. A fresh read after the commit: the NEW state, whole — the session
      // is gone and the record is present.
      const afterCommit = await projection.findOccurrenceExecutionFacts(RUN, occurrence);
      expect(afterCommit.session).toBeNull();
      expect(afterCommit.notPerformedRecorded).toBe(true);

      // The committed transition is the whole truth.
      expect(await sessionRowFor(harness.sql, RUN, occurrenceB)).toBeNull();
      expect(await factExists(harness.sql, RUN, occurrenceB)).toBe(true);
    });
  });

  it('negative control: the retired two-statement composition pairs the old session with the new fact at the SAME gate', async () => {
    const { occurrenceB, session } = await seedAbandonedSessionRun();

    await withHarness(async (harness) => {
      const occurrence = scheduledWorkoutIdValue(occurrenceB);
      const writer = await holdRecordNotPerformedTransition(harness, session.id, occurrenceB);
      const gate = holdTableWriteGate(harness.db, 'not_performed_workouts');
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessExclusiveLock');

      // The pre-fix composition: ONE session read and ONE fact read as
      // independent statements. The fact read queues behind the gate; the
      // session read runs immediately and sees the state BEFORE the commit.
      const factsRead = harness.notPerformed.listByEnrollment(RUN);
      await waitForPendingLock(harness.sql, 'not_performed_workouts', 'AccessShareLock');
      const sessionRead = await harness.sessions.findByEnrollmentAndScheduledWorkout(RUN, occurrence);
      expect(sessionRead?.id).toBe(session.id);

      // The commit lands between the two statements: the fact read then sees
      // the state AFTER it.
      await writer.release();
      await gate.release();
      const facts = await factsRead;

      // Old session + fresh record: the impossible DTO this gate manufactures
      // deterministically for the retired composition — the UI would render a
      // session that no longer exists.
      expect(facts.map((fact) => fact.scheduledWorkoutId)).toContain(occurrence);
      expect(sessionRead).not.toBeNull();
    });
  });
});


describe('M17 occurrence execution facts — regression states are unchanged', () => {
  const occurrenceFactsOf = (occurrenceId: string) =>
    occurrenceExecutionFactsRepository.findOccurrenceExecutionFacts(
      RUN,
      scheduledWorkoutIdValue(occurrenceId),
    );

  it('no session and no record: the occurrence is open', async () => {
    const { occurrenceB } = await seedEnrolledRunForOccurrence();

    const facts = await occurrenceFactsOf(occurrenceB);

    expect(facts).toEqual({ session: null, notPerformedRecorded: false });
  });

  it('a live in-progress session and no record', async () => {
    const { occurrenceB, session } = await seedAbandonedSessionRun();

    const facts = await occurrenceFactsOf(occurrenceB);

    expect(facts.session?.id).toBe(session.id);
    expect(facts.session?.completedAt).toBeNull();
    expect(facts.notPerformedRecorded).toBe(false);
  });

  it('a completed session and no record', async () => {
    const { fixture, occurrenceB } = await seedEnrolledRunForOccurrence();
    const completed = await seedCompletedOccurrenceSession({
      id: `${RUN_ID}-completed`,
      owner: OWNER,
      enrollmentId: RUN,
      scheduledWorkoutId: occurrenceB,
      workoutId: workoutIdFor(fixture.program, occurrenceB),
    });

    const facts = await occurrenceFactsOf(occurrenceB);

    expect(facts.session?.id).toBe(completed.id);
    expect(facts.session?.completedAt).not.toBeNull();
    expect(facts.notPerformedRecorded).toBe(false);
  });

  it('no session and a record: the occurrence is settled as not performed', async () => {
    const { occurrenceB } = await seedEnrolledRunForOccurrence();
    await db.transaction((tx) =>
      insertFactRaw(tx, { enrollmentId: RUN, scheduledWorkoutId: occurrenceB }),
    );

    const facts = await occurrenceFactsOf(occurrenceB);

    expect(facts).toEqual({ session: null, notPerformedRecorded: true });
  });
});

