/**
 * M17 Slice 12 — historical-truth invariance on real PostgreSQL.
 *
 * M17 adds ONE new fact and ONE new deletion, so the proof that matters is
 * negative: settlement must change nothing else. This suite snapshots the
 * production reads that describe the user's completed past BEFORE and AFTER a
 * settlement lifecycle (record, the zero-set abandonment deletion, undo,
 * re-record, and both refusals) and asserts they are deep-equal.
 *
 * What is snapshotted, all through real production reads:
 * - M8 progression targets (`GetNextExerciseTargetsUseCase`, structured DTOs,
 *   not row counts);
 * - the run's completed occurrence projection (M14 ids + occurrence activity);
 * - M12 personal records (current bests, and the current bests established in a
 *   window — the shape `/insights` renders);
 * - completed training history (the activity projection and the lifetime totals).
 *
 * The zero-set abandoned session is the interesting case: it is NOT historical
 * truth, so its deletion by a settlement must move none of the above — and undo
 * must not resurrect it.
 */

import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { GetNextExerciseTargetsUseCase } from '@/application/use-cases/get-next-exercise-targets';
import { RecordNotPerformedUseCase } from '@/application/use-cases/record-not-performed';
import { UndoNotPerformedUseCase } from '@/application/use-cases/undo-not-performed';
import type { TrainingProgram } from '@/domain/entities/training-program';

import {
  childRowCounts,
  countRows,
  factInstants,
  orphanChildRows,
  seedCompletedOccurrenceSession,
  seedInProgressOccurrenceSession,
  sessionRowFor,
} from './not-performed-race-fixtures';
import { enrollmentIdValue, listOccurrences, seedEnrolledRun } from './planned-workout-fixtures';
import { exerciseId, reps, userId } from './personal-record-fixtures';
import {
  client,
  closeDatabase,
  exerciseRepository,
  personalRecordRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  runOccurrenceWrites,
  trainingHistoryRepository,
  workoutSessionRepository,
} from './setup';

const OWNER = 'm17-history-owner';
/** `strong-at-home` authors 12 occurrences (4 weeks × 3 workouts). */
const PROGRAM_SLUG = 'strong-at-home';
const RUN = 'enr-m17-history';
/** Completed-history window bounds: every seeded session completed 2026-09-20. */
const HISTORY_SINCE = new Date('2026-01-01T00:00:00.000Z');
const RECORD_WINDOW_FROM = new Date('2026-09-01T00:00:00.000Z');
const RECORD_WINDOW_TO = new Date('2026-10-01T00:00:00.000Z');
const RECORDED_AT = new Date('2026-09-28T18:30:00.000Z');
const RECORDED_AGAIN_AT = new Date('2026-09-28T20:05:00.000Z');
/** The exercise every seeded session trains, so M8/M12 have real history. */
const TRAINED = exerciseId('ex-002');

afterAll(async () => {
  await closeDatabase();
});

beforeEach(async () => {
  await resetAndSeed();
});

/** The authored coordinates of one occurrence, as the public routes address it. */
function coordinatesOf(
  program: TrainingProgram,
  occurrenceId: string,
): { readonly weekNumber: number; readonly workoutOrder: number } {
  const occurrence = listOccurrences(program).find((candidate) => candidate.id === occurrenceId);
  if (occurrence === undefined) {
    throw new Error(`occurrence "${occurrenceId}" is not authored by the program`);
  }
  const week = program.weeks.find((candidate) =>
    candidate.scheduledWorkouts.some((scheduled) => scheduled.id === occurrenceId),
  );
  if (week === undefined) throw new Error('occurrence has no authored week');

  return { weekNumber: week.weekNumber, workoutOrder: occurrence.order };
}

/** The occurrence template's workout id, needed to build a real session. */
function workoutIdFor(program: TrainingProgram, occurrenceId: string): string {
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

function recordUseCase() {
  return new RecordNotPerformedUseCase(programRepository, programEnrollmentRepository, runOccurrenceWrites);
}

function undoUseCase() {
  return new UndoNotPerformedUseCase(programRepository, programEnrollmentRepository, runOccurrenceWrites);
}

function targetsUseCase() {
  return new GetNextExerciseTargetsUseCase(exerciseRepository, trainingHistoryRepository);
}

/**
 * The complete historical truth of the owner and the run, in one comparable
 * object. Every field is a real production read; none is derived here.
 */
async function historicalTruth() {
  const [completedIds, completedActivity, historyActivity, totals, targets, currentBests, windowedBests] =
    await Promise.all([
      workoutSessionRepository.listCompletedScheduledWorkoutIds(enrollmentIdValue(RUN)),
      workoutSessionRepository.listCompletedOccurrenceActivity(enrollmentIdValue(RUN)),
      trainingHistoryRepository.listCompletedSessionActivity(userId(OWNER), HISTORY_SINCE),
      trainingHistoryRepository.getTotals(userId(OWNER)),
      targetsUseCase().execute({
        userId: OWNER,
        requests: [{ exerciseId: TRAINED, prescription: reps() }],
      }),
      personalRecordRepository.findCurrentPersonalBests(userId(OWNER), [TRAINED]),
      personalRecordRepository.findCurrentPersonalBestsSetBetween(
        userId(OWNER),
        RECORD_WINDOW_FROM,
        RECORD_WINDOW_TO,
      ),
    ]);

  return {
    completedIds: completedIds.map((id) => `${id}`),
    completedActivity: completedActivity.map(
      (entry) => `${entry.scheduledWorkoutId}@${entry.completedAt.toISOString()}`,
    ),
    historyActivity: historyActivity.map(
      (entry) => `${entry.sessionId}@${entry.completedAt.toISOString()}#${entry.loggedSets}`,
    ),
    totals,
    targets: JSON.parse(JSON.stringify(targets)),
    currentBests: JSON.parse(JSON.stringify(currentBests)),
    windowedBests: JSON.parse(JSON.stringify(windowedBests)),
  };
}


/** One run whose past is already written: five completed sessions, plus the
 *  two in-progress shapes (abandoned zero-set, and one with logged work). */
async function seedHistory() {
  const run = await seedEnrolledRun({
    owner: OWNER,
    programSlug: PROGRAM_SLUG,
    enrollmentId: RUN,
  });
  const occurrences = run.occurrenceIds;
  const at = (index: number): string => {
    const occurrence = occurrences[index];
    if (occurrence === undefined) throw new Error(`the program authors no occurrence ${index}`);
    return occurrence;
  };

  const completed: { occurrenceId: string; sessionId: string }[] = [];
  for (let index = 0; index < 5; index += 1) {
    const occurrenceId = at(index);
    const session = await seedCompletedOccurrenceSession({
      id: `${RUN}-history-${index + 1}`,
      owner: OWNER,
      enrollmentId: enrollmentIdValue(RUN),
      scheduledWorkoutId: occurrenceId,
      workoutId: workoutIdFor(run.program, occurrenceId),
    });
    completed.push({ occurrenceId, sessionId: session.id });
  }

  const abandoned = await seedInProgressOccurrenceSession({
    id: `${RUN}-abandoned`,
    owner: OWNER,
    enrollmentId: enrollmentIdValue(RUN),
    scheduledWorkoutId: at(5),
    workoutId: workoutIdFor(run.program, at(5)),
  });
  const worked = await seedInProgressOccurrenceSession({
    id: `${RUN}-worked`,
    owner: OWNER,
    enrollmentId: enrollmentIdValue(RUN),
    scheduledWorkoutId: at(6),
    workoutId: workoutIdFor(run.program, at(6)),
    withLoggedSet: true,
  });

  return {
    program: run.program,
    completed,
    /** Already completed: the refusal case. */
    completedTarget: at(0),
    /** In progress with zero logged sets: the deletable abandonment. */
    abandonTarget: at(5),
    abandonedId: abandoned.id,
    /** In progress WITH logged work: the protected case. */
    workTarget: at(6),
    workedId: worked.id,
    /** Open, with no session at all: the plain settlement case. */
    recordTarget: at(7),
  };
}

describe('1. settlement never moves completed-history truth', () => {
  it('record, the zero-set deletion, undo and re-record leave every historical read identical', async () => {
    const fixture = await seedHistory();
    const record = recordUseCase();
    const undo = undoUseCase();

    const before = await historicalTruth();
    // The comparison is only meaningful if the reads actually have something in
    // them: five completed occurrences with structured progression and records.
    expect(before.completedIds).toHaveLength(5);
    expect(before.completedActivity).toHaveLength(5);
    expect(before.historyActivity).toHaveLength(5);
    expect(before.totals).toEqual({ completedSessions: 5, loggedSets: 5 });
    expect(before.targets.ok).toBe(true);
    expect(before.targets.data?.length ?? 0).toBeGreaterThan(0);
    expect(before.currentBests.length).toBeGreaterThan(0);
    expect(before.windowedBests.length).toBeGreaterThan(0);
    // An in-progress session is never historical truth, zero-set or not.
    expect(before.completedIds).not.toContain(fixture.abandonTarget);
    expect(before.completedIds).not.toContain(fixture.workTarget);

    // 1. Record an occurrence that has no session at all.
    const recorded = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(fixture.program, fixture.recordTarget),
      recordedAt: RECORDED_AT,
    });
    expect(recorded.ok).toBe(true);
    expect(await factInstants(client, enrollmentIdValue(RUN))).toEqual([
      `${fixture.recordTarget}@${RECORDED_AT.toISOString()}`,
    ]);
    expect(await historicalTruth()).toEqual(before);

    // 2. Undo: one fact deleted, still nothing else.
    const undone = await undo.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(fixture.program, fixture.recordTarget),
    });
    expect(undone.ok).toBe(true);
    expect(await factInstants(client, enrollmentIdValue(RUN))).toEqual([]);
    expect(await historicalTruth()).toEqual(before);

    // 3. Re-record: the instant changes, the past does not.
    const reRecorded = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(fixture.program, fixture.recordTarget),
      recordedAt: RECORDED_AGAIN_AT,
    });
    expect(reRecorded.ok).toBe(true);
    expect(await factInstants(client, enrollmentIdValue(RUN))).toEqual([
      `${fixture.recordTarget}@${RECORDED_AGAIN_AT.toISOString()}`,
    ]);
    expect(await historicalTruth()).toEqual(before);

    // 4. The zero-set abandonment: recording deletes it, and that deletion is
    //    invisible to every completed-history read.
    const settledAbandonment = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(fixture.program, fixture.abandonTarget),
      recordedAt: RECORDED_AT,
    });
    expect(settledAbandonment.ok).toBe(true);
    expect(await sessionRowFor(client, enrollmentIdValue(RUN), fixture.abandonTarget)).toBeNull();
    expect(await childRowCounts(client, fixture.abandonedId)).toEqual({
      exerciseLogs: 0,
      setLogs: 0,
    });
    expect(await orphanChildRows(client)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    expect(await historicalTruth()).toEqual(before);

    // 5. Undo does NOT resurrect it: the deleted abandonment is not recoverable
    //    state, and the calendar read (not this suite) is what re-opens the
    //    occurrence.
    const undoneAbandonment = await undo.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(fixture.program, fixture.abandonTarget),
    });
    expect(undoneAbandonment.ok).toBe(true);
    expect(await sessionRowFor(client, enrollmentIdValue(RUN), fixture.abandonTarget)).toBeNull();
    expect(await historicalTruth()).toEqual(before);
  });
});


describe('2. refusals destroy nothing', () => {
  it('logged work and completed sessions refuse the record with every row intact', async () => {
    const fixture = await seedHistory();
    const record = recordUseCase();

    const before = await historicalTruth();
    expect(await childRowCounts(client, fixture.workedId)).toEqual({ exerciseLogs: 1, setLogs: 1 });

    // An in-progress session WITH logged work can never be recorded over: the
    // work is authoritative, so the settlement is refused as a business
    // outcome and nothing — session, exercise log, set log — is touched.
    const refusedWork = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(fixture.program, fixture.workTarget),
      recordedAt: RECORDED_AT,
    });
    expect(refusedWork.ok).toBe(false);
    if (refusedWork.ok) return;
    expect(refusedWork.error.code).toBe('OCCURRENCE_HAS_LOGGED_WORK');

    expect(await sessionRowFor(client, enrollmentIdValue(RUN), fixture.workTarget)).toEqual({
      id: fixture.workedId,
      enrollmentId: RUN,
    });
    expect(await childRowCounts(client, fixture.workedId)).toEqual({ exerciseLogs: 1, setLogs: 1 });
    expect(await countRows(client, 'not_performed_workouts')).toBe(0);
    expect(await historicalTruth()).toEqual(before);

    // A completed session is already performed: the settlement is refused and
    // the completed history row keeps its children and its completion instant.
    const refusedCompleted = await record.execute({
      userId: OWNER,
      programSlug: PROGRAM_SLUG,
      ...coordinatesOf(fixture.program, fixture.completedTarget),
      recordedAt: RECORDED_AT,
    });
    expect(refusedCompleted.ok).toBe(false);
    if (refusedCompleted.ok) return;
    expect(refusedCompleted.error.code).toBe('OCCURRENCE_ALREADY_PERFORMED');

    const completedSession = fixture.completed[0];
    if (completedSession === undefined) throw new Error('expected a completed session');
    expect(await childRowCounts(client, completedSession.sessionId)).toEqual({
      exerciseLogs: 1,
      setLogs: 1,
    });
    expect(await countRows(client, 'not_performed_workouts')).toBe(0);
    expect(await orphanChildRows(client)).toEqual({ exerciseLogs: 0, setLogs: 0 });
    expect(await historicalTruth()).toEqual(before);
  });
});

