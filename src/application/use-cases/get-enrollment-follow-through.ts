/**
 * Use case: the authenticated user's M16 plan follow-through for one program run.
 *
 * Read-only. Ownership is resolved server-side from the trusted `userId` plus
 * the program pair, so one user can never read another user's run and the caller
 * never supplies an `EnrollmentId`.
 *
 * The report reconciles two authorities and never confuses them: calendar intent
 * comes from the run's planned rows (`planned_workouts`) and execution truth
 * from its sessions (`workout_sessions`). Nothing here writes, and no historical
 * plan is reconstructed — the report describes the calendar as it stands now.
 *
 * The program aggregate is supplied by the caller (the
 * `GetEnrollmentScheduleUseCase` / `GetProgramEnrollmentUseCase` convention):
 * the program request that renders the calendar already hydrated it, so this
 * read adds no catalog query. This read never consults the authored program at
 * all — it counts rows, so an occurrence id is an opaque key here.
 *
 * Three authoritative outcomes:
 * - `ok(null)` — the user is not enrolled in this program: there is no run,
 *   hence no report, and no downstream read is issued.
 * - `configured: false` — a run exists but has no planned rows yet: there is no
 *   calendar to reconcile, so no week and no total is fabricated. The run's
 *   recorded not-performed facts ARE read, because with zero planned rows every
 *   one of them is unplaced and their count is execution truth independent of
 *   the calendar; the session projections are not issued (they could not change
 *   the result).
 * - `configured: true` — one fact per CURRENT planned row, summarized by the
 *   Slice 1 Domain rules. This use case never re-decides an outcome or a count.
 *
 * The report's execution facts (completed activity, in-progress sessions and
 * the M17 records) are mutually exclusive per occurrence, so they are read
 * through ONE coherent snapshot port — never assembled from independent
 * statements that could tear across a concurrent settlement transition.
 *
 * M17 recorded-not-performed facts join this report WITHOUT changing its shape:
 * current planned rows stay the only report occurrences (a fact whose occurrence
 * has no row never becomes one), each row's facts gain `hasNotPerformedRecord` so
 * the existing Domain precedence reports `not-performed`, and the run's facts
 * whose occurrence holds no current row are counted separately as
 * `notPerformedUnplaced` — a bounded count, independent of the 8-week horizon,
 * that never touches a week or a total.
 *
 * Session-derived facts are a read-time derivation: a session that starts or
 * completes immediately after this read is reflected by the next read. M15
 * deliberately does not serialize planning writes against session writes, so
 * that bounded cosmetic window is accepted — truth stays session-derived.
 */

import {
  toConfiguredFollowThroughDto,
  toUnconfiguredFollowThroughDto,
  type EnrollmentFollowThroughDto,
} from '@/application/dto/follow-through';
import type { FollowThroughExecutionFactsRepository } from '@/application/ports/follow-through-execution-facts-repository';
import type { NotPerformedOccurrenceRepository } from '@/application/ports/not-performed-occurrence-repository';
import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type { CompletedOccurrenceActivity } from '@/application/ports/workout-session-repository';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { summarizeFollowThrough } from '@/domain/services/follow-through-week';
import type { PlannedOccurrenceFacts } from '@/domain/services/plan-follow-through';
import { listRecentTrainingWeekWindows } from '@/domain/services/training-week';
import {
  createEnrollmentId,
  createUserId,
  type ScheduledWorkoutId,
  type UserId,
} from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import { plannedDateFromInstant } from '@/domain/value-objects/planned-date';

/**
 * How many recent UTC training weeks the report covers: the same 8-week horizon
 * the M13 weekly insights use, so the product has one answer to "how far back do
 * we look".
 */
export const FOLLOW_THROUGH_WEEK_COUNT = 8;

export type GetEnrollmentFollowThroughError =
  | {
      readonly code: 'INVALID_INPUT';
      readonly message: string;
      readonly field?: string;
    }
  | {
      /**
       * The caller's expected enrollment no longer exists (a concurrent
       * restart/leave replaced the run): the read refuses to compose the
       * caller's old-enrollment parent with a new run's report. Never thrown —
       * the caller degrades, never mixing generations.
       */
      readonly code: 'ENROLLMENT_CHANGED';
      readonly message: string;
    };

export interface GetEnrollmentFollowThroughInput {
  readonly userId: string;
  /**
   * The program aggregate the caller already loaded (e.g. the program detail
   * page's `GetProgramBySlugUseCase` result). The use case never re-queries the
   * catalog, so one request hydrates the program exactly once.
   */
  readonly program: TrainingProgram;
  /** The request clock; `today` and the reported weeks derive from it, in UTC. */
  readonly now: Date;
  /**
   * The SPECIFIC enrollment the caller already loaded and is composing this
   * report into (the program detail's enrollment view). When supplied, the read
   * is fenced to exactly that identity: it never re-resolves the current
   * enrollment, so a concurrent restart/leave cannot compose the caller's
   * old-enrollment parent data with a NEW run's report. Omitted (or undefined),
   * the read resolves the current enrollment as before — the standalone read
   * convention.
   */
  readonly expectedEnrollmentId?: string;
}

export class GetEnrollmentFollowThroughUseCase {
  constructor(
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly plannedWorkoutRepository: PlannedWorkoutRepository,
    private readonly followThroughExecutionFactsRepository: FollowThroughExecutionFactsRepository,
    /**
     * The zero-planned-rows terminal path only: it composes NOTHING (its count
     * is facts alone), so it keeps the plain fact read. Every path that
     * composes session truth with the facts uses the snapshot port above.
     */
    private readonly notPerformedRepository: NotPerformedOccurrenceRepository,
  ) {}

  async execute(
    input: GetEnrollmentFollowThroughInput,
  ): Promise<Result<EnrollmentFollowThroughDto | null, GetEnrollmentFollowThroughError>> {
    const userIdResult = createUserId(input.userId);
    if (!userIdResult.ok) {
      return err({
        code: 'INVALID_INPUT',
        message: userIdResult.error.message,
        field: 'userId',
      });
    }

    // The fenced path: identity and facts in ONE statement — never a validate
    // call followed by an independent facts call, whose window a concurrent
    // restart/leave could open.
    if (input.expectedEnrollmentId !== undefined) {
      return this.executeFenced(input.expectedEnrollmentId, userIdResult.data, input);
    }

    const enrollment = await this.enrollmentRepository.findByUserAndProgram(
      userIdResult.data,
      input.program.id,
    );
    if (enrollment === null) {
      return ok(null);
    }

    // The run's calendar intent: the only read that can decide whether there is
    // anything to report, so it is deliberately issued before any session read.
    const plannedRows = await this.plannedWorkoutRepository.listByEnrollment(enrollment.id);
    const today = plannedDateFromInstant(input.now);
    if (plannedRows.length === 0) {
      // No current calendar: no week and no total is fabricated, and no planned
      // row is invented. But the run's recorded not-performed facts are still
      // execution truth — with zero planned rows EVERY one of them is unplaced,
      // so the factual count is reported. Only the fact read is issued: the
      // session projections could change no count here. This stays the
      // unconfigured variant (no weeks, no totals, no dates) — a fact does not
      // configure the calendar.
      const notPerformedFacts = await this.notPerformedRepository.listByEnrollment(enrollment.id);
      return ok(
        toUnconfiguredFollowThroughDto(
          input.program.slug,
          today,
          countUnplacedFacts(notPerformedFacts, plannedRows),
        ),
      );
    }

    // ONE coherent snapshot: completed activity, in-progress sessions and the
    // recorded facts are mutually exclusive per occurrence, so they are
    // projected together — a concurrent Undo→start→complete transition can
    // never hand the Domain BOTH the record and the completed session for one
    // occurrence. ONE bounded statement, never one query per planned row or
    // per occurrence.
    const { completedActivity, inProgressIds, notPerformedFacts } =
      await this.followThroughExecutionFactsRepository.listFollowThroughExecutionFactsByEnrollment(
        enrollment.id,
      );

    // Deliberately computed BEFORE summarization and outside it: the count is
    // "recorded facts whose occurrence has no current planned row", so it cannot
    // be derived from the reported weeks and cannot be influenced by the horizon.
    const notPerformedUnplaced = countUnplacedFacts(notPerformedFacts, plannedRows);

    return ok(
      toConfiguredFollowThroughDto(
        input.program.slug,
        today,
        summarizeFollowThrough(
          assembleOccurrences(
            plannedRows,
            completedActivity,
            inProgressIds,
            notPerformedFacts,
          ),
          listRecentTrainingWeekWindows(input.now, FOLLOW_THROUGH_WEEK_COUNT),
          input.now,
        ),
        notPerformedUnplaced,
      ),
    );
  }

  /**
   * The fenced read: ONE statement establishes BOTH that the caller's expected
   * enrollment is still this user's run of this program AND that run's
   * execution facts (the closure-fence pattern); the planned rows are read by
   * that exact identity, so no read of this path can ever describe another
   * generation.
   *
   * `matched: false` is the typed `ENROLLMENT_CHANGED` refusal, never absence and
   * never a report: the caller is composing a view for a run that DID exist, so
   * empty facts must never be rendered as a fresh run beside old-generation
   * parent data. A malformed id is the same refusal.
   */
  private async executeFenced(
    expectedEnrollmentId: string,
    userId: UserId,
    input: GetEnrollmentFollowThroughInput,
  ): Promise<Result<EnrollmentFollowThroughDto | null, GetEnrollmentFollowThroughError>> {
    const expectedId = createEnrollmentId(expectedEnrollmentId);
    if (!expectedId.ok) {
      return err({
        code: 'ENROLLMENT_CHANGED',
        message: 'The expected enrollment id is invalid, so the report cannot be read',
      });
    }

    const projection =
      await this.followThroughExecutionFactsRepository.findFencedFollowThroughExecutionFactsByEnrollment(
        expectedId.data,
        userId,
        input.program.id,
      );
    if (!projection.matched) {
      return err({
        code: 'ENROLLMENT_CHANGED',
        message: 'Your enrollment changed while reading the report. Please reload and try again.',
      });
    }

    // The planned rows of THAT run — keyed by the expected identity, never by a
    // re-resolved current enrollment, so this read can never mix generations.
    const plannedRows = await this.plannedWorkoutRepository.listByEnrollment(expectedId.data);
    const today = plannedDateFromInstant(input.now);

    if (plannedRows.length === 0) {
      // No current calendar for the expected run: the SAME unconfigured variant
      // semantics, with the facts from the SAME fenced statement (never a second
      // read that could observe another generation).
      const { notPerformedFacts } = projection.facts;
      return ok(
        toUnconfiguredFollowThroughDto(
          input.program.slug,
          today,
          countUnplacedFacts(notPerformedFacts, plannedRows),
        ),
      );
    }

    const { completedActivity, inProgressIds, notPerformedFacts } = projection.facts;
    const notPerformedUnplaced = countUnplacedFacts(notPerformedFacts, plannedRows);

    return ok(
      toConfiguredFollowThroughDto(
        input.program.slug,
        today,
        summarizeFollowThrough(
          assembleOccurrences(
            plannedRows,
            completedActivity,
            inProgressIds,
            notPerformedFacts,
          ),
          listRecentTrainingWeekWindows(input.now, FOLLOW_THROUGH_WEEK_COUNT),
          input.now,
        ),
        notPerformedUnplaced,
      ),
    );
  }
}

/**
 * The recorded facts whose occurrence holds NO current planned row.
 *
 * A set difference in memory between two enrollment-scoped reads: no extra query,
 * no date rule and no horizon. An out-of-horizon planned row is still a row, so a
 * recorded occurrence dated outside the reported weeks is NOT counted here — this
 * count means exactly "no current planned row", never "not represented by a
 * reported week".
 */
function countUnplacedFacts(
  notPerformedFacts: ReadonlyArray<NotPerformedOccurrence>,
  plannedRows: ReadonlyArray<PlannedWorkout>,
): number {
  const occurrenceIdsWithRows = new Set<ScheduledWorkoutId>(
    plannedRows.map((row) => row.scheduledWorkoutId),
  );

  return notPerformedFacts.filter((fact) => !occurrenceIdsWithRows.has(fact.scheduledWorkoutId))
    .length;
}

/**
 * Builds exactly one fact per CURRENT planned occurrence.
 *
 * Completion, in-progress and recorded-not-performed facts are keyed by occurrence
 * id, so a fact whose occurrence has no planned row simply never joins: it can
 * neither create an extra report occurrence nor be attributed to another run's.
 * That is what keeps M16 a current-calendar report — the recorded facts are only
 * ever attached to rows that exist, and the run's rowless records are reported
 * separately as a count. Planned rows are iterated once and never deduplicated —
 * `(enrollment, scheduled workout)` is unique in the database, so a duplicate
 * here would be a corrupt read, and the Domain summarizer fails loudly on one
 * rather than merging it.
 */
function assembleOccurrences(
  plannedRows: ReadonlyArray<PlannedWorkout>,
  completedActivity: ReadonlyArray<CompletedOccurrenceActivity>,
  inProgressIds: ReadonlyArray<ScheduledWorkoutId>,
  notPerformedFacts: ReadonlyArray<NotPerformedOccurrence>,
): ReadonlyArray<PlannedOccurrenceFacts> {
  const completedAtByOccurrence = new Map<ScheduledWorkoutId, Date>(
    completedActivity.map((item) => [item.scheduledWorkoutId, item.completedAt]),
  );
  const inProgress = new Set<ScheduledWorkoutId>(inProgressIds);
  const recorded = new Set<ScheduledWorkoutId>(
    notPerformedFacts.map((fact) => fact.scheduledWorkoutId),
  );

  return plannedRows.map((plannedWorkout) => ({
    scheduledWorkoutId: plannedWorkout.scheduledWorkoutId,
    plannedDate: plannedWorkout.plannedDate,
    completedAt: completedAtByOccurrence.get(plannedWorkout.scheduledWorkoutId) ?? null,
    hasActiveSession: inProgress.has(plannedWorkout.scheduledWorkoutId),
    hasNotPerformedRecord: recorded.has(plannedWorkout.scheduledWorkoutId),
  }));
}
