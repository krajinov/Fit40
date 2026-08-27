/**
 * Fixtures for the refused-session-write unit tests.
 *
 * A session mutation is read-then-write; to test a refused save, these fixtures
 * seed a stored session, capture a snapshot of it, and give a second writer a
 * repository that keeps reading that snapshot while its writes reach the real
 * store — exactly what an overlapping request looks like.
 */

import type { WorkoutSessionRepository } from '@/application/ports/workout-session-repository';
import {
  createWorkoutSession,
  logSessionSet,
  type WorkoutSession,
} from '@/domain/entities/workout-session';
import {
  createExerciseId,
  createScheduledWorkoutId,
  createWorkoutId,
  createWorkoutSessionId,
} from '@/domain/types/ids';
import { createRepScheme } from '@/domain/value-objects/rep-prescription';
import { InMemoryWorkoutSessionRepository } from '@/infrastructure/sessions/in-memory-workout-session-repository';

export const SESSION_ID = 's-1';

export const REPS = { type: 'reps', weightKg: null, rpe: null } as const;

export function rep() {
  const result = createRepScheme(3, 8, 10);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function eid(value: string) {
  const result = createExerciseId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function swid(value: string) {
  const result = createScheduledWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

function wid(value: string) {
  const result = createWorkoutId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

export function sessionIdOf(value: string) {
  const result = createWorkoutSessionId(value);
  if (!result.ok) throw new Error(result.error.message);
  return result.data;
}

/** Stores a session with one logged set and returns it alongside its snapshot. */
export async function seedAndSnapshot(): Promise<{
  repo: InMemoryWorkoutSessionRepository;
  stale: WorkoutSession;
}> {
  const repo = new InMemoryWorkoutSessionRepository();
  const created = createWorkoutSession({
    id: SESSION_ID,
    scheduledWorkoutId: swid('sw-1'),
    workoutId: wid('w-1'),
    startedAt: new Date('2025-01-01T10:00:00Z'),
    exerciseLogs: [
      { exerciseId: eid('ex-001'), order: 1, prescription: rep() },
      { exerciseId: eid('ex-002'), order: 2, prescription: rep() },
    ],
  });
  if (!created.ok) throw new Error(created.error.message);
  await repo.save(created.data);

  const logged = logSessionSet(created.data, { exerciseOrder: 1, ...REPS, reps: 10 });
  if (!logged.ok) throw new Error(logged.error.message);
  const saved = await repo.save(logged.data);
  if (!saved.ok) throw new Error('Failed to seed the logged session');

  const stale = await repo.findById(sessionIdOf(SESSION_ID));
  if (stale === null) throw new Error('Expected the seeded session to be stored');

  return { repo, stale };
}

export async function storedSession(
  repo: InMemoryWorkoutSessionRepository,
): Promise<WorkoutSession> {
  const stored = await repo.findById(sessionIdOf(SESSION_ID));
  if (stored === null) throw new Error('Expected the session to be stored');
  return stored;
}

export function setCounts(session: WorkoutSession): number[] {
  return session.exerciseLogs.map((log) => log.sets.length);
}

/**
 * Answers every read with `snapshot` while writes still reach the real store,
 * so the store is what refuses the stale aggregate.
 */
export function readingAs(
  sessions: InMemoryWorkoutSessionRepository,
  snapshot: WorkoutSession,
): WorkoutSessionRepository {
  return {
    findById: async (id) => (id === snapshot.id ? snapshot : sessions.findById(id)),
    findByScheduledWorkoutId: (id) => sessions.findByScheduledWorkoutId(id),
    save: (session) => sessions.save(session),
    listCompleted: () => sessions.listCompleted(),
  };
}