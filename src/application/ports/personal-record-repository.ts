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
   * Returns the user's CURRENT, still-standing all-time personal bests whose
   * WINNING performance was established in `[from, to)` — every exercise, no
   * exercise list required.
   *
   * This is deliberately NOT any of the following, and an implementation must
   * never drift into them:
   * - NOT the best performance inside the window (the window never narrows the
   *   ranking — only the already-chosen winner is filtered by it);
   * - NOT the historical PR events that occurred inside the window;
   * - NOT every record achieved during the window: a best set inside the
   *   window and surpassed later (inside or after it) is no longer a current
   *   best and does not appear.
   *
   * Semantics are exactly `findCurrentPersonalBests`'s, only then filtered:
   * - The ranking runs over ALL of the user's eligible history first: maximum
   *   eligible value per (PERFORMED exercise, metric), and on tied maxima the
   *   EARLIEST position in the chronological ladder owns the best. Only after
   *   that winner is known may the read keep it — or drop it — according to
   *   whether its own `completedAt` lies in `[from, to)` (`from` inclusive,
   *   `to` exclusive). Consequently a window containing an equal-to-maximum
   *   performance does not surface it while an earlier equal owner sits
   *   outside the window, and a window containing the all-time winner does.
   * - A first exposure is a record, so it appears when its session completed
   *   inside the window and nothing later surpassed it.
   * - Attribution, eligibility and the metric taxonomy are M12's and are not
   *   re-decided here: the performed exercise id owns the record (a
   *   substitution credits the replacement, the authored exercise receives
   *   nothing), user-added occurrences are fully eligible, detached completed
   *   history counts, and skipped or zero-set occurrences contribute no
   *   candidate. `0 kg` is a real external load where M12 says so, and the
   *   duration/bodyweight/load metrics keep their meanings.
   * - Deterministic order: exercise id ascending, then metric ascending (the
   *   same canonical order as `findCurrentPersonalBests`).
   * - Answered in ONE batched statement: the window is a predicate on the
   *   ranked result, never a second query and never one query per exercise.
   */
  findCurrentPersonalBestsSetBetween(
    userId: UserId,
    from: Date,
    to: Date,
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
