/**
 * Shared builders and assertion projections for the M12 personal-record
 * suites.
 *
 * Not a test file: `personal-records-extraction.test.ts`,
 * `personal-records-events.test.ts` and `personal-records-fold.test.ts` import
 * these so every suite drives the public domain API through identical
 * builders. Sessions are always built through the real domain factory and the
 * real mutation services, so assertions describe genuine persisted shapes
 * rather than hand-written literals.
 */

import {
  completeWorkoutSession,
  createWorkoutSession,
  logSessionSet,
  type OccurrenceSource,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  extractRecordCandidates,
  foldPersonalRecords,
  type PersonalRecordHistory,
  type RecordEvent,
} from '@/domain/services/personal-records';
import { skipSessionExercise } from '@/domain/services/session-exercise-skip';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createUserId,
  createWorkoutId,
  createWorkoutSessionId,
  type ExerciseId,
} from '@/domain/types/ids';
import { createDurationScheme, createRepScheme } from '@/domain/value-objects/rep-prescription';

// ─── Builders ────────────────────────────────────────────────────────────────

export function reps() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function duration() {
  const result = createDurationScheme(3, 45);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function eid(value: string): ExerciseId {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function sid(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function sessionId(value: string) {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function uid(value: string) {
  const result = createUserId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function wid(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export type SetSpec =
  | { readonly type: 'reps'; readonly reps: number; readonly weightKg: number | null }
  | {
      readonly type: 'duration';
      readonly durationSeconds: number;
      readonly weightKg?: number | null;
    };

export interface LogSpec {
  readonly authored: string;
  readonly performed?: string;
  readonly source?: OccurrenceSource;
  readonly prescription?: 'reps' | 'duration';
  /** A skipped occurrence carries no sets (the aggregate enforces this). */
  readonly isSkipped?: boolean;
  readonly sets?: ReadonlyArray<SetSpec>;
}

export interface SessionSpec {
  readonly id: string;
  readonly startedAt: string;
  /** Omit to build an in-progress session. */
  readonly completedAt?: string;
  readonly logs: ReadonlyArray<LogSpec>;
}

export function inProgressSession(spec: SessionSpec): WorkoutSession {
  const created = createWorkoutSession({
    id: spec.id,
    userId: uid('user-1'),
    enrollmentId: null,
    scheduledWorkoutId: sid(`sw-${spec.id}`),
    workoutId: wid(`w-${spec.id}`),
    startedAt: new Date(spec.startedAt),
    exerciseLogs: spec.logs.map((log, index) => ({
      authoredExerciseId: eid(log.authored),
      order: index + 1,
      prescription: log.prescription === 'duration' ? duration() : reps(),
      restSeconds: 60,
      ...(log.performed === undefined ? {} : { performedExerciseId: eid(log.performed) }),
      ...(log.source === undefined ? {} : { source: log.source }),
    })),
  });
  if (!created.ok) throw new Error(`createWorkoutSession failed: ${created.error.message}`);

  let session = created.data;
  for (const [index, log] of spec.logs.entries()) {
    for (const set of log.sets ?? []) {
      const logged =
        set.type === 'reps'
          ? logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'reps',
              reps: set.reps,
              weightKg: set.weightKg,
              rpe: null,
            })
          : logSessionSet(session, {
              exerciseOrder: index + 1,
              type: 'duration',
              durationSeconds: set.durationSeconds,
              weightKg: set.weightKg ?? null,
              rpe: null,
            });
      if (!logged.ok) throw new Error(`logSessionSet failed: ${logged.error.message}`);
      session = logged.data;
    }
  }

  // Skip is applied through the real service, after the occurrence's sets are
  // in place — a skipped spec must therefore carry no sets. (The rehydrated
  // variant of the same persisted fact is covered separately through the
  // factory's `isSkipped` input.)
  for (const [index, log] of spec.logs.entries()) {
    if (log.isSkipped !== true) continue;
    const skipped = skipSessionExercise(session, { exerciseOrder: index + 1 });
    if (!skipped.ok) throw new Error(`skipSessionExercise failed: ${skipped.error.message}`);
    session = skipped.data;
  }

  return session;
}

export function completedSession(spec: SessionSpec): WorkoutSession {
  if (spec.completedAt === undefined) throw new Error('test spec must set completedAt');
  const completed = completeWorkoutSession(inProgressSession(spec), new Date(spec.completedAt));
  if (!completed.ok) throw new Error(`completeWorkoutSession failed: ${completed.error.message}`);
  return completed.data;
}

// ─── Scenario sessions ───────────────────────────────────────────────────────

export function loadSession(id: string, startedAt: string, completedAt: string, weightKg: number) {
  return completedSession({
    id,
    startedAt,
    completedAt,
    logs: [{ authored: 'ex-a', sets: [{ type: 'reps', reps: 8, weightKg }] }],
  });
}

// ─── Assertion projections ───────────────────────────────────────────────────

export function candidateLines(session: WorkoutSession): ReadonlyArray<string> {
  const result = extractRecordCandidates(session);
  if (!result.ok) throw new Error(result.error.message);
  return result.data.map(
    (candidate) =>
      `${candidate.exerciseId}/${candidate.metric}/${candidate.value}` +
      `@${candidate.position.exerciseOrder}.${candidate.position.setNumber}`,
  );
}

export function eventLines(events: ReadonlyArray<RecordEvent>): ReadonlyArray<string> {
  return events.map(
    (event) =>
      `${event.exerciseId}/${event.metric}/${event.value}/prev:${event.previousBest ?? 'none'}` +
      `@${event.position.sessionId}.${event.position.exerciseOrder}.${event.position.setNumber}`,
  );
}

export function bestLines(history: PersonalRecordHistory): ReadonlyArray<string> {
  return history.currentBests.map(
    (best) =>
      `${best.exerciseId}/${best.metric}/${best.value}` +
      `@${best.position.sessionId}.${best.position.exerciseOrder}.${best.position.setNumber}`,
  );
}

export function fold(sessions: ReadonlyArray<WorkoutSession>): PersonalRecordHistory {
  const result = foldPersonalRecords(sessions);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

