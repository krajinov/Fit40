/**
 * M14 Slice 5 — RestartProgramUseCase against real PostgreSQL.
 *
 * Proves the application orchestration end to end on top of Slice 3's atomic
 * primitive: one committed replacement, no unenrolled intermediate state, no
 * duplicate enrollment, real concurrent request handling (two genuine
 * transactions on separate connections), truthful stale mapping, and the
 * invariance of every user-global read (Training History, M8 progression
 * inputs, M12 current bests).
 */

import { and, asc, eq, inArray } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

import { RestartProgramUseCase } from '@/application/use-cases/restart-program';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import type { ScheduledWorkout, TrainingProgram } from '@/domain/entities/training-program';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import { getNextWorkout } from '@/domain/services/program-progress';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  type ExerciseId,
  type UserId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { NodeIdGenerator } from '@/infrastructure/crypto/node-id-generator';
import { DrizzleProgramEnrollmentRepository } from '@/infrastructure/database/repositories/drizzle-program-enrollment-repository';
import { DrizzleProgramRepository } from '@/infrastructure/database/repositories/drizzle-program-repository';
import { DrizzleWorkoutSessionRepository } from '@/infrastructure/database/repositories/drizzle-workout-session-repository';
import * as schema from '@/infrastructure/database/schema';
import { exercises, programEnrollments, workoutSessions } from '@/infrastructure/database/schema';

import { seedUser } from './personal-record-fixtures';
import {
  closeDatabase,
  db,
  personalRecordRepository,
  programEnrollmentRepository,
  programRepository,
  resetAndSeed,
  trainingHistoryRepository,
  workoutSessionRepository,
} from './setup';
import { getTestDatabaseUrl } from './test-env';

const RUNNER = 'restart-runner';
const OTHER = 'restart-other';
const PROGRAM_SLUG = 'strong-at-home';
const FIRST_ENROLLMENT = 'enr-run-1';

function userIdValue(value: string): UserId {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function exerciseId(value: string): ExerciseId {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enrollmentIdValue(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledWorkoutId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function workoutIdValue(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function repsScheme() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function listOccurrences(program: TrainingProgram): ReadonlyArray<ScheduledWorkout> {
  return program.weeks.flatMap((week) =>
    [...week.scheduledWorkouts].sort((a, b) => a.order - b.order),
  );
}

function requireOccurrence(
  occurrences: ReadonlyArray<ScheduledWorkout>,
  index: number,
): ScheduledWorkout {
  const occurrence = occurrences[index];
  if (occurrence === undefined) {
    throw new Error(`Seed program is missing scheduled occurrence ${index}`);
  }
  return occurrence;
}

/** One completed session: the occurrence's template workout, one logged set. */
function buildSession(spec: {
  readonly id: string;
  readonly owner: string;
  readonly enrollmentId: string;
  readonly occurrence: ScheduledWorkout;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly exerciseId: ExerciseId;
  readonly weightKg: number;
}): WorkoutSession {
  const created = createWorkoutSession({
    id: spec.id,
    userId: userIdValue(spec.owner),
    enrollmentId: enrollmentIdValue(spec.enrollmentId),
    scheduledWorkoutId: scheduledWorkoutId(spec.occurrence.id),
    workoutId: workoutIdValue(spec.occurrence.workoutId),
    startedAt: new Date(spec.startedAt),
    exerciseLogs: [
      {
        authoredExerciseId: spec.exerciseId,
        order: 1,
        prescription: repsScheme(),
        restSeconds: 60,
      },
    ],
  });
  if (!created.ok) throw new Error(created.error.message);

  const logged = logSessionSet(created.data, {
    exerciseOrder: 1,
    type: 'reps',
    reps: 8,
    weightKg: spec.weightKg,
    rpe: null,
  });
  if (!logged.ok) throw new Error(logged.error.message);

  const done = completeWorkoutSession(logged.data, new Date(spec.completedAt));
  if (!done.ok) throw new Error(done.error.message);
  return done.data;
}

async function enroll(id: string, owner: string, programId: string): Promise<void> {
  const created = createProgramEnrollment({
    id,
    userId: owner,
    programId,
    enrolledAt: new Date('2026-01-20T00:00:00Z'),
  });
  if (!created.ok) throw new Error(created.error.message);
  await programEnrollmentRepository.create(created.data);
}

interface CompletedRun {
  readonly program: TrainingProgram;
  readonly enrollmentId: string;
  readonly sessionIds: ReadonlyArray<string>;
  readonly exerciseIds: ReadonlyArray<ExerciseId>;
}

/** A fully completed run for RUNNER: every scheduled workout completed. */
async function seedCompletedRun(): Promise<CompletedRun> {
  await seedUser(RUNNER);
  await seedUser(OTHER);

  const program = await programRepository.findBySlug(PROGRAM_SLUG);
  if (program === null) throw new Error('seed program missing');

  const catalog = await db
    .select({ id: exercises.id })
    .from(exercises)
    .orderBy(asc(exercises.id))
    .limit(3);
  const exerciseIds = catalog.map((row) => exerciseId(row.id));
  if (exerciseIds.length === 0) throw new Error('seed catalog is empty');

  await enroll(FIRST_ENROLLMENT, RUNNER, program.id);

  const occurrences = listOccurrences(program);
  const sessionIds: string[] = [];
  for (const [index, occurrence] of occurrences.entries()) {
    const id = `run-${index + 1}`;
    const day = String(index + 1).padStart(2, '0');
    const exercise = exerciseIds[index % exerciseIds.length];
    if (exercise === undefined) throw new Error('unreachable: the catalog is non-empty');
    await workoutSessionRepository.save(
      buildSession({
        id,
        owner: RUNNER,
        enrollmentId: FIRST_ENROLLMENT,
        occurrence,
        startedAt: `2026-02-${day}T09:00:00Z`,
        completedAt: `2026-02-${day}T10:00:00Z`,
        exerciseId: exercise,
        weightKg: 20 + index,
      }),
    );
    sessionIds.push(id);
  }

  return { program, enrollmentId: FIRST_ENROLLMENT, sessionIds, exerciseIds };
}

function restartUseCase(
  enrollmentRepo = programEnrollmentRepository,
  sessionRepo = workoutSessionRepository,
  programRepo = programRepository,
) {
  return new RestartProgramUseCase(programRepo, enrollmentRepo, sessionRepo, new NodeIdGenerator());
}

/** The runner's enrollment rows for the program, read straight from the table. */
async function enrollmentRowsFor(programId: string, owner: string) {
  return db
    .select()
    .from(programEnrollments)
    .where(
      and(eq(programEnrollments.userId, owner), eq(programEnrollments.programId, programId)),
    );
}

/** The persisted session rows for the given ids, read straight from the table. */
async function sessionRowsFor(sessionIds: ReadonlyArray<string>) {
  return db
    .select()
    .from(workoutSessions)
    .where(inArray(workoutSessions.id, [...sessionIds]))
    .orderBy(asc(workoutSessions.id));
}

/** Semantic projections for before/after invariance comparisons. */
async function historyLines(owner: UserId): Promise<ReadonlyArray<string>> {
  const page = await trainingHistoryRepository.listCompletedSessions(owner, {
    limit: 50,
    after: null,
  });
  return page.entries.map(
    (entry) =>
      `${entry.session.id}@${entry.session.completedAt.toISOString()}|${entry.programName}|${entry.workoutName}`,
  );
}

async function currentBestLines(
  owner: UserId,
  exerciseIds: ReadonlyArray<ExerciseId>,
): Promise<ReadonlyArray<string>> {
  const bests = await personalRecordRepository.findCurrentPersonalBests(owner, exerciseIds);
  return bests.map(
    (best) =>
      `${best.exerciseId}/${best.metric}/${best.value}` +
      `@${best.position.sessionId}.${best.position.exerciseOrder}.${best.position.setNumber}`,
  );
}

async function progressionLines(
  owner: UserId,
  exerciseIds: ReadonlyArray<ExerciseId>,
): Promise<ReadonlyArray<string>> {
  const performances = await trainingHistoryRepository.listRecentCompletedExercisePerformances(
    owner,
    exerciseIds,
    5,
  );
  return performances.map(
    (performance) =>
      `${performance.exerciseId}:${performance.sessionId}.${performance.exerciseOrder}` +
      `@${performance.completedAt.toISOString()}#${performance.sets.length}`,
  );
}

describe('RestartProgramUseCase — PostgreSQL end-to-end', () => {
  let run: CompletedRun;

  beforeEach(async () => {
    await resetAndSeed();
    run = await seedCompletedRun();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  it('A. replaces the completed run atomically with a fresh, empty run', async () => {
    const before = Date.now();
    const result = await restartUseCase().execute({ userId: RUNNER, programSlug: PROGRAM_SLUG });
    const after = Date.now();

    expect(result.ok).toBe(true);

    // Exactly one enrollment for the pair, carrying a fresh identity.
    const rows = await enrollmentRowsFor(run.program.id, RUNNER);
    expect(rows).toHaveLength(1);
    const fresh = rows[0];
    if (fresh === undefined) throw new Error('expected exactly one enrollment row');
    expect(fresh.id).not.toBe(run.enrollmentId);
    expect(fresh.userId).toBe(RUNNER);
    expect(fresh.programId).toBe(run.program.id);
    expect(fresh.enrolledAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(fresh.enrolledAt.getTime()).toBeLessThanOrEqual(after);

    // Fresh progress: nothing completed, so the run starts at its first workout.
    const freshCompleted = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
      enrollmentIdValue(fresh.id),
    );
    expect(freshCompleted).toEqual([]);
    expect(getNextWorkout(run.program, freshCompleted)?.id).toBe(
      requireOccurrence(listOccurrences(run.program), 0).id,
    );

    // The completed run's sessions survive, detached, never reattached.
    const sessions = await sessionRowsFor(run.sessionIds);
    expect(sessions.map((session) => session.id)).toEqual([...run.sessionIds].sort());
    expect(sessions.every((session) => session.enrollmentId === null)).toBe(true);
    expect(sessions.some((session) => session.enrollmentId === fresh.id)).toBe(false);

    // ...and remain the user's training history.
    expect(await historyLines(userIdValue(RUNNER))).toHaveLength(run.sessionIds.length);
  });

  it('B. leaves user-global history, progression inputs and current bests invariant', async () => {
    const owner = userIdValue(RUNNER);
    const beforeHistory = await historyLines(owner);
    const beforeBests = await currentBestLines(owner, run.exerciseIds);
    const beforeProgression = await progressionLines(owner, run.exerciseIds);
    expect(beforeHistory).toHaveLength(run.sessionIds.length);
    expect(beforeBests.length).toBeGreaterThan(0);
    expect(beforeProgression.length).toBeGreaterThan(0);

    const result = await restartUseCase().execute({ userId: RUNNER, programSlug: PROGRAM_SLUG });
    expect(result.ok).toBe(true);

    // Semantically identical, not merely the same length: the same sessions,
    // the same record owners and values, the same progression-history window.
    expect(await historyLines(owner)).toEqual(beforeHistory);
    expect(await currentBestLines(owner, run.exerciseIds)).toEqual(beforeBests);
    expect(await progressionLines(owner, run.exerciseIds)).toEqual(beforeProgression);
  });

  it('C. answers two truly concurrent restarts with exactly one fresh run', async () => {
    // Dedicated pool: the shared test client is max: 1, so two requests would
    // queue behind one connection instead of overlapping. Here they are two
    // genuine transactions on separate connections — the second CAS waits on
    // the first request's uncommitted row lock.
    const concurrentClient = postgres(getTestDatabaseUrl(), { max: 4 });
    try {
      const concurrentDb = drizzle(concurrentClient, { schema });
      const useCase = restartUseCase(
        new DrizzleProgramEnrollmentRepository(concurrentDb),
        new DrizzleWorkoutSessionRepository(concurrentDb),
        new DrizzleProgramRepository(concurrentDb),
      );

      const outcomes = await Promise.all([
        useCase.execute({ userId: RUNNER, programSlug: PROGRAM_SLUG }),
        useCase.execute({ userId: RUNNER, programSlug: PROGRAM_SLUG }),
      ]);

      const codes = outcomes.map((outcome) => (outcome.ok ? 'ok' : outcome.error.code));
      expect(codes.filter((code) => code === 'ok')).toHaveLength(1);
      // The loser's exact code depends on the interleaving; the contract only
      // requires a truthful typed stale/concurrency outcome (never a crash and
      // never a silent success).
      expect(codes.filter((code) => code !== 'ok')).toHaveLength(1);
      const loserCode = codes.find((code) => code !== 'ok');
      expect([
        'PROGRAM_NOT_COMPLETE',
        'ENROLLMENT_CHANGED',
        'ALREADY_ENROLLED',
        'NOT_ENROLLED',
      ]).toContain(loserCode);

      // Exactly one live enrollment, with a fresh identity.
      const rows = await enrollmentRowsFor(run.program.id, RUNNER);
      expect(rows).toHaveLength(1);
      const fresh = rows[0];
      if (fresh === undefined) throw new Error('expected exactly one enrollment row');
      expect(fresh.id).not.toBe(run.enrollmentId);

      // Zero inherited progress on the winner.
      const freshCompleted = await workoutSessionRepository.listCompletedScheduledWorkoutIds(
        enrollmentIdValue(fresh.id),
      );
      expect(freshCompleted).toEqual([]);

      // Old sessions survive, detached, and none is attached to the fresh run.
      const sessions = await sessionRowsFor(run.sessionIds);
      expect(sessions).toHaveLength(run.sessionIds.length);
      expect(sessions.every((session) => session.enrollmentId === null)).toBe(true);

      // History remains, and the user was never left unenrolled.
      expect(await historyLines(userIdValue(RUNNER))).toHaveLength(run.sessionIds.length);
    } finally {
      await concurrentClient.end();
    }
  });

  it('D. refuses a serialized second restart with PROGRAM_NOT_COMPLETE', async () => {
    const useCase = restartUseCase();
    const first = await useCase.execute({ userId: RUNNER, programSlug: PROGRAM_SLUG });
    expect(first.ok).toBe(true);

    const rowsAfterFirst = await enrollmentRowsFor(run.program.id, RUNNER);
    const fresh = rowsAfterFirst[0];
    if (fresh === undefined) throw new Error('expected a fresh enrollment');

    const second = await useCase.execute({ userId: RUNNER, programSlug: PROGRAM_SLUG });

    expect(second.ok).toBe(false);
    if (second.ok) return;
    expect(second.error.code).toBe('PROGRAM_NOT_COMPLETE');

    // The fresh run is untouched by the refused second attempt.
    const rowsAfterSecond = await enrollmentRowsFor(run.program.id, RUNNER);
    expect(rowsAfterSecond).toHaveLength(1);
    expect(rowsAfterSecond[0]?.id).toBe(fresh.id);
    expect(rowsAfterSecond[0]?.enrolledAt.toISOString()).toBe(fresh.enrolledAt.toISOString());
  });

  it("E. does not let another user restart the runner's enrollment", async () => {
    const result = await restartUseCase().execute({ userId: OTHER, programSlug: PROGRAM_SLUG });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('NOT_ENROLLED');

    // The runner's completed enrollment and its session attribution are intact.
    const rows = await enrollmentRowsFor(run.program.id, RUNNER);
    expect(rows).toHaveLength(1);
    expect(rows[0]?.id).toBe(run.enrollmentId);
    expect(rows[0]?.enrolledAt.toISOString()).toBe('2026-01-20T00:00:00.000Z');
    const sessions = await sessionRowsFor(run.sessionIds);
    expect(sessions.every((session) => session.enrollmentId === run.enrollmentId)).toBe(true);

    // The other user never gained an enrollment.
    expect(await enrollmentRowsFor(run.program.id, OTHER)).toEqual([]);
  });
});

