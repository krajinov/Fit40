/**
 * Real-PostgreSQL workout-session fixtures (M17 Slice 6).
 *
 * Not a test file. Suite seeding of `workout_sessions` now goes through the
 * SAME INSERT statements production uses — `insertWorkoutSessionRows`, the
 * INSERT half of the creation authority — run inside a test-owned transaction.
 * A suite can no longer seed through `WorkoutSessionRepository`, because that
 * port has no insert at all: production creation is owned by
 * `DrizzleRunOccurrenceWrites.createSessionForOccurrence`.
 *
 * Seeding deliberately bypasses that authority's two coordination steps (the
 * enrollment lock and the settled-occurrence refusal). It exists precisely to
 * build the arbitrary persisted state a guarded creation path cannot produce —
 * detached history, zero-work snapshots, completed sessions, hand-crafted
 * occurrence keys — so it must not pretend to be production creation.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';
import { insertWorkoutSessionRows } from '@/infrastructure/database/repositories/workout-session-writes';

import { db } from './setup';

/**
 * Seeds one session aggregate (its row and its children) and returns it with
 * the committed version that the database wrote, mirroring what the creation
 * authority hands back to the Application.
 */
export async function insertSession(session: WorkoutSession): Promise<WorkoutSession> {
  const committedVersion = await db.transaction((tx) => insertWorkoutSessionRows(tx, session));
  return { ...session, version: committedVersion };
}
