import { and, eq, gte, inArray, isNotNull, lt, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';

import type { PersonalRecordRepository } from '@/application/ports/personal-record-repository';
import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import type { CandidatePriorBest, PersonalBest } from '@/domain/services/personal-records';
import type { ExerciseId, UserId } from '@/domain/types/ids';

import type { Database } from '../client';
import {
  mapBestValuesBefore,
  mapCurrentPersonalBests,
  type PriorBestRow,
  type RecordBestRow,
} from '../mappers/personal-record-mapper';
import { exerciseLogs, setLogs, workoutSessions } from '../schema';

/**
 * Drizzle implementation of the Personal Records read port.
 *
 * Two exact queries, one round trip each — no persisted record state, no
 * candidate window, no per-exercise or per-candidate query:
 *
 * - Q1 (current bests): every eligible set of the requested exercises (all
 *   programs, detached history included, completed sessions only) ranked by
 *   `ROW_NUMBER() OVER (PARTITION BY performed exercise, record metric ORDER BY
 *   value DESC, completedAt, startedAt, sessionId, exerciseOrder, setNumber)`,
 *   keeping rank 1. Rank 1 IS the answer: the maximum eligible value, and on
 *   tied maxima the earliest performance of the chronological ladder. Every
 *   requested exercise is answered by this single statement.
 * - Q2 (best-before): the caller's candidates become a parameterized `VALUES`
 *   relation (ordinal + full position), and each candidate row carries its
 *   own correlated scalar `MAX(...)` subquery over eligible history, pinned
 *   to that candidate by the strictly-before ladder — no join, no GROUP BY,
 *   one aggregate evaluation per candidate, all in a single batched
 *   statement. The correlated shape is deliberate: the plan walks the
 *   candidates through the exercise/session/set indexes instead of scanning
 *   every set log (measured ~8x faster than the joined-and-grouped
 *   equivalent we rejected). A candidate with no prior eligible performance
 *   keeps a NULL aggregate: the honest "first exposure" answer. The whole
 *   candidate collection is answered by this single statement.
 *
 * The only structural interpretation Infrastructure makes is the metric
 * projection (`max-load` = reps set with `weight_kg IS NOT NULL`,
 * `max-bodyweight-reps` = reps set with `weight_kg IS NULL`, `max-duration` =
 * duration set, whose load is ignored). Eligibility, strictness (strictly
 * greater), equality handling and earliest-owner-on-tie remain Domain rules:
 * this repository returns facts in the Domain's own vocabulary, and it never
 * invents an `is_skipped`/`source`/`authored_exercise_id` predicate — a
 * skipped occurrence has no set rows, so it contributes nothing structurally.
 *
 * Chronology is the Domain's total ladder, oldest first, exactly as
 * `comparePerformancePositions` defines it: `completedAt`, `startedAt`,
 * `sessionId`, `exerciseOrder`, `setNumber`. Text comparisons are pinned to
 * the `"C"` collation so they are byte-wise like the Domain's string
 * comparison, instead of depending on the database's default collation.
 * Persisted instants always originate as JavaScript `Date`s (millisecond
 * precision), so SQL timestamp equality and the Domain's `Date` equality
 * coincide.
 */
export class DrizzlePersonalRecordRepository implements PersonalRecordRepository {
  constructor(private readonly db: Database) {}

  async findCurrentPersonalBests(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
  ): Promise<ReadonlyArray<PersonalBest>> {
    if (exerciseIds.length === 0) {
      return [];
    }

    return mapCurrentPersonalBests(await this.selectRankedBestRows(userId, exerciseIds, null));
  }

  async findCurrentPersonalBestsSetBetween(
    userId: UserId,
    from: Date,
    to: Date,
  ): Promise<ReadonlyArray<PersonalBest>> {
    // Rank first, filter the winner afterwards: the window reaches the shared
    // projection as a predicate on the rank-1 row only, so the ranking itself
    // always sees all eligible history and this can never answer "best value
    // within the window" or "PR events in the window".
    return mapCurrentPersonalBests(await this.selectRankedBestRows(userId, null, { from, to }));
  }

  /**
   * The shared ranked projection behind both current-best reads: ONE statement
   * that ranks every eligible set of the user's completed history per
   * (PERFORMED exercise, metric) — maximum value first, then the ascending
   * chronological ladder, so a tied maximum stays with its earliest owner.
   *
   * `exerciseIds` narrows candidacy (an eligibility scope, never a ranking
   * input) and is `null` to rank every exercise. `establishedIn`, when given,
   * is applied ONLY to the winning row beside `rank = 1`: the ranking always
   * sees all eligible history, which is exactly what makes
   * `findCurrentPersonalBestsSetBetween` mean "current best ESTABLISHED in the
   * window" rather than "best value within the window".
   *
   * This method is the single definition of the M12 metric projection, value
   * projection and rank ladder; both public reads share it and the Domain
   * `foldPersonalRecords` oracle verifies its output in the integration suite.
   * Callers perform no further filtering, re-ranking or re-interpretation.
   */
  private async selectRankedBestRows(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId> | null,
    establishedIn: { readonly from: Date; readonly to: Date } | null,
  ): Promise<ReadonlyArray<RecordBestRow>> {
    // The metric projection: a duration set is always `max-duration` (its load
    // is irrelevant), a loaded rep set is `max-load` (0 kg included, since the
    // check is IS NOT NULL and never truthiness), and an unloaded rep set is
    // `max-bodyweight-reps`.
    const metricOfSet = sql<string>`case
      when ${setLogs.type} = 'duration' then 'max-duration'
      when ${setLogs.weightKg} is not null then 'max-load'
      else 'max-bodyweight-reps'
    end`;

    // The value of one eligible set in its own metric's unit, unified to
    // `numeric` so ordering is an exact decimal comparison (never float).
    const valueOfSet = sql<unknown>`case
      when ${setLogs.type} = 'duration' then ${setLogs.durationSeconds}::numeric
      when ${setLogs.weightKg} is not null then ${setLogs.weightKg}
      else ${setLogs.reps}::numeric
    end`;

    const ranked = this.db
      .select({
        exerciseId: exerciseLogs.exerciseId,
        metric: metricOfSet.as('metric'),
        value: valueOfSet.as('value'),
        completedAt: workoutSessions.completedAt,
        startedAt: workoutSessions.startedAt,
        sessionId: workoutSessions.id,
        exerciseOrder: exerciseLogs.exerciseOrder,
        setNumber: setLogs.setNumber,
        // Value descending first, then the ascending chronological ladder: the
        // earliest performance among equal maxima wins the rank.
        rank: sql<number>`row_number() over (
          partition by ${exerciseLogs.exerciseId}, ${metricOfSet}
          order by ${valueOfSet} desc,
                   ${workoutSessions.completedAt} asc,
                   ${workoutSessions.startedAt} asc,
                   ${workoutSessions.id} collate "C" asc,
                   ${exerciseLogs.exerciseOrder} asc,
                   ${setLogs.setNumber} asc
        )`.as('record_rank'),
      })
      .from(setLogs)
      .innerJoin(
        exerciseLogs,
        and(
          eq(setLogs.sessionId, exerciseLogs.sessionId),
          eq(setLogs.exerciseOrder, exerciseLogs.exerciseOrder),
        ),
      )
      .innerJoin(workoutSessions, eq(exerciseLogs.sessionId, workoutSessions.id))
      .where(
        and(
          eq(workoutSessions.userId, userId),
          isNotNull(workoutSessions.completedAt),
          exerciseIds === null ? undefined : inArray(exerciseLogs.exerciseId, [...exerciseIds]),
        ),
      )
      .as('ranked');

    return this.db
      .select({
        exerciseId: ranked.exerciseId,
        metric: ranked.metric,
        value: ranked.value,
        completedAt: ranked.completedAt,
        startedAt: ranked.startedAt,
        sessionId: ranked.sessionId,
        exerciseOrder: ranked.exerciseOrder,
        setNumber: ranked.setNumber,
      })
      .from(ranked)
      .where(
        and(
          eq(ranked.rank, 1),
          // The window is a predicate on the WINNER only. `from` is inclusive
          // and `to` exclusive, matching the Domain's `[from, to)` contract.
          establishedIn === null
            ? undefined
            : and(
                gte(ranked.completedAt, establishedIn.from),
                lt(ranked.completedAt, establishedIn.to),
              ),
        ),
      )
      .orderBy(sql`${ranked.exerciseId} collate "C" asc`, sql`${ranked.metric} collate "C" asc`);
  }

  async findBestValuesBefore(
    userId: UserId,
    candidates: ReadonlyArray<RecordCandidate>,
  ): Promise<ReadonlyArray<CandidatePriorBest>> {
    if (candidates.length === 0) {
      return [];
    }

    // Candidate identity travels as an ordinal plus the full position ladder.
    // The ordinal is a transport detail of this query only (it never reaches
    // Domain semantics); it is what keeps candidates that share exercise,
    // metric, value and timestamps distinguishable on the way back.
    //
    // Instants are bound as ISO strings: the raw `sql` placeholder bypasses the
    // timestamp column's driver mapping (which is where Drizzle normally
    // serializes `Date`s), and an ISO string carries the exact instant at the
    // millisecond precision the Domain compares with.
    const candidateTuples = sql.join(
      candidates.map(
        (candidate, ord) => sql`(
          ${ord}::int,
          ${candidate.exerciseId}::text,
          ${candidate.metric}::text,
          ${candidate.position.completedAt.toISOString()}::timestamptz,
          ${candidate.position.startedAt.toISOString()}::timestamptz,
          ${candidate.position.sessionId}::text,
          ${candidate.position.exerciseOrder}::int,
          ${candidate.position.setNumber}::int
        )`,
      ),
      sql`, `,
    );

    const candidateRelation = sql`(values ${candidateTuples}) as candidate (
      ord, exercise_id, metric, completed_at, started_at, session_id, exercise_order, set_number
    )`;

    // One correlated aggregate per candidate. The subquery's FROM contains only
    // eligible history rows of the requesting user, so `max(...)` is exactly the
    // best value strictly before the candidate and a NULL result means — and
    // only means — that nothing precedes it. Candidate-driven on purpose: the
    // plan walks the candidates through the exercise/session/set indexes rather
    // than scanning every set log in the database (measured 8x faster than the
    // joined-and-grouped equivalent on a 297k-set table).
    //
    // The subquery spells its own FROM aliases (`ws`, `el`, `sl`) because a bare
    // `sql` fragment is rendered without table qualification: with aliases every
    // column reference is unambiguous by construction.
    const bestBefore = sql<unknown>`(
      select max(
        case
          when candidate.metric = 'max-duration' then sl.duration_seconds::numeric
          when candidate.metric = 'max-load' then sl.weight_kg
          else sl.reps::numeric
        end
      )
      from ${workoutSessions} ws
      inner join ${exerciseLogs} el
        on el.session_id = ws.id
       and el.exercise_id = candidate.exercise_id
      inner join ${setLogs} sl
        on sl.session_id = el.session_id
       and sl.exercise_order = el.exercise_order
       and sl.type = case when candidate.metric = 'max-duration' then 'duration' else 'reps' end
       and (candidate.metric <> 'max-load' or sl.weight_kg is not null)
       and (candidate.metric <> 'max-bodyweight-reps' or sl.weight_kg is null)
      where ws.user_id = ${userId}
        and ws.completed_at is not null
        and ${this.candidateIsStrictlyLaterThanHistory()}
    )`;

    const rows: PriorBestRow[] = await this.db
      .select({
        ord: sql<number>`candidate.ord`,
        bestBefore,
      })
      .from(candidateRelation)
      .orderBy(sql`candidate.ord asc`);

    return mapBestValuesBefore(rows, candidates);
  }

  /**
   * The strictly-before predicate, expanded from the Domain's lexicographic
   * ladder `(completedAt, startedAt, sessionId, exerciseOrder, setNumber)`:
   * history H precedes candidate C exactly when the tuple comparison `H < C`
   * holds. Written as an OR/AND chain rather than a row-value comparison,
   * matching the keyset style of the training-history repository; all five
   * rungs are spelled out so no tie-break level can be silently lost.
   *
   * The aliases are the correlated history subquery's own (`ws`
   * = `workout_sessions`, `el` = `exercise_logs`, `sl` = `set_logs`).
   */
  private candidateIsStrictlyLaterThanHistory(): SQL {
    return sql`(
      ws.completed_at < candidate.completed_at
      or (ws.completed_at = candidate.completed_at
          and ws.started_at < candidate.started_at)
      or (ws.completed_at = candidate.completed_at
          and ws.started_at = candidate.started_at
          and ws.id collate "C" < candidate.session_id)
      or (ws.completed_at = candidate.completed_at
          and ws.started_at = candidate.started_at
          and ws.id collate "C" = candidate.session_id
          and el.exercise_order < candidate.exercise_order)
      or (ws.completed_at = candidate.completed_at
          and ws.started_at = candidate.started_at
          and ws.id collate "C" = candidate.session_id
          and el.exercise_order = candidate.exercise_order
          and sl.set_number < candidate.set_number)
    )`;
  }
}
