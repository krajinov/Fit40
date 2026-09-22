/**
 * Personal-record repository port (read side, M12).
 *
 * The exact read boundary of the Personal Records feature. The Domain stays
 * the semantic authority: `src/domain/services/personal-record-metrics.ts`
 * owns metric eligibility and the chronological ladder, and
 * `src/domain/services/personal-records.ts` owns historical event resolution
 * and current-best ownership. This port only asks two exact questions about
 * the user's COMPLETED history and returns rows in the Domain's own
 * vocabulary, so an implementation can never decide a record rule on its own.
 *
 * Contract shared by both methods:
 * - Scopes to sessions OWNED by the user (`user_id`), regardless of
 *   enrollment: detached (left-program) history is the user's training past
 *   and counts.
 * - Completed sessions only; an in-progress session contributes nothing.
 * - No persisted or cached record state: every call re-derives from logged
 *   set history, so records can never drift from the sessions they describe.
 * - No bounded window, page size, or top-K over-fetch: the answer is the
 *   exact all-time (or exact everything-before) answer.
 * - The three locked metric classes and the position ladder are the only
 *   structural projections an implementation may make; eligibility rules,
 *   strictness (strictly greater), and earliest-owner-on-tie are Domain
 *   decisions that are never re-implemented here.
 * - One batched database round trip per call: never one query per exercise or
 *   per candidate.
 */

import type { RecordCandidate } from '@/domain/services/personal-record-metrics';
import type { CandidatePriorBest, PersonalBest } from '@/domain/services/personal-records';
import type { ExerciseId, UserId } from '@/domain/types/ids';

/**
 * Read port for exact Personal Records over completed training history.
 */
export interface PersonalRecordRepository {
  /**
   * Returns the exact current all-time personal best of every requested
   * exercise that has eligible completed history.
   *
   * Each entry carries the performed exercise id, the record metric, the
   * winning value in the metric's own unit (kilograms, reps, seconds) and the
   * exact `PerformancePosition` of the winning performance, so callers can
   * consume it as the Domain's `PersonalBest` without further interpretation.
   *
   * Contract:
   * - The maximum eligible value per (performed exercise, metric) wins; when
   *   several performances share that maximum, the EARLIEST position in the
   *   chronological ladder owns the best.
   * - Eligible history includes detached sessions and every program; the
   *   occurrence's PERFORMED exercise id is the attribution key, so
   *   substitutions and user-added occurrences credit the exercise actually
   *   trained. Occurrences with no logged sets contribute nothing.
   * - Results are per distinct requested exercise: an exercise with no
   *   eligible history is simply absent (callers decide whether absence is a
   *   display concern).
   * - Deterministic order: exercise id ascending, then metric ascending.
   * - An empty `exerciseIds` returns an empty result without querying.
   * - All requested exercises are answered in one batched query.
   */
  findCurrentPersonalBests(
    userId: UserId,
    exerciseIds: ReadonlyArray<ExerciseId>,
  ): Promise<ReadonlyArray<PersonalBest>>;

  /**
   * Returns, for every supplied candidate in exactly the order given, the
   * exact maximum eligible value of the same (user, performed exercise,
   * metric) that lies STRICTLY BEFORE the candidate's `PerformancePosition`
   * under the Domain's total chronological ladder (`completedAt`, `startedAt`,
   * `sessionId`, `exerciseOrder`, `setNumber`).
   *
   * Contract:
   * - Exactly one result per input candidate, in input order; the entry's
   *   `candidate` is the very object that was passed in, so correspondence is
   *   unambiguous even when several candidates share exercise, metric, value
   *   and timestamps.
   * - `bestBefore` is null when nothing eligible precedes the candidate (a
   *   first exposure), and otherwise the exact maximum of everything strictly
   *   before it — equal previous values ARE returned (the Domain's strictness
   *   rule, not this read, decides whether that is a new record).
   * - The candidate's own value and its own set never enter the computation;
   *   only its identity and position do.
   * - The whole candidate collection is answered in one batched query.
   * - An empty `candidates` returns an empty result without querying.
   */
  findBestValuesBefore(
    userId: UserId,
    candidates: ReadonlyArray<RecordCandidate>,
  ): Promise<ReadonlyArray<CandidatePriorBest>>;
}
