import { and, asc, count, desc, eq, inArray, isNotNull, lt, or } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type {
  CompletedWorkoutSession,
  TrainingHistoryCursor,
  TrainingHistoryEntry,
  TrainingHistoryPage,
  TrainingHistoryQuery,
  TrainingHistoryRepository,
  TrainingHistoryTotals,
} from '@/application/ports/training-history-repository';
import type { UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import { mapSessionRows } from '../mappers/session-mapper';
import { exerciseLogs, setLogs, trainingPrograms, workoutSessions, workouts } from '../schema';

type SessionRow = typeof workoutSessions.$inferSelect;
type ExerciseLogRow = typeof exerciseLogs.$inferSelect;
type SetLogRow = typeof setLogs.$inferSelect;

/** One Q1 row: the full session row plus the display names from the joins. */
interface HistoryRow {
  readonly session: SessionRow;
  readonly workoutName: string;
  readonly programName: string;
}

/**
 * Drizzle implementation of the TrainingHistoryRepository read port.
 *
 * Query strategy — three queries per page, never one per session:
 * - Q1 selects the page of completed sessions (keyset-filtered, LIMIT+1 for
 *   next-page detection) together with the workout template's and program's
 *   display names via inner joins. A workout template belongs to exactly one
 *   program, so the program name is unambiguous.
 * - Q2/Q3 batch-fetch the exercise logs and set logs of exactly the page's
 *   sessions, then reuse the aggregate hydration mapper per session.
 *
 * The keyset tuple comparison `(completed_at, started_at, id) < (c, s, i)` is
 * expanded into the equivalent boolean OR/AND predicate chain instead of raw
 * row-value SQL: same deterministic ordering semantics, fully typed columns,
 * no SQL casts. Ordering is `completed_at` DESC, `started_at` DESC, `id` DESC
 * — the trailing id tiebreaker makes the order total.
 *
 * `completed_at IS NOT NULL` is a structural filter of every query; a null
 * value that survives it is treated as corrupt data (thrown — unexpected,
 * not a business outcome), so every returned record is a
 * `CompletedWorkoutSession` with non-null `completedAt`.
 */
export class DrizzleTrainingHistoryRepository implements TrainingHistoryRepository {
  constructor(private readonly db: Database) {}

  async listCompletedSessions(
    userId: UserId,
    query: TrainingHistoryQuery,
  ): Promise<TrainingHistoryPage> {
    // Q1: one page of completed sessions plus display names. LIMIT+1: the
    // extra row only proves that a next page exists; it is never hydrated.
    const rows = await this.db
      .select({
        session: workoutSessions,
        workoutName: workouts.name,
        programName: trainingPrograms.name,
      })
      .from(workoutSessions)
      .innerJoin(workouts, eq(workoutSessions.workoutId, workouts.id))
      .innerJoin(trainingPrograms, eq(workouts.programId, trainingPrograms.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          isNotNull(workoutSessions.completedAt),
          query.after === null ? undefined : this.keysetAfter(query.after),
        ),
      )
      .orderBy(
        desc(workoutSessions.completedAt),
        desc(workoutSessions.startedAt),
        desc(workoutSessions.id),
      )
      .limit(query.limit + 1);

    const hasMore = rows.length > query.limit;
    const pageRows = hasMore ? rows.slice(0, query.limit) : rows;
    const entries = pageRows.length === 0 ? [] : await this.hydratePage(pageRows);

    const lastRow = pageRows[pageRows.length - 1];
    return {
      entries,
      nextAfter:
        hasMore && lastRow !== undefined ? this.cursorOf(lastRow.session) : null,
    };
  }

  /**
   * Strictly-older-than-cursor predicate: the tuple comparison
   * `(completed_at, started_at, id) < (c, s, i)` expanded into its equivalent
   * boolean disjunctive form.
   */
  private keysetAfter(after: TrainingHistoryCursor): SQL | undefined {
    return or(
      lt(workoutSessions.completedAt, after.completedAt),
      and(
        eq(workoutSessions.completedAt, after.completedAt),
        lt(workoutSessions.startedAt, after.startedAt),
      ),
      and(
        eq(workoutSessions.completedAt, after.completedAt),
        eq(workoutSessions.startedAt, after.startedAt),
        lt(workoutSessions.id, after.sessionId),
      ),
    );
  }

  /** Builds the resume position from a row trusted to be completed. */
  private cursorOf(session: SessionRow): TrainingHistoryCursor {
    const completed = this.completedAtOf(session);
    return {
      completedAt: completed,
      startedAt: session.startedAt,
      sessionId: session.id as TrainingHistoryCursor['sessionId'],
    };
  }

  private completedAtOf(session: SessionRow): Date {
    if (session.completedAt === null) {
      throw new Error(
        `Corrupt data in workout_sessions (id=${session.id}): completed_at is null despite the completed-only filter`,
      );
    }
    return session.completedAt;
  }

  /**
   * Hydrates the page's sessions from the batched child rows: Q2 fetches the
   * exercise logs of all page sessions at once, Q3 their set logs. Each
   * session then reuses the shared aggregate hydration mapper, so the
   * domain invariants (sequential exercise order, set shapes) are enforced
   * exactly as in every other read path. Kept private and per-instance: no
   * other repository is allowed to grow this capability.
   */
  private async hydratePage(rows: ReadonlyArray<HistoryRow>): Promise<TrainingHistoryEntry[]> {
    const sessionIds = rows.map((row) => row.session.id);
    const logRows = await this.db
      .select()
      .from(exerciseLogs)
      .where(inArray(exerciseLogs.sessionId, sessionIds))
      .orderBy(asc(exerciseLogs.sessionId), asc(exerciseLogs.exerciseOrder));
    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(inArray(setLogs.sessionId, sessionIds))
      .orderBy(asc(setLogs.sessionId), asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    const logsBySession = new Map<string, ExerciseLogRow[]>();
    for (const row of logRows) {
      const list = logsBySession.get(row.sessionId) ?? [];
      list.push(row);
      logsBySession.set(row.sessionId, list);
    }
    const setsBySession = new Map<string, SetLogRow[]>();
    for (const row of setRows) {
      const list = setsBySession.get(row.sessionId) ?? [];
      list.push(row);
      setsBySession.set(row.sessionId, list);
    }

    return rows.map((row) => {
      const session: CompletedWorkoutSession = {
        ...mapSessionRows({
          session: row.session,
          exerciseLogs: logsBySession.get(row.session.id) ?? [],
          setLogs: setsBySession.get(row.session.id) ?? [],
        }),
        completedAt: this.completedAtOf(row.session),
      };
      return {
        session,
        workoutName: row.workoutName,
        programName: row.programName,
      };
    });
  }

  async getTotals(userId: UserId): Promise<TrainingHistoryTotals> {
    // The user's completed sessions and their set logs. Set logs only exist
    // for exercise logs of sessions — INNER JOIN both, so detached history
    // contributes and in-progress sessions are excluded by the completed
    // filter. Counts a NOT NULL column (equivalent to COUNT(*), clearer to
    // the planner than a whole-row reference).
    const rows = await this.db
      .select({ setCount: count(setLogs.sessionId) })
      .from(setLogs)
      .innerJoin(exerciseLogs, and(
        eq(setLogs.sessionId, exerciseLogs.sessionId),
        eq(setLogs.exerciseOrder, exerciseLogs.exerciseOrder),
      ))
      .innerJoin(workoutSessions, eq(exerciseLogs.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          isNotNull(workoutSessions.completedAt),
        ),
      );

    // Set logs reference their session's exercise log (composite FK), so
    // every joined set row belongs to exactly one completed session of the
    // user; the single-row count is the totals definition.
    const setCount = rows[0]?.setCount ?? 0;

    const sessionRows = await this.db
      .select({ sessionCount: count(workoutSessions.id) })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          isNotNull(workoutSessions.completedAt),
        ),
      );
    const sessionCount = sessionRows[0]?.sessionCount ?? 0;

    return { completedSessions: sessionCount, loggedSets: setCount };
  }
}

