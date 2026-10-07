/**
 * Real-PostgreSQL fixtures for the Personal Records read-model suite.
 *
 * Not a test file: `personal-record-repository.test.ts` imports these so every
 * scenario drives the real write path (the domain factories plus the
 * `WorkoutSessionRepository`) and the real read path. Sessions are persisted
 * with a null enrollment by default — detached history is exactly what the
 * records read must include — and with a seeded enrollment when a scenario
 * needs attached history.
 */

import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import { createProgramEnrollment } from '@/domain/entities/program-enrollment';
import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import type { RecordCandidate, RecordMetric } from '@/domain/services/personal-record-metrics';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import {
  createEnrollmentId,
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
  type ExerciseId,
  type WorkoutSessionId,
} from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';
import * as schema from '@/infrastructure/database/schema';
import { users } from '@/infrastructure/database/schema';
import { DrizzlePersonalRecordRepository } from '@/infrastructure/database/repositories/drizzle-personal-record-repository';

import { db, programEnrollmentRepository, workoutSessionRepository } from './setup';
import { getTestDatabaseUrl } from './test-env';

export function exerciseId(value: string): ExerciseId {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function workoutSessionId(value: string): WorkoutSessionId {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function userId(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function scheduledWorkoutId(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function workoutId(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function enrollmentId(value: string) {
  const result = createEnrollmentId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function reps() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function duration() {
  const result = createDurationScheme(3, 30);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Creates a real user row so session ownership FKs are satisfiable. */
export async function seedUser(id: string): Promise<void> {
  await db.insert(users).values({ id, email: `${id}@example.test`, passwordHash: 'x' });
}

/**
 * Creates a real enrollment row so a scenario can persist ATTACHED history
 * (a session that still counts toward a program) instead of detached history.
 */
export async function seedEnrollment(id: string, owner: string, programId: string): Promise<void> {
  const created = createProgramEnrollment({
    id,
    userId: owner,
    programId,
    enrolledAt: new Date('2026-01-01T00:00:00Z'),
  });
  if (!created.ok) throw new Error(created.error.message);
  await programEnrollmentRepository.create(created.data);
}

/**
 * Valid (scheduled_workout_id, workout_id) pairs from the seeded programs, so
 * a scenario never has to invent template identity.
 */
export const PR_OCCURRENCES = [
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w1-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w2-3', workoutId: 'wo-beginner-strength-c' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w3-1', workoutId: 'wo-beginner-strength-a' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w3-2', workoutId: 'wo-beginner-strength-b' },
  { scheduledWorkoutId: 'fit40-beginner-strength-w4-1', workoutId: 'wo-beginner-strength-a' },
] as const;

export interface PrSetSpec {
  readonly reps?: number;
  readonly durationSeconds?: number;
  readonly weightKg?: number | null;
  readonly rpe?: number | null;
}

export interface PrLogSpec {
  /** The authored exercise of the occurrence. */
  readonly exerciseId: string;
  /** The performed exercise id when the occurrence was substituted. */
  readonly performedExerciseId?: string;
  readonly isSkipped?: boolean;
  readonly source?: 'template' | 'user_added';
  readonly type: 'reps' | 'duration';
  readonly sets: ReadonlyArray<PrSetSpec>;
}

export interface PrSessionSpec {
  readonly id: string;
  readonly userId: string;
  /** `null` (or omitted) persists detached history: the default here. */
  readonly enrollmentId?: string | null;
  /** Index into {@link PR_OCCURRENCES}. */
  readonly occurrence?: number;
  readonly startedAt: string;
  /** Omitted leaves the session in progress. */
  readonly completedAt?: string;
  readonly logs: ReadonlyArray<PrLogSpec>;
}

/**
 * Builds one session through the real domain factories and mutation services:
 * exercise orders run 1..n in the order the logs are given, set numbers follow
 * the domain rule, and a listed skip is applied through the skip service.
 */
export function prSession(spec: PrSessionSpec): WorkoutSession {
  const occurrence = PR_OCCURRENCES[spec.occurrence ?? 0];
  if (occurrence === undefined) {
    throw new Error(`Unknown occurrence index ${spec.occurrence ?? 0}`);
  }

  const created = createWorkoutSession({
    id: spec.id,
    userId: userId(spec.userId),
    enrollmentId:
      spec.enrollmentId === undefined || spec.enrollmentId === null
        ? null
        : enrollmentId(spec.enrollmentId),
    scheduledWorkoutId: scheduledWorkoutId(occurrence.scheduledWorkoutId),
    workoutId: workoutId(occurrence.workoutId),
    startedAt: new Date(spec.startedAt),
    exerciseLogs: spec.logs.map((log, index) => ({
      authoredExerciseId: exerciseId(log.exerciseId),
      performedExerciseId: exerciseId(log.performedExerciseId ?? log.exerciseId),
      order: index + 1,
      prescription: log.type === 'reps' ? reps() : duration(),
      restSeconds: 60,
      ...(log.source === undefined ? {} : { source: log.source }),
    })),
  });
  if (!created.ok) throw new Error(created.error.message);

  let session = created.data;
  for (const [index, log] of spec.logs.entries()) {
    for (const set of log.sets) {
      const base =
        log.type === 'reps'
          ? { type: 'reps' as const, reps: set.reps ?? 10 }
          : { type: 'duration' as const, durationSeconds: set.durationSeconds ?? 30 };
      const logged = logSessionSet(session, {
        exerciseOrder: index + 1,
        ...base,
        // `undefined` means "no external load" — never a truthiness fallback,
        // so an explicit 0 stays a logged 0 kg.
        weightKg: set.weightKg ?? null,
        rpe: set.rpe ?? null,
      });
      if (!logged.ok) throw new Error(logged.error.message);
      session = logged.data;
    }
    if (log.isSkipped === true) {
      const skipped = skipSessionExercise(session, { exerciseOrder: index + 1 });
      if (!skipped.ok) throw new Error(skipped.error.message);
      session = skipped.data;
    }
  }

  if (spec.completedAt !== undefined) {
    const completed = completeWorkoutSession(session, new Date(spec.completedAt));
    if (!completed.ok) throw new Error(completed.error.message);
    session = completed.data;
  }

  return session;
}

/** Persists sessions through the real write port (whole-aggregate saves). */
export async function savePrSessions(...sessions: ReadonlyArray<WorkoutSession>): Promise<void> {
  for (const session of sessions) {
    await workoutSessionRepository.save(session);
  }
}

/**
 * A fully specified record candidate. The position ladder is supplied
 * explicitly so tie-break scenarios can place a candidate exactly where the
 * semantics under test need it; the candidate's value is context only and
 * never influences the best-before query.
 */
export function prCandidate(spec: {
  readonly exerciseId: string;
  readonly metric: RecordMetric;
  readonly value: number;
  readonly completedAt: string;
  readonly startedAt: string;
  readonly sessionId: string;
  readonly exerciseOrder?: number;
  readonly setNumber?: number;
}): RecordCandidate {
  return {
    exerciseId: exerciseId(spec.exerciseId),
    metric: spec.metric,
    value: spec.value,
    position: {
      completedAt: new Date(spec.completedAt),
      startedAt: new Date(spec.startedAt),
      sessionId: workoutSessionId(spec.sessionId),
      exerciseOrder: spec.exerciseOrder ?? 1,
      setNumber: spec.setNumber ?? 1,
    },
  };
}

export interface QueryCountingRepository {
  readonly repository: PersonalRecordRepository;
  /** Statements the driver ran since creation, in order. */
  readonly queries: ReadonlyArray<string>;
  close: () => Promise<void>;
}

/**
 * A second, isolated connection pool whose driver reports every statement it
 * executes. Used to prove the batched reads issue exactly one statement for a
 * whole collection of exercises/candidates instead of one per item. The
 * repository under test is the production class.
 */
export function createQueryCountingRepository(): QueryCountingRepository {
  const queries: string[] = [];
  const client = postgres(getTestDatabaseUrl(), {
    max: 1,
    // Server-side prepared statements would surface as extra driver callbacks;
    // the simple protocol reports one callback per executed statement.
    prepare: false,
    debug: (_connection, query) => {
      queries.push(query);
    },
  });
  const repository = new DrizzlePersonalRecordRepository(drizzle(client, { schema }));

  return {
    repository,
    queries,
    close: async () => {
      await client.end();
    },
  };
}

