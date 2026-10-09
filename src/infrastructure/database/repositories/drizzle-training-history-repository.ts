import { and, asc, count, desc, eq, exists, gte, inArray, isNotNull, lt, lte, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type {
  CompletedExerciseOccurrence,
  CompletedSessionActivityEntry,
  CompletedSessionContext,
  CompletedWorkoutSession,
  ProgressionHistoryPerformance,
  ProgressSessionActivityEntry,
  TrainingHistoryCursor,
  TrainingHistoryEntry,
  TrainingHistoryPage,
  TrainingHistoryQuery,
  TrainingHistoryRepository,
  TrainingHistoryTotals,
} from '@/application/ports/training-history-repository';
import type { ExerciseId, UserId, WorkoutSessionId } from '@/domain/types/ids';

import type { Database } from '../client';
import type { RecentPerformanceRow } from '../mappers/exercise-performance-mapper';
import { mapRecentCompletedExercisePerformances } from '../mappers/exercise-performance-mapper';
import type { ExerciseOccurrenceRow } from '../mappers/exercise-occurrence-mapper';
import { mapCompletedExerciseOccurrences } from '../mappers/exercise-occurrence-mapper';
import { mapSessionRows, parseWorkoutSessionId } from '../mappers/session-mapper';
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

  /**
   * The completion instant of a row that survived the completed-only filter.
   *
   * Structurally typed (just the two fields it reads) so every window read in
   * this repository can reuse the guard without selecting columns it does not
   * need; a null value that survived the filter is corrupt data, thrown
   * rather than tolerated.
   */
  private completedAtOf(session: { readonly id: string; readonly completedAt: Date | null }): Date {
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

  /**
   * Per-exercise occurrences, bounded and occurrence-based:
   * - Q1 selects up to `limit` matching exercise logs, joined to their
   *   owning completed session (ownership + completed-only are structural
   *   filters) and to the workout/program display names. An EXISTS
   *   subquery — no join — enforces the ≥1-logged-set contract, so
   *   duplicate rows cannot appear and the DISTINCT ladder ordering is
   *   untouched. Ordering is the history recency ladder plus
   *   exercise_order DESC so two occurrences in one session order
   *   truthfully by position.
   * - Q2 batch-hydrates the sets of exactly the returned occurrences in
   *   one query. Drizzle 0.45 has no row-value (tuple) `inArray`, so the
   *   (session_id, exercise_order) pair filter is a typed OR-of-ANDs —
   *   the same fully-typed expansion style as the keyset predicate.
   */
  async listCompletedExerciseOccurrences(
    userId: UserId,
    exerciseId: ExerciseId,
    limit: number,
  ): Promise<ReadonlyArray<CompletedExerciseOccurrence>> {
    const occurrenceRows: ExerciseOccurrenceRow[] = await this.db
      .select({
        sessionId: workoutSessions.id,
        exerciseOrder: exerciseLogs.exerciseOrder,
        startedAt: workoutSessions.startedAt,
        completedAt: workoutSessions.completedAt,
        workoutName: workouts.name,
        programName: trainingPrograms.name,
        prescriptionType: exerciseLogs.prescriptionType,
        prescribedSets: exerciseLogs.sets,
        minReps: exerciseLogs.minReps,
        maxReps: exerciseLogs.maxReps,
        durationSeconds: exerciseLogs.durationSeconds,
      })
      .from(exerciseLogs)
      .innerJoin(workoutSessions, eq(exerciseLogs.sessionId, workoutSessions.id))
      .innerJoin(workouts, eq(workoutSessions.workoutId, workouts.id))
      .innerJoin(trainingPrograms, eq(workouts.programId, trainingPrograms.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          eq(exerciseLogs.exerciseId, exerciseId),
          isNotNull(workoutSessions.completedAt),
          // A skipped exercise (zero set logs) is not an occurrence.
          exists(
            this.db
              .select({ one: sql`1` })
              .from(setLogs)
              .where(
                and(
                  eq(setLogs.sessionId, exerciseLogs.sessionId),
                  eq(setLogs.exerciseOrder, exerciseLogs.exerciseOrder),
                ),
              ),
          ),
        ),
      )
      .orderBy(
        desc(workoutSessions.completedAt),
        desc(workoutSessions.startedAt),
        desc(workoutSessions.id),
        desc(exerciseLogs.exerciseOrder),
      )
      .limit(limit);

    if (occurrenceRows.length === 0) {
      return [];
    }

    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(
        or(
          ...occurrenceRows.map((row) =>
            and(
              eq(setLogs.sessionId, row.sessionId),
              eq(setLogs.exerciseOrder, row.exerciseOrder),
            ),
          ),
        ),
      )
      .orderBy(asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    return mapCompletedExerciseOccurrences(occurrenceRows, setRows);
  }

  async listRecentCompletedExercisePerformances(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
    limitPerExercise: number,
  ): Promise<ReadonlyArray<ProgressionHistoryPerformance>> {
    if (exerciseIds.length === 0) {
      return [];
    }

    const performanceRows = await this.selectRecentPerformanceRows(userId, exerciseIds, limitPerExercise);
    if (performanceRows.length === 0) {
      return [];
    }

    // Batched second query: sets of every winning occurrence across all
    // requested exercises in one round trip (no per-exercise N+1). Set rows
    // of non-winning exercises in those sessions are ignored by the mapper's
    // (session, order) keying.
    const sessionIds = [...new Set(performanceRows.map((row) => row.sessionId))];
    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(inArray(setLogs.sessionId, sessionIds))
      .orderBy(asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    return mapRecentCompletedExercisePerformances(performanceRows, setRows);
  }

  /**
   * The per-exercise raw occurrence windows, newest first: one SELECT with a
   * `ROW_NUMBER() OVER (PARTITION BY exercise_id ORDER BY <recency ladder>)`
   * subquery that keeps each exercise's `limitPerExercise` newest candidate
   * logs, wrapped by an outer SELECT that re-orders by (exercise id asc,
   * ladder desc) so the mapper receives the groups in contract order.
   *
   * Semantics are identical to the single-exercise occurrence read: user-
   * owned sessions regardless of enrollment (detached included), completed
   * only, and at least one set log (a skipped exercise never shadows an older
   * real performance). Eligibility never enters the SQL — the bound is a raw
   * over-fetch ceiling and the domain engine does its own skipping.
   */
  private async selectRecentPerformanceRows(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
    limitPerExercise: number,
  ): Promise<ReadonlyArray<RecentPerformanceRow>> {
    const columns = {
      exerciseId: exerciseLogs.exerciseId,
      sessionId: workoutSessions.id,
      startedAt: workoutSessions.startedAt,
      exerciseOrder: exerciseLogs.exerciseOrder,
      completedAt: workoutSessions.completedAt,
      prescriptionType: exerciseLogs.prescriptionType,
      prescribedSets: exerciseLogs.sets,
      minReps: exerciseLogs.minReps,
      maxReps: exerciseLogs.maxReps,
      durationSeconds: exerciseLogs.durationSeconds,
    };

    const candidates = this.db
      .select(columns)
      .from(exerciseLogs)
      .innerJoin(workoutSessions, eq(exerciseLogs.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          isNotNull(workoutSessions.completedAt),
          inArray(exerciseLogs.exerciseId, [...exerciseIds]),
          // A performance requires at least one set: skipped exercises (zero
          // set logs) are filtered out of candidacy by an EXISTS subquery —
          // no join, so no duplicate candidate rows.
          exists(
            this.db
              .select({ one: sql`1` })
              .from(setLogs)
              .where(
                and(
                  eq(setLogs.sessionId, exerciseLogs.sessionId),
                  eq(setLogs.exerciseOrder, exerciseLogs.exerciseOrder),
                ),
              ),
          ),
        ),
      )
      .as('candidates');

    // The rank IS the recency ladder position: rank 1 is the exercise's newest
    // candidate occurrence. Both the projection and the window function
    // reference the candidates subquery's own columns — spreading the raw
    // `columns` object here would reference the underlying tables, which are
    // not part of this SELECT's FROM (Drizzle fails with "table exercise_logs
    // is not part of the query").
    const ranked = this.db
      .select({
        exerciseId: candidates.exerciseId,
        sessionId: candidates.sessionId,
        startedAt: candidates.startedAt,
        exerciseOrder: candidates.exerciseOrder,
        completedAt: candidates.completedAt,
        prescriptionType: candidates.prescriptionType,
        prescribedSets: candidates.prescribedSets,
        minReps: candidates.minReps,
        maxReps: candidates.maxReps,
        durationSeconds: candidates.durationSeconds,
        recencyRank: sql<number>`row_number() over (
          partition by ${candidates.exerciseId}
          order by ${candidates.completedAt} desc,
                   ${candidates.startedAt} desc,
                   ${candidates.sessionId} desc,
                   ${candidates.exerciseOrder} desc
        )`.as('recency_rank'),
      })
      .from(candidates)
      .as('ranked');

    // Rank ascending within each exercise-id-ascending group = newest first
    // (rank 1 first), exactly the window order the engine consumes.
    return this.db
      .select({
        exerciseId: ranked.exerciseId,
        sessionId: ranked.sessionId,
        exerciseOrder: ranked.exerciseOrder,
        completedAt: ranked.completedAt,
        prescriptionType: ranked.prescriptionType,
        prescribedSets: ranked.prescribedSets,
        minReps: ranked.minReps,
        maxReps: ranked.maxReps,
        durationSeconds: ranked.durationSeconds,
      })
      .from(ranked)
      .where(lte(ranked.recencyRank, limitPerExercise))
      .orderBy(asc(ranked.exerciseId), asc(ranked.recencyRank));
  }

  async findCompletedSessionById(
    userId: UserId,
    sessionId: WorkoutSessionId,
  ): Promise<CompletedSessionContext | null> {
    // Ownership, existence, and completed-only are all structural filters of
    // the same WHERE clause: a missing, foreign, or in-progress session is
    // the single outcome `null`, with no way for a caller to tell them apart.
    const rows: HistoryRow[] = await this.db
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
          eq(workoutSessions.id, sessionId),
          eq(workoutSessions.userId, userId),
          isNotNull(workoutSessions.completedAt),
        ),
      )
      .limit(1);

    const row = rows[0];
    if (row === undefined) {
      return null;
    }

    // Bounded hydration of exactly this session: the full log/set envelope
    // (the metrics input), ordered for deterministic rendering.
    const logRows = await this.db
      .select()
      .from(exerciseLogs)
      .where(eq(exerciseLogs.sessionId, sessionId))
      .orderBy(asc(exerciseLogs.exerciseOrder));

    const setRows = await this.db
      .select()
      .from(setLogs)
      .where(eq(setLogs.sessionId, sessionId))
      .orderBy(asc(setLogs.exerciseOrder), asc(setLogs.setNumber));

    const session: CompletedWorkoutSession = {
      ...mapSessionRows({
        session: row.session,
        exerciseLogs: logRows,
        setLogs: setRows,
      }),
      completedAt: this.completedAtOf(row.session),
    };

    return {
      session,
      programName: row.programName,
      workoutName: row.workoutName,
    };
  }

  /**
   * Bounded activity projection: the user's completed sessions at or after
   * `since`, newest first, WITHOUT aggregate hydration.
   *
   * Two statements, never one per session:
   * - Q1 selects the window's session rows (ownership and completed-only are
   *   structural filters) with the workout template's and program's display
   *   names via the same joins the history page uses. A workout template
   *   belongs to exactly one program, so the program name is unambiguous.
   * - Q2 batch-counts set rows for exactly those sessions in one grouped
   *   query. The count is plain, so a completed session with no set rows — a
   *   shape the domain's completion gate never produces — has no group and is
   *   reported with `loggedSets` `0` rather than dropped; it remains a
   *   completed session, and this read never redefines that.
   *
   * `since` is inclusive and is the ONLY bound: no keyset pagination and no
   * cap, because the caller aggregates a fixed window from these rows and a
   * truncated read would silently under-count it. Ordering is the same
   * deterministic recency ladder as the history list.
   */
  async listCompletedSessionActivity(
    userId: UserId,
    since: Date,
  ): Promise<ReadonlyArray<CompletedSessionActivityEntry>> {
    const rows: HistoryRow[] = await this.db
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
          gte(workoutSessions.completedAt, since),
        ),
      )
      .orderBy(
        desc(workoutSessions.completedAt),
        desc(workoutSessions.startedAt),
        desc(workoutSessions.id),
      );

    if (rows.length === 0) {
      // No sessions, no set-count query: an empty window is answered by Q1.
      return [];
    }

    // One grouped count for the whole window (no N+1). Set rows carry their
    // session id directly and always belong to a valid exercise log of that
    // session (composite FK), so counting by session id counts exactly the
    // session's logged sets — the same fact the lifetime totals count.
    const setCountRows = await this.db
      .select({ sessionId: setLogs.sessionId, setCount: count(setLogs.setNumber) })
      .from(setLogs)
      .where(inArray(setLogs.sessionId, rows.map((row) => row.session.id)))
      .groupBy(setLogs.sessionId);

    const setsBySession = new Map<string, number>();
    for (const row of setCountRows) {
      setsBySession.set(row.sessionId, row.setCount);
    }

    return rows.map((row) => ({
      sessionId: parseWorkoutSessionId(row.session.id, 'completed session activity'),
      workoutName: row.workoutName,
      programName: row.programName,
      startedAt: row.session.startedAt,
      completedAt: this.completedAtOf(row.session),
      loggedSets: setsBySession.get(row.session.id) ?? 0,
    }));
  }

  /**
   * M18 progress activity: the window's completed sessions with their logged
   * set count and their external-load volume (`docs/training-progress.md`
   * §4.1–§4.3, §6.3).
   *
   * Query strategy — two statements for the whole window, never one per
   * session:
   * - Q1 selects the window's sessions (ownership, completed-only and the
   *   inclusive `since` bound are structural filters; no cap, because the
   *   caller aggregates the whole window) ordered by the history recency
   *   ladder. Only the id and completion instant are projected.
   * - Q2 batch-aggregates exactly those sessions' set rows in one grouped
   *   query, projecting three facts per session: the plain set count, the
   *   count of ELIGIBLE sets (rep sets with a non-null weight) and the
   *   external-load sum (`reps × weightKg` over those same sets).
   *
   * The eligible-set count is what keeps §6.3 honest: a session with no
   * eligible set reports `null` (no external-load data — bodyweight and
   * duration training are not "zero"), while a session whose eligible sets
   * sum to zero reports a genuine `0`. The aggregation mirrors
   * `calculateSessionMetrics`' volume rule — `type = 'reps'` AND
   * `weight_kg IS NOT NULL`, duration and bodyweight sets excluded, `0 kg`
   * contributing zero — and the integration suite verifies it against that
   * Domain oracle rather than trusting the SQL.
   */
  async listProgressSessionActivity(
    userId: UserId,
    since: Date,
  ): Promise<ReadonlyArray<ProgressSessionActivityEntry>> {
    const rows: ReadonlyArray<ProgressSessionRow> = await this.db
      .select({
        id: workoutSessions.id,
        completedAt: workoutSessions.completedAt,
      })
      .from(workoutSessions)
      .where(
        and(
          eq(workoutSessions.userId, userId),
          isNotNull(workoutSessions.completedAt),
          gte(workoutSessions.completedAt, since),
        ),
      )
      .orderBy(
        desc(workoutSessions.completedAt),
        desc(workoutSessions.startedAt),
        desc(workoutSessions.id),
      );

    if (rows.length === 0) {
      // No sessions, no aggregation query: an empty window is answered by Q1.
      return [];
    }

    // One grouped aggregation for the whole window (no N+1). Set rows carry
    // their session id directly and always belong to a valid exercise log of
    // that session (composite FK), so the group is exactly the session's
    // logged sets. FILTER keeps the eligible-set predicate in one place;
    // `coalesce(..., 0)` never fabricates a row: a session with no eligible
    // set has `eligibleSetCount` 0 and is reported as `null` below.
    const aggregateRows = await this.db
      .select({
        sessionId: setLogs.sessionId,
        setCount: count(setLogs.setNumber),
        eligibleSetCount: sql<number>`count(*) filter (where ${setLogs.type} = 'reps' and ${setLogs.weightKg} is not null)::int`,
        volumeKgReps: sql<number>`coalesce(sum(${setLogs.reps} * ${setLogs.weightKg}) filter (where ${setLogs.type} = 'reps' and ${setLogs.weightKg} is not null), 0)::double precision`,
      })
      .from(setLogs)
      .where(inArray(setLogs.sessionId, rows.map((row) => row.id)))
      .groupBy(setLogs.sessionId);

    const aggregatesBySession = new Map<
      string,
      { readonly setCount: number; readonly eligibleSetCount: number; readonly volumeKgReps: number }
    >();
    for (const row of aggregateRows) {
      aggregatesBySession.set(row.sessionId, {
        setCount: row.setCount,
        eligibleSetCount: row.eligibleSetCount,
        volumeKgReps: row.volumeKgReps,
      });
    }

    return rows.map((row) => {
      const aggregate = aggregatesBySession.get(row.id);
      return {
        sessionId: parseWorkoutSessionId(row.id, 'progress session activity'),
        completedAt: this.completedAtOf(row),
        loggedSets: aggregate?.setCount ?? 0,
        externalLoadVolume:
          aggregate === undefined || aggregate.eligibleSetCount === 0
            ? null
            : aggregate.volumeKgReps,
      };
    });
  }
}

/** The minimal session projection the M18 progress read needs. */
interface ProgressSessionRow {
  readonly id: string;
  readonly completedAt: Date | null;
}

