/**
 * Reading a workout session aggregate — its parent row plus its exercise and set
 * logs — back out of PostgreSQL.
 *
 * Kept apart from the repository's write path so the repository stays focused on
 * the compare-and-swap save contract. Aggregates are always assembled through the
 * domain mapper, never returned as raw rows.
 */

import type { WorkoutSession } from '@/domain/entities/workout-session';

import { inArray } from 'drizzle-orm';

import { sessionToDomain } from '../mappers/session-mapper';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';

import type { DrizzleDatabase } from './types';

type SessionRow = typeof workoutSessions.$inferSelect;
type ExerciseLogRow = typeof exerciseLogs.$inferSelect;
type SetLogRow = typeof setLogs.$inferSelect;

/** Loads the aggregate a single session row belongs to. */
export async function loadSessionAggregate(
  db: DrizzleDatabase,
  row: SessionRow,
): Promise<WorkoutSession> {
  const [logRows, setRows] = await loadLogRows(db, [row.id]);

  return sessionToDomain(
    row,
    belongingTo(logRows, row.id),
    belongingTo(setRows, row.id),
  );
}

/**
 * Loads several aggregates with two queries total: every session's child rows are
 * fetched once and then distributed, rather than issuing three queries per row.
 */
export async function loadSessionAggregates(
  db: DrizzleDatabase,
  rows: ReadonlyArray<SessionRow>,
): Promise<ReadonlyArray<WorkoutSession>> {
  if (rows.length === 0) {
    return [];
  }

  const [logRows, setRows] = await loadLogRows(db, rows.map((row) => row.id));

  return rows.map((row) =>
    sessionToDomain(row, belongingTo(logRows, row.id), belongingTo(setRows, row.id)),
  );
}

async function loadLogRows(
  db: DrizzleDatabase,
  sessionIds: ReadonlyArray<string>,
): Promise<[ReadonlyArray<ExerciseLogRow>, ReadonlyArray<SetLogRow>]> {
  const exerciseLogRows = await db
    .select()
    .from(exerciseLogs)
    .where(inArray(exerciseLogs.sessionId, sessionIds))
    .orderBy(exerciseLogs.sessionId, exerciseLogs.exerciseOrder);

  const setLogRows = await db
    .select()
    .from(setLogs)
    .where(inArray(setLogs.sessionId, sessionIds))
    .orderBy(setLogs.sessionId, setLogs.exerciseOrder, setLogs.setNumber);

  return [exerciseLogRows, setLogRows];
}

function belongingTo<T extends { readonly sessionId: string }>(
  rows: ReadonlyArray<T>,
  sessionId: string,
): ReadonlyArray<T> {
  return rows.filter((row) => row.sessionId === sessionId);
}