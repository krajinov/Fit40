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
import type { NotPerformedOccurrenceRepository } from '@/application/ports/not-performed-occurrence-repository';
import type { PlannedWorkoutRepository } from '@/application/ports/planned-workout-repository';
import type { ProgramEnrollmentRepository } from '@/application/ports/program-enrollment-repository';
import type {
  CompletedOccurrenceActivity,
  WorkoutSessionRepository,
} from '@/application/ports/workout-session-repository';
import type { NotPerformedOccurrence } from '@/domain/entities/not-performed-occurrence';
import type { PlannedWorkout } from '@/domain/entities/planned-workout';
import type { TrainingProgram } from '@/domain/entities/training-program';
import { summarizeFollowThrough } from '@/domain/services/follow-through-week';
import type { PlannedOccurrenceFacts } from '@/domain/services/plan-follow-through';
import { listRecentTrainingWeekWindows } from '@/domain/services/training-week';
import { createUserId, type ScheduledWorkoutId } from '@/domain/types/ids';
import { err, ok, type Result } from '@/domain/types/result';
import { plannedDateFromInstant } from '@/domain/value-objects/planned-date';

/**
 * How many recent UTC training weeks the report covers: the same 8-week horizon
 * the M13 weekly insights use, so the product has one answer to "how far back do
 * we look".
 */
export const FOLLOW_THROUGH_WEEK_COUNT = 8;

export type GetEnrollmentFollowThroughError = {
  readonly code: 'INVALID_INPUT';
  readonly message: string;
  readonly field?: string;
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
}

export class GetEnrollmentFollowThroughUseCase {
  constructor(
    private readonly enrollmentRepository: ProgramEnrollmentRepository,
    private readonly plannedWorkoutRepository: PlannedWorkoutRepository,
    private readonly sessionRepository: WorkoutSessionRepository,
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

    // Three independent, enrollment-scoped projections read in one batch: none
    // decides whether another should happen (the planned rows above already
    // did), so issuing them together only shortens the read. The M17 fact read is
    // ONE bounded statement — never one query per planned row or per occurrence.
    const [completedActivity, inProgressIds, notPerformedFacts] = await Promise.all([
      this.sessionRepository.listCompletedOccurrenceActivity(enrollment.id),
      this.sessionRepository.listInProgressScheduledWorkoutIds(enrollment.id),
      this.notPerformedRepository.listByEnrollment(enrollment.id),
    ]);

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
